import { cache, cacheTtl } from '../services/cacheService.js';
import { normalizeCode, normalizeQuoteTime, toNumber } from '../services/fundNormalizer.js';
import { recordSourceFailure, recordSourceSuccess } from '../services/sourceHealth.js';

const QUOTE_STALE_MAX_AGE_MS = 2 * 60_000;

export async function fetchSinaQuoteMap(codes, { force = false } = {}) {
  const normalizedCodes = [...new Set((codes || []).map(normalizeCode).filter(Boolean))];
  if (!normalizedCodes.length) return new Map();
  const cacheKey = `sina:quote:${normalizedCodes.join(',')}`;
  if (!force) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  const startedAt = Date.now();
  try {
    const rows = [];
    for (const group of chunk(normalizedCodes, 120)) {
      rows.push(...(await fetchSinaQuoteBatch(group)));
    }
    const map = new Map(rows.map((row) => [row.code, row]));
    recordSourceSuccess('sina-direct', Date.now() - startedAt);
    return cache.set(cacheKey, map, cacheTtl.quotes);
  } catch (error) {
    recordSourceFailure('sina-direct', error, Date.now() - startedAt);
    return cache.getStale(cacheKey, { maxAgeMs: QUOTE_STALE_MAX_AGE_MS }) || new Map();
  }
}

export function parseSinaQuoteResponse(text) {
  return String(text || '')
    .split('\n')
    .map(parseSinaQuoteLine)
    .filter(Boolean);
}

async function fetchSinaQuoteBatch(codes) {
  const symbols = codes.map((code) => `${exchangePrefix(code)}${code}`).join(',');
  const response = await fetch(`https://hq.sinajs.cn/list=${symbols}`, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      accept: '*/*',
      referer: 'https://finance.sina.com.cn/',
      'user-agent': 'Mozilla/5.0 LOF-Premium-Radar/0.1',
    },
  });
  if (!response.ok) throw new Error(`新浪直接行情返回 ${response.status}`);
  const text = new TextDecoder('gb18030').decode(Buffer.from(await response.arrayBuffer()));
  return parseSinaQuoteResponse(text);
}

function parseSinaQuoteLine(line) {
  const match = String(line || '').match(/var hq_str_s[hz](\d{6})="(.*)";/);
  if (!match) return null;
  const code = normalizeCode(match[1]);
  const values = match[2].split(',');
  const marketPrice = toNumber(values[3]);
  if (!code || marketPrice === null || marketPrice <= 0) return null;
  const previousClose = toNumber(values[2]);
  return {
    code,
    name: values[0] || code,
    marketPrice,
    changeRate: previousClose ? ((marketPrice / previousClose) - 1) * 100 : null,
    volume: toNumber(values[8]),
    turnover: toNumber(values[9]),
    quoteTime: normalizeQuoteTime(values[30], values[31]),
    source: 'sina',
  };
}

function exchangePrefix(code) {
  return /^(5|6)/.test(normalizeCode(code)) ? 'sh' : 'sz';
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}
