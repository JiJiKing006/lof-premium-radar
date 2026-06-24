import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cache, cacheTtl } from './cacheService.js';
import { recordSourceFailure, recordSourceSuccess } from './sourceHealth.js';
import { fetchAkshareQuotes } from '../sources/akshareSource.js';
import { fetchEastmoneyQuotes } from '../sources/eastmoneySource.js';
import { fetchHaoetfQuotes } from '../sources/haoetfSource.js';
import { fetchPalmmicroLofReferenceRows } from '../sources/palmmicroSource.js';
import { fetchSinaQuotes } from '../sources/sinaSource.js';
import { normalizeCategory as normalizeFundCategory, normalizeCode, normalizeMarket } from './fundNormalizer.js';
import { formatShanghaiTime } from './sourceHealth.js';

const inFlight = new Map();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_LOF_REFERENCE_PATH = path.resolve(__dirname, '../../data/lof.json');
const LOF_REFERENCE_CACHE_KEY = 'lof-reference-rows';
const QDII_EXCLUDED_NAME_PATTERN = /黄金|贵金属|GOLD/i;
const QUOTE_STALE_MAX_AGE_MS = 2 * 60_000;
const QUOTE_FRESH_BUDGET_MS = 2_100;
const SOURCE_TIMEOUT_MS = 1_200;
const LOF_REFERENCE_TIMEOUT_MS = 700;

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
  const deadline = Date.now() + QUOTE_FRESH_BUDGET_MS;
  const referenceRows = category === 'LOF' ? await loadLofReferenceRows(errors, { deadline }) : [];
  const referenceCodes = referenceRows.length
    ? new Set(referenceRows.map((row) => normalizeCode(row.code)).filter(Boolean))
    : null;

  for (const source of sources) {
    const remainingMs = remainingBudget(deadline);
    if (remainingMs <= 100) {
      errors.push(`${source.name}: skipped because quote budget was exhausted`);
      break;
    }
    const startedAt = Date.now();
    try {
      const rows = await fetchSourceRows(source, Math.min(SOURCE_TIMEOUT_MS, remainingMs));
      const categoryRows = filterRowsForCategory(rows, category, { referenceCodes });
      if (!Array.isArray(categoryRows) || !categoryRows.length) throw new Error(`${source.name} ${category} 返回空数组`);
      const completedRows = category === 'LOF' ? completeLofReferenceRows(categoryRows, referenceRows) : categoryRows;
      const latency = Date.now() - startedAt;
      recordSourceSuccess(source.name, latency);
      const payload = {
        rows: completedRows.map((row) => ({ ...row, category, sourceStatus: row.sourceStatus || source.status })),
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

  const stale = cache.getStale(cacheKey, { maxAgeMs: QUOTE_STALE_MAX_AGE_MS });
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
  return cache.set(cacheKey, buildUnavailableQuotePayload(category, referenceRows, errors), cacheTtl.indices);
}

export function filterRowsForCategory(rows, category, options = {}) {
  if (!Array.isArray(rows)) return [];
  if (category === 'ALL') return rows;
  return rows.filter((row) => {
    if (category === 'LOF') return isAllowedLofRow(row, options.referenceCodes);
    if (normalizeFundCategory(row) !== category) return false;
    if (category === 'QDII') return !isGoldQdiiRow(row);
    return true;
  });
}

export function sourcePlan(category) {
  if (category === 'LOF') {
    return [
      { name: 'eastmoney', status: 'primary', hasNav: false, fetcher: fetchEastmoneyQuotes },
      { name: 'sina', status: 'fallback', hasNav: false, fetcher: fetchSinaQuotes },
      { name: 'akshare', status: 'fallback', hasNav: false, fetcher: fetchAkshareQuotes },
    ];
  }
  if (category === 'QDII' || category === 'ETF') {
    return [
      { name: 'eastmoney', status: 'primary', hasNav: false, fetcher: fetchEastmoneyQuotes },
      { name: 'sina', status: 'fallback', hasNav: false, fetcher: fetchSinaQuotes },
      { name: 'haoetf', status: 'fallback', hasNav: true, fetcher: (options) => fetchHaoetfQuotes(category, options) },
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

async function loadLofReferenceRows(errors, { deadline = Date.now() + LOF_REFERENCE_TIMEOUT_MS } = {}) {
  const cached = cache.get(LOF_REFERENCE_CACHE_KEY);
  if (cached) return cached;

  const localRows = loadLocalLofReferenceRows();
  const startedAt = Date.now();
  try {
    const rows = await fetchWithTimeout(
      (options) => fetchPalmmicroLofReferenceRows(options),
      Math.max(100, Math.min(LOF_REFERENCE_TIMEOUT_MS, remainingBudget(deadline))),
    );
    const referenceRows = rows.filter((row) => normalizeCode(row.code));
    if (!referenceRows.length) throw new Error('Palmmicro LOF 参考表为空');
    recordSourceSuccess('palmmicro', Date.now() - startedAt);
    return cache.set(LOF_REFERENCE_CACHE_KEY, mergeLofReferenceRows(referenceRows, localRows), cacheTtl.fundList);
  } catch (error) {
    errors.push(`palmmicro-reference: ${error.message || error}`);
    recordSourceFailure('palmmicro', error, Date.now() - startedAt);
    if (localRows.length) return cache.set(LOF_REFERENCE_CACHE_KEY, localRows, cacheTtl.fundList);
    return [];
  }
}

export function fetchSourceRows(source, timeoutMs = SOURCE_TIMEOUT_MS) {
  return fetchWithTimeout((options) => source.fetcher(options), timeoutMs);
}

function fetchWithTimeout(fetcher, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new Error('source timeout'));
      reject(new Error('source timeout'));
    }, timeoutMs);
  });
  const request = Promise.resolve().then(() => fetcher({ signal: controller.signal }));
  return Promise.race([request, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

function remainingBudget(deadline) {
  return Math.max(0, deadline - Date.now());
}

function loadLocalLofReferenceRows() {
  try {
    return normalizeLocalLofReferenceRows(JSON.parse(fs.readFileSync(LOCAL_LOF_REFERENCE_PATH, 'utf8')));
  } catch {
    return [];
  }
}

export function normalizeLocalLofReferenceRows(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  return rows
    .map((row) => {
      const code = normalizeCode(row.code || row.fundCode);
      const name = String(row.referenceName || row.name || row.fundName || code || '').trim();
      if (!code || !name) return null;
      const base = {
        code,
        name,
        category: 'LOF',
        source: row.referenceSource || 'palmmicro-reference-local',
        sourceStatus: 'reference',
      };
      return { ...base, market: normalizeMarket(base) };
    })
    .filter(Boolean);
}

export function mergeLofReferenceRows(primaryRows, supplementalRows) {
  const rows = [];
  const seenCodes = new Set();

  [...(Array.isArray(primaryRows) ? primaryRows : []), ...(Array.isArray(supplementalRows) ? supplementalRows : [])].forEach((row) => {
    const code = normalizeCode(row.code || row.fundCode);
    if (!code || seenCodes.has(code)) return;
    rows.push({ ...row, code });
    seenCodes.add(code);
  });

  return rows;
}

export function completeLofReferenceRows(sourceRows, referenceRows) {
  if (!Array.isArray(referenceRows) || !referenceRows.length) return sourceRows;
  const sourceByCode = new Map(
    (Array.isArray(sourceRows) ? sourceRows : [])
      .map((row) => [normalizeCode(row.code || row.fundCode), row])
      .filter(([code]) => code),
  );
  const updateTime = formatShanghaiTime();
  const rows = [];

  referenceRows.forEach((reference) => {
    const code = normalizeCode(reference.code || reference.fundCode);
    if (!code) return;
    const sourceRow = sourceByCode.get(code);
    rows.push(sourceRow ? buildReferencedLofQuoteRow(sourceRow, reference, updateTime) : buildMissingLofQuoteRow(reference, updateTime));
  });

  return rows;
}

function buildUnavailableQuotePayload(category, referenceRows, errors) {
  const rows = category === 'LOF' ? completeLofReferenceRows([], referenceRows) : [];
  return {
    rows,
    source: 'unavailable',
    sourceStatus: 'error',
    hasNav: false,
    errors: errors.length ? errors : ['行情数据源全部不可用'],
  };
}

function buildReferencedLofQuoteRow(row, reference, updateTime) {
  const base = {
    ...row,
    code: normalizeCode(row.code || row.fundCode),
    name: reference.name || row.name || row.fundName || normalizeCode(row.code || row.fundCode),
    category: 'LOF',
    market: row.market || normalizeMarket(reference),
    referenceSource: reference.source || reference.referenceSource || 'palmmicro',
    updateTime: row.updateTime || updateTime,
  };
  return base;
}

function buildMissingLofQuoteRow(reference, updateTime) {
  const base = {
    code: normalizeCode(reference.code || reference.fundCode),
    name: reference.name || reference.fundName || normalizeCode(reference.code || reference.fundCode),
    category: 'LOF',
    marketPrice: null,
    lastNav: null,
    estimatedNav: null,
    changeRate: null,
    volume: null,
    turnover: null,
    purchaseLimit: { state: 'unknown', label: '未知' },
    source: 'quote-missing',
    sourceStatus: 'missing',
    dataStatus: 'missing_quote',
    quoteTime: '',
    updateTime,
    navDate: '',
    navQuoteTime: '',
    isRealtime: false,
    referenceSource: reference.source || reference.referenceSource || 'palmmicro',
  };
  return { ...base, market: normalizeMarket({ ...reference, ...base }) };
}

function isAllowedLofRow(row, referenceCodes) {
  const source = String(row.source || '').toLowerCase();
  if (source.includes('palmmicro')) return false;
  if (!referenceCodes?.size) return normalizeFundCategory(row) === 'LOF';
  return referenceCodes.has(normalizeCode(row.code || row.fundCode));
}

function isGoldQdiiRow(row) {
  return QDII_EXCLUDED_NAME_PATTERN.test([
    row.name,
    row.fundName,
    row.indexName,
    row.market,
    row.region,
  ].filter(Boolean).join(' '));
}
