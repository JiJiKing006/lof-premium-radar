import dns from 'node:dns';
import { cache, cacheTtl } from '../services/cacheService.js';
import { formatShanghaiTime, recordSourceFailure, recordSourceSuccess } from '../services/sourceHealth.js';
import { toNumber } from '../services/fundNormalizer.js';

dns.setDefaultResultOrder('ipv4first');

const INDEX_FIELDS = ['f12', 'f13', 'f14', 'f2', 'f3', 'f4', 'f124'];
const INDEXES = [
  { key: 'sh000001', secid: '1.000001', label: '上证指数' },
  { key: 'sz399001', secid: '0.399001', label: '深证成指' },
  { key: 'sz399006', secid: '0.399006', label: '创业板指' },
  { key: 'sh000300', secid: '1.000300', label: '沪深300' },
  { key: 'hsi', secid: '100.HSI', label: '恒生指数' },
  { key: 'ndx', secid: '100.NDX', label: '纳斯达克100' },
  { key: 'spx', secid: '100.SPX', label: '标普500' },
];

export async function fetchMarketIndices({ force = false } = {}) {
  const cacheKey = 'market-indices:eastmoney';
  if (!force) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  const startedAt = Date.now();
  try {
    const rows = await fetchEastmoneyIndexRows();
    if (!rows.length) throw new Error('东方财富指数行情返回空数组');
    const payload = {
      meta: {
        source: 'eastmoney',
        sourceStatus: 'primary',
        updateTime: formatShanghaiTime(),
        latestQuoteTime: latestQuoteTime(rows),
        rowCount: rows.length,
        stale: false,
      },
      rows,
    };
    recordSourceSuccess('eastmoney-index', Date.now() - startedAt);
    return cache.set(cacheKey, payload, cacheTtl.indices);
  } catch (error) {
    recordSourceFailure('eastmoney-index', error, Date.now() - startedAt);
    const stale = cache.getStale(cacheKey);
    if (stale) {
      return {
        ...stale,
        meta: {
          ...stale.meta,
          sourceStatus: 'cache',
          updateTime: formatShanghaiTime(),
          stale: true,
          error: error.message || String(error),
        },
      };
    }
    throw error;
  }
}

async function fetchEastmoneyIndexRows() {
  const url = new URL('https://push2.eastmoney.com/api/qt/ulist.np/get');
  url.searchParams.set('fltt', '2');
  url.searchParams.set('secids', INDEXES.map((item) => item.secid).join(','));
  url.searchParams.set('fields', INDEX_FIELDS.join(','));
  url.searchParams.set('t', String(Date.now()));

  const response = await fetch(url, {
    signal: AbortSignal.timeout(8_000),
    headers: {
      accept: 'application/json,text/plain,*/*',
      referer: 'https://quote.eastmoney.com/',
      'user-agent': 'Mozilla/5.0 LOF-Premium-Radar/0.1',
    },
  });
  if (!response.ok) throw new Error(`东方财富指数行情返回 ${response.status}`);
  const json = await response.json();
  const labels = new Map(INDEXES.map((item) => [item.secid, item]));
  return (json.data?.diff || [])
    .map((cell) => normalizeIndex(cell, labels))
    .filter(Boolean);
}

function normalizeIndex(cell, labels) {
  const secid = `${cell.f13}.${cell.f12}`;
  const config = labels.get(secid);
  const value = toNumber(cell.f2);
  if (!config || value === null) return null;
  return {
    key: config.key,
    code: cell.f12,
    name: config.label || cell.f14 || cell.f12,
    value,
    change: toNumber(cell.f4),
    changeRate: toNumber(cell.f3),
    quoteTime: epochToShanghaiTime(cell.f124),
    source: 'eastmoney',
  };
}

function epochToShanghaiTime(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  return formatShanghaiTime(new Date(seconds * 1000));
}

function latestQuoteTime(rows) {
  return rows
    .map((row) => row.quoteTime)
    .filter(Boolean)
    .sort()
    .at(-1) || '';
}
