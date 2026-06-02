import { cache, cacheTtl } from './cacheService.js';
import { recordSourceFailure, recordSourceSuccess } from './sourceHealth.js';
import { fetchAkshareQuotes } from '../sources/akshareSource.js';
import { fetchEastmoneyQuotes } from '../sources/eastmoneySource.js';
import { fetchHaoetfQuotes } from '../sources/haoetfSource.js';
import { fetchPalmmicroLofQuotes } from '../sources/palmmicroSource.js';
import { fetchSinaQuotes } from '../sources/sinaSource.js';
import { normalizeCategory as normalizeFundCategory } from './fundNormalizer.js';

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
      const categoryRows = filterRowsForCategory(rows, category);
      if (!Array.isArray(categoryRows) || !categoryRows.length) throw new Error(`${source.name} ${category} 返回空数组`);
      const latency = Date.now() - startedAt;
      recordSourceSuccess(source.name, latency);
      const payload = {
        rows: categoryRows.map((row) => ({ ...row, sourceStatus: source.status })),
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

export function filterRowsForCategory(rows, category) {
  if (!Array.isArray(rows)) return [];
  if (category === 'ALL') return rows;
  return rows.filter((row) => normalizeFundCategory(row) === category);
}

export function sourcePlan(category) {
  if (category === 'LOF') {
    return [
      { name: 'eastmoney', status: 'primary', hasNav: false, fetcher: fetchEastmoneyQuotes },
      { name: 'sina', status: 'fallback', hasNav: false, fetcher: fetchSinaQuotes },
      { name: 'akshare', status: 'fallback', hasNav: false, fetcher: fetchAkshareQuotes },
      { name: 'palmmicro', status: 'fallback', hasNav: true, fetcher: fetchPalmmicroLofQuotes },
    ];
  }
  if (category === 'QDII' || category === 'ETF') {
    return [
      { name: 'eastmoney', status: 'primary', hasNav: false, fetcher: fetchEastmoneyQuotes },
      { name: 'sina', status: 'fallback', hasNav: false, fetcher: fetchSinaQuotes },
      { name: 'haoetf', status: 'fallback', hasNav: true, fetcher: () => fetchHaoetfQuotes(category) },
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
