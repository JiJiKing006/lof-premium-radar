import dns from 'node:dns';
import { cache, cacheTtl } from '../services/cacheService.js';
import { normalizeCode, toNumber } from '../services/fundNormalizer.js';
import { formatShanghaiTime, recordSourceFailure, recordSourceSuccess } from '../services/sourceHealth.js';

const QUOTE_FIELDS = ['f12', 'f13', 'f14', 'f2', 'f3', 'f5', 'f6', 'f124', 'f297'];
const TREND_FIELDS_1 = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12', 'f13'];
const TREND_FIELDS_2 = ['f51', 'f52', 'f53', 'f54', 'f55', 'f56', 'f57', 'f58'];
const QUOTE_STALE_MAX_AGE_MS = 2 * 60_000;
const TREND_STALE_MAX_AGE_MS = 60_000;

dns.setDefaultResultOrder('ipv4first');

export async function fetchEastmoneyQuoteMap(codes, { force = false } = {}) {
  const normalizedCodes = uniqueCodes(codes);
  if (!normalizedCodes.length) return new Map();
  const cacheKey = `eastmoney:quote:${normalizedCodes.join(',')}`;
  if (!force) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  const startedAt = Date.now();
  try {
    const rows = [];
    for (const chunk of chunks(normalizedCodes, 80)) {
      rows.push(...(await fetchQuoteChunk(chunk)));
    }
    const map = new Map(rows.map((row) => [row.code, row]));
    recordSourceSuccess('eastmoney', Date.now() - startedAt);
    return cache.set(cacheKey, map, cacheTtl.quotes);
  } catch (error) {
    recordSourceFailure('eastmoney', error, Date.now() - startedAt);
    return cache.getStale(cacheKey, { maxAgeMs: QUOTE_STALE_MAX_AGE_MS }) || new Map();
  }
}

export async function fetchEastmoneyTrendMap(codes, { force = false } = {}) {
  const normalizedCodes = uniqueCodes(codes);
  if (!normalizedCodes.length) return new Map();
  const cacheKey = `eastmoney:trends:${normalizedCodes.join(',')}`;
  if (!force) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  const startedAt = Date.now();
  try {
    const entries = await mapLimit(normalizedCodes, 4, async (code) => {
      try {
        return [code, await fetchTrendWithFallback(code)];
      } catch {
        return [code, { points: [], source: '' }];
      }
    });
    const map = new Map(entries.filter(([, trend]) => trend.points.length));
    recordSourceSuccess('eastmoney-trend', Date.now() - startedAt);
    return cache.set(cacheKey, map, cacheTtl.trends);
  } catch (error) {
    recordSourceFailure('eastmoney-trend', error, Date.now() - startedAt);
    return cache.getStale(cacheKey, { maxAgeMs: TREND_STALE_MAX_AGE_MS }) || new Map();
  }
}

async function fetchQuoteChunk(codes) {
  const url = new URL('https://push2.eastmoney.com/api/qt/ulist.np/get');
  url.searchParams.set('fltt', '2');
  url.searchParams.set('secids', codes.map(secid).join(','));
  url.searchParams.set('fields', QUOTE_FIELDS.join(','));
  url.searchParams.set('t', String(Date.now()));

  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      accept: 'application/json,text/plain,*/*',
      referer: 'https://quote.eastmoney.com/',
      'user-agent': 'Mozilla/5.0 LOF-Premium-Radar/0.1',
    },
  });
  if (!response.ok) throw new Error(`东方财富补充行情返回 ${response.status}`);
  const json = await response.json();
  return (json.data?.diff || []).map(normalizeQuote).filter(Boolean);
}

async function fetchTrend(code) {
  const url = new URL('https://push2his.eastmoney.com/api/qt/stock/trends2/get');
  url.searchParams.set('secid', secid(code));
  url.searchParams.set('fields1', TREND_FIELDS_1.join(','));
  url.searchParams.set('fields2', TREND_FIELDS_2.join(','));
  url.searchParams.set('iscr', '0');
  url.searchParams.set('iscca', '0');
  url.searchParams.set('ndays', '1');
  url.searchParams.set('t', String(Date.now()));

  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      accept: 'application/json,text/plain,*/*',
      referer: 'https://quote.eastmoney.com/',
      'user-agent': 'Mozilla/5.0 LOF-Premium-Radar/0.1',
    },
  });
  if (!response.ok) throw new Error(`东方财富分时返回 ${response.status}`);
  const json = await response.json();
  return (json.data?.trends || [])
    .map((line) => {
      const cells = String(line).split(',');
      const price = toNumber(cells[2]);
      if (!cells[0] || price === null) return null;
      return {
        time: cells[0],
        price,
        volume: toNumber(cells[5]),
        turnover: toNumber(cells[6]),
      };
    })
    .filter(Boolean);
}

async function fetchTrendWithFallback(code) {
  try {
    const points = await fetchTrend(code);
    if (points.length) return { points, source: 'eastmoney' };
  } catch {
    // Fall through to Sina minute line when Eastmoney closes the socket or rate limits.
  }
  const points = await fetchSinaTrend(code);
  return { points, source: points.length ? 'sina' : '' };
}

async function fetchSinaTrend(code) {
  const url = new URL('https://quotes.sina.cn/cn/api/openapi.php/CN_MinlineService.getMinlineData');
  url.searchParams.set('symbol', sinaSymbol(code));
  url.searchParams.set('callback', '');
  url.searchParams.set('t', String(Date.now()));

  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      accept: 'application/json,text/plain,*/*',
      referer: 'https://finance.sina.com.cn/',
      'user-agent': 'Mozilla/5.0 LOF-Premium-Radar/0.1',
    },
  });
  if (!response.ok) throw new Error(`新浪分时返回 ${response.status}`);
  const json = await response.json();
  return (json.result?.data || [])
    .map((item) => {
      const price = toNumber(item.p);
      if (!item.m || price === null) return null;
      return {
        time: item.m,
        price,
        volume: toNumber(item.v),
        turnover: null,
      };
    })
    .filter(Boolean);
}

function normalizeQuote(cell) {
  const code = normalizeCode(cell.f12);
  const marketPrice = toNumber(cell.f2);
  if (!code || marketPrice === null) return null;
  return {
    code,
    name: cell.f14 || code,
    marketPrice,
    changeRate: toNumber(cell.f3),
    volume: toNumber(cell.f5),
    turnover: toNumber(cell.f6),
    quoteTime: epochToShanghaiTime(cell.f124),
    tradeDate: normalizeTradeDate(cell.f297),
    source: 'eastmoney',
  };
}

function secid(code) {
  const normalized = normalizeCode(code);
  return `${normalized.startsWith('5') ? '1' : '0'}.${normalized}`;
}

function sinaSymbol(code) {
  const normalized = normalizeCode(code);
  return `${normalized.startsWith('5') ? 'sh' : 'sz'}${normalized}`;
}

function epochToShanghaiTime(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  return formatShanghaiTime(new Date(seconds * 1000));
}

function normalizeTradeDate(value) {
  const text = String(value || '');
  const match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function uniqueCodes(codes) {
  return [...new Set((codes || []).map(normalizeCode).filter(Boolean))];
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function mapLimit(items, limit, mapper) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
