import { cache, cacheTtl } from './cacheService.js';
import { recordSourceFailure, recordSourceSuccess } from './sourceHealth.js';
import { fetchAkshareQuotes } from '../sources/akshareSource.js';
import { fetchEastmoneyQuotes } from '../sources/eastmoneySource.js';
import { fetchHaoetfQuotes } from '../sources/haoetfSource.js';
import { fetchPalmmicroLofQuotes } from '../sources/palmmicroSource.js';
import { fetchSinaQuotes } from '../sources/sinaSource.js';

const inFlight = new Map();

export async function getQuotes({ category = 'LOF', force = false } = {}) {
  const normalizedCategory = normalizeCategory(category);
  const cacheKey = `quotes:${normalizedCategory}`;
  if (!force) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);

  const promise = fetchFreshQuotes(normalizedCategory, cacheKey).finally(() => {
    inFlight.delete(cacheKey);
  });
  inFlight.set(cacheKey, promise);

  return promise;
}

async function fetchFreshQuotes(category, cacheKey) {
  const sources = sourcePlan(category);
  const errors = [];

  for (const source of sources) {
    const startedAt = Date.now();
    try {
      const rows = await source.fetcher();
      if (!Array.isArray(rows) || !rows.length) throw new Error(`${source.name} 返回空数组`);
      const latency = Date.now() - startedAt;
      recordSourceSuccess(source.name, latency);
      const payload = {
        rows: rows.map((row) => ({ ...row, sourceStatus: source.status })),
        source: source.name,
        sourceStatus: source.status,
        hasNav: source.hasNav,
        errors,
      };
      return cache.set(cacheKey, payload, cacheTtl.quotes);
    } catch (error) {
      errors.push(`${source.name}: ${error.message || error}`);
      recordSourceFailure(source.name, error, Date.now() - startedAt);
    }
  }

  const stale = cache.getStale(cacheKey);
  if (stale) {
    recordSourceSuccess('cache', 0);
    return {
      ...stale,
      source: 'cache',
      sourceStatus: 'cache',
      errors,
      rows: stale.rows.map((row) => ({ ...row, sourceStatus: 'cache' })),
    };
  }

  recordSourceFailure('cache', new Error('没有可用缓存'));
  throw new Error(errors.join('；') || '行情数据源全部不可用');
}

export function sourcePlan(category) {
  if (category === 'LOF') {
    return [
      { name: 'palmmicro', status: 'primary', hasNav: true, fetcher: fetchPalmmicroLofQuotes },
      { name: 'eastmoney', status: 'fallback', hasNav: false, fetcher: fetchEastmoneyQuotes },
      { name: 'sina', status: 'fallback', hasNav: false, fetcher: fetchSinaQuotes },
      { name: 'akshare', status: 'fallback', hasNav: false, fetcher: fetchAkshareQuotes },
    ];
  }
  if (category === 'QDII' || category === 'ETF') {
    return [
      { name: 'haoetf', status: 'primary', hasNav: true, fetcher: () => fetchHaoetfQuotes(category) },
      { name: 'eastmoney', status: 'fallback', hasNav: false, fetcher: fetchEastmoneyQuotes },
      { name: 'sina', status: 'fallback', hasNav: false, fetcher: fetchSinaQuotes },
      { name: 'akshare', status: 'fallback', hasNav: false, fetcher: fetchAkshareQuotes },
    ];
  }
  return [
    { name: 'eastmoney', status: 'primary', hasNav: false, fetcher: fetchEastmoneyQuotes },
    { name: 'sina', status: 'fallback', hasNav: false, fetcher: fetchSinaQuotes },
    { name: 'akshare', status: 'fallback', hasNav: false, fetcher: fetchAkshareQuotes },
  ];
}

function normalizeCategory(category) {
  const text = String(category || 'LOF').toUpperCase();
  if (text === 'QDII' || text === 'ETF' || text === 'ALL') return text;
  return 'LOF';
}
