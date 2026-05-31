import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cache, cacheTtl } from '../services/cacheService.js';
import { normalizeCode, toNumber } from '../services/fundNormalizer.js';
import { recordSourceFailure, recordSourceSuccess } from '../services/sourceHealth.js';

const execFileAsync = promisify(execFile);
const SSE_COMMON_QUERY_URL = 'https://query.sse.com.cn/commonQuery.do';
const SSE_ETF_SCALE_SQL = 'COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L';
const SSE_LOF_SCALE_SQL = 'COMMON_SSE_SJ_JJSJ_JJGM_LOFGMTJ_L';
const SZSE_REPORT_URL = 'https://www.szse.cn/api/report/ShowReport/data';
const SZSE_ETF_CATALOG_ID = '1945';
const MAX_PREVIOUS_LOOKBACK_DAYS = 10;

export async function fetchExchangeShareMap(codes, { force = false } = {}) {
  const normalizedCodes = [...new Set((codes || []).map(normalizeCode).filter(Boolean))];
  if (!normalizedCodes.length) return new Map();

  const cacheKey = `exchange-shares:${normalizedCodes.join(',')}`;
  if (!force) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  const [sseMap, szseMap] = await Promise.all([fetchSseShareMap(), fetchSzseShareMap()]);
  const merged = new Map([...sseMap, ...szseMap]);
  const filtered = new Map(normalizedCodes.map((code) => [code, merged.get(code)]).filter(([, value]) => value));
  return cache.set(cacheKey, filtered, cacheTtl.exchangeShares);
}

async function fetchSseShareMap() {
  const startedAt = Date.now();
  try {
    const [currentEtf, currentLof] = await Promise.all([fetchSseEtfScale(), fetchSseLofScale()]);
    const currentRows = [...currentEtf, ...currentLof];
    const currentMap = rowsToMap(currentRows, 'sse');
    const latestDate = latestSseDate(currentRows);
    const previousRows = latestDate ? await fetchPreviousSseRows(latestDate) : [];
    const previousMap = rowsToMap(previousRows, 'sse');
    const result = attachPreviousChange(currentMap, previousMap);
    recordSourceSuccess('sse-share', Date.now() - startedAt);
    return result;
  } catch (error) {
    recordSourceFailure('sse-share', error, Date.now() - startedAt);
    return new Map();
  }
}

async function fetchPreviousSseRows(latestDate) {
  const latest = parseCompactDate(latestDate);
  if (!latest) return [];

  for (let offset = 1; offset <= MAX_PREVIOUS_LOOKBACK_DAYS; offset += 1) {
    const date = compactDate(addDays(latest, -offset));
    const [etfRows, lofRows] = await Promise.all([fetchSseEtfScale(date), fetchSseLofScale(date)]);
    const rows = [...etfRows, ...lofRows];
    if (rows.length) return rows;
  }

  return [];
}

async function fetchSseEtfScale(date = '') {
  const json = await fetchSseJson({
    isPagination: 'true',
    'pageHelp.pageSize': '10000',
    'pageHelp.pageNo': '1',
    'pageHelp.beginPage': '1',
    'pageHelp.cacheSize': '1',
    'pageHelp.endPage': '1',
    sqlId: SSE_ETF_SCALE_SQL,
    STAT_DATE: date,
  }, 'https://www.sse.com.cn/market/funddata/volumn/etfvolumn/');

  return sseRows(json).map((row) => ({
    code: normalizeCode(row.SEC_CODE),
    date: normalizeSseDate(row.STAT_DATE),
    valueWan: parseWanShare(row.TOT_VOL),
  })).filter((row) => row.code && row.valueWan !== null);
}

async function fetchSseLofScale(date = '') {
  const json = await fetchSseJson({
    isPagination: 'true',
    'pageHelp.pageSize': '10000',
    'pageHelp.pageNo': '1',
    'pageHelp.beginPage': '1',
    'pageHelp.cacheSize': '1',
    'pageHelp.endPage': '1',
    sqlId: SSE_LOF_SCALE_SQL,
    PRODUCT_TYPE: '11,14,15',
    SEARCH_DATE: date,
    type: 'inParams',
  }, 'https://www.sse.com.cn/market/funddata/volumn/lofvolumn/');

  return sseRows(json).map((row) => ({
    code: normalizeCode(row.FUND_CODE),
    date: normalizeSseDate(row.TRADE_DATE),
    valueWan: parseWanShare(row.INTERNAL_VOL),
  })).filter((row) => row.code && row.valueWan !== null);
}

async function fetchSseJson(params, referer) {
  const url = new URL(SSE_COMMON_QUERY_URL);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));

  const response = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: {
      accept: 'application/json,text/plain,*/*',
      referer,
      'user-agent': 'Mozilla/5.0 LOF-Premium-Radar/0.1',
    },
  });
  if (!response.ok) throw new Error(`上交所份额接口返回 ${response.status}`);
  return response.json();
}

function sseRows(json) {
  if (Array.isArray(json?.pageHelp?.data)) return json.pageHelp.data;
  if (Array.isArray(json?.result)) return json.result;
  return [];
}

async function fetchSzseShareMap() {
  const startedAt = Date.now();
  try {
    const firstPage = await fetchSzseEtfPage(1);
    const pages = [firstPage];
    const pageCount = Number(firstPage?.metadata?.pagecount || 1);

    for (let page = 2; page <= pageCount; page += 1) {
      pages.push(await fetchSzseEtfPage(page));
    }

    const map = new Map();
    for (const page of pages) {
      const date = normalizeSseDate(page?.metadata?.subname || '');
      for (const row of page?.data || []) {
        const code = extractText(row.sys_key);
        const valueWan = parseWanShare(row.dqgm);
        if (!code || valueWan === null) continue;
        map.set(normalizeCode(code), makeShareRow({ code, valueWan, date, source: 'szse' }));
      }
    }

    recordSourceSuccess('szse-share', Date.now() - startedAt);
    return map;
  } catch (error) {
    recordSourceFailure('szse-share', error, Date.now() - startedAt);
    return new Map();
  }
}

async function fetchSzseEtfPage(pageNo) {
  const url = new URL(SZSE_REPORT_URL);
  url.searchParams.set('SHOWTYPE', 'JSON');
  url.searchParams.set('CATALOGID', SZSE_ETF_CATALOG_ID);
  url.searchParams.set('tab1PAGENO', String(pageNo));
  url.searchParams.set('random', String(Date.now()));

  const json = await fetchSzseJson(url);
  return json?.[0] || { metadata: {}, data: [] };
}

async function fetchSzseJson(url) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      headers: {
        accept: 'application/json,text/plain,*/*',
        referer: 'https://www.szse.cn/market/product/fund/etf/etfList/index.html',
        'user-agent': 'Mozilla/5.0 LOF-Premium-Radar/0.1',
      },
    });
    if (!response.ok) throw new Error(`深交所 ETF 份额接口返回 ${response.status}`);
    return await response.json();
  } catch {
    const { stdout } = await execFileAsync('curl', [
      '-sS',
      '--max-time',
      '12',
      '-H',
      'Accept: application/json,text/plain,*/*',
      '-H',
      'Referer: https://www.szse.cn/market/product/fund/etf/etfList/index.html',
      '-H',
      'User-Agent: Mozilla/5.0 LOF-Premium-Radar/0.1',
      url.toString(),
    ], { maxBuffer: 2 * 1024 * 1024 });
    return JSON.parse(stdout);
  }
}

function rowsToMap(rows, source) {
  return new Map(rows.map((row) => [row.code, makeShareRow({ ...row, source })]));
}

function attachPreviousChange(currentMap, previousMap) {
  for (const [code, row] of currentMap.entries()) {
    const previous = previousMap.get(code);
    if (!previous) continue;
    const changeWan = row.shareValueWan - previous.shareValueWan;
    currentMap.set(code, {
      ...row,
      shareChange: formatSignedWanShare(changeWan),
      shareChangeValueWan: changeWan,
    });
  }
  return currentMap;
}

function makeShareRow({ code, valueWan, date, source }) {
  const normalizedCode = normalizeCode(code);
  return {
    code: normalizedCode,
    shareAmount: formatWanShare(valueWan),
    shareValueWan: valueWan,
    shareChange: '',
    shareChangeValueWan: null,
    shareSource: source,
    shareTime: date || '',
  };
}

function latestSseDate(rows) {
  return rows.map((row) => row.date).filter(Boolean).sort().at(-1) || '';
}

function parseWanShare(value) {
  const number = toNumber(String(value || '').replace(/,/g, ''));
  return number === null || number < 0 ? null : number;
}

function formatWanShare(valueWan) {
  if (!Number.isFinite(valueWan)) return '';
  if (Math.abs(valueWan) >= 10_000) return `${(valueWan / 10_000).toFixed(2)}亿份`;
  return `${valueWan.toFixed(2).replace(/\.?0+$/, '')}万份`;
}

function formatSignedWanShare(valueWan) {
  if (!Number.isFinite(valueWan)) return '';
  const prefix = valueWan > 0 ? '+' : '';
  return `${prefix}${formatWanShare(valueWan)}`;
}

function normalizeSseDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function parseCompactDate(value) {
  const normalized = normalizeSseDate(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function compactDate(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function addDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function extractText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}
