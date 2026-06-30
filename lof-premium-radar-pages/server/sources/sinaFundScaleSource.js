import { cache, cacheTtl } from '../services/cacheService.js';
import { normalizeCode } from '../services/fundNormalizer.js';
import { formatShanghaiTime, recordSourceFailure, recordSourceSuccess } from '../services/sourceHealth.js';

const SCALE_STALE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const requestsInFlight = new Map();

export async function fetchSinaFundScale(code, { force = false, signal } = {}) {
  const normalizedCode = normalizeCode(code);
  if (!/^\d{6}$/.test(normalizedCode)) return null;
  const cacheKey = `sina:fund-scale:${normalizedCode}`;
  if (!force) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }
  if (requestsInFlight.has(cacheKey)) return requestsInFlight.get(cacheKey);

  const request = fetchAndCacheScale(normalizedCode, cacheKey, signal)
    .finally(() => requestsInFlight.delete(cacheKey));
  requestsInFlight.set(cacheKey, request);
  return request;
}

async function fetchAndCacheScale(code, cacheKey, signal) {
  const startedAt = Date.now();
  try {
    const response = await fetch(`https://stock.finance.sina.com.cn/fundInfo/view/FundInfo_SGSH.php?symbol=${code}`, {
      signal: combinedSignal(signal, 900),
      headers: {
        accept: 'text/html,application/xhtml+xml',
        referer: `https://finance.sina.com.cn/fund/quotes/${code}/bc.shtml`,
        'user-agent': 'Mozilla/5.0 LOF-Premium-Radar/0.1',
      },
    });
    if (!response.ok) throw new Error(`新浪基金规模返回 ${response.status}`);
    const text = new TextDecoder('gb18030').decode(Buffer.from(await response.arrayBuffer()));
    const row = parseSinaFundScalePage(text, { code, fetchedAt: formatShanghaiTime() });
    if (!row) throw new Error('新浪基金规模为空或字段变更');
    recordSourceSuccess('sina-fund-scale', Date.now() - startedAt);
    return cache.set(cacheKey, row, cacheTtl.fundScale);
  } catch (error) {
    recordSourceFailure('sina-fund-scale', error, Date.now() - startedAt);
    const stale = cache.getStale(cacheKey, { maxAgeMs: SCALE_STALE_MAX_AGE_MS });
    return stale ? { ...stale, fundScaleStatus: 'stale', fundScaleStale: true } : null;
  }
}

export function parseSinaFundScalePage(html, { code = '', fetchedAt = formatShanghaiTime() } = {}) {
  const text = String(html || '');
  const scaleText = firstMatch(text, [
    /class=["']scale["'][^>]*>\s*([^<]+)/i,
    /class=["']fund_zxgm["'][^>]*>\s*([^<]+)/i,
  ]);
  const dateText = firstMatch(text, [
    /截止日期\s*[:：]\s*<span[^>]*class=["']date["'][^>]*>\s*([^<]+)/i,
    /数据日期\s*[:：]\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})/i,
  ]);
  const fundScale = parseScaleAmount(scaleText);
  const fundScaleDate = normalizeDate(dateText);
  if (!(fundScale > 0) || !fundScaleDate) return null;
  return {
    code: normalizeCode(code),
    fundScale,
    fundScaleSource: 'sina',
    fundScaleDate,
    fundScaleTime: fetchedAt,
    fundScaleStatus: 'fresh',
    fundScaleStale: false,
  };
}

function parseScaleAmount(value) {
  const match = String(value || '').replace(/&nbsp;/gi, ' ').match(/([\d,.]+)\s*(万亿|亿|万|元)/);
  if (!match) return null;
  const number = Number(match[1].replace(/,/g, ''));
  const multiplier = match[2] === '万亿' ? 1_000_000_000_000 : match[2] === '亿' ? 100_000_000 : match[2] === '万' ? 10_000 : 1;
  return Number.isFinite(number) && number > 0 ? Math.round(number * multiplier) : null;
}

function normalizeDate(value) {
  const match = String(value || '').trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return '';
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return '';
}

function combinedSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
