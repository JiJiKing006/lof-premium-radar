import { cache, cacheTtl } from './cacheService.js';
import { normalizeCode, toNumber } from './fundNormalizer.js';
import { formatShanghaiTime, recordSourceFailure, recordSourceSuccess } from './sourceHealth.js';
import { fetchJisiluQdiiSnapshot } from '../sources/jisiluQdiiProvider.js';
import { fetchLofSnapshot } from '../sources/lofProvider.js';
import { fetchTiantianNav } from '../sources/tiantianSource.js';
import { fetchEastmoneyFundNav } from '../sources/eastmoneyFundNavSource.js';
import { fetchHaoetfQuotes } from '../sources/haoetfSource.js';
import { fetchLof8Estimates } from '../sources/lof8EstimateSource.js';
import { fetchAkshareEstimatedNavs } from '../sources/akshareSource.js';
import { applyOfficialNav, hasCurrentEstimate, mergeEstimateCandidate, parseShanghaiTime } from './navEstimatePolicy.js';

export { mergeEstimateCandidate } from './navEstimatePolicy.js';

const NAV_KEY = 'nav:map';
const LOF_TARGET_SNAPSHOT_KEY = 'nav:lof-target-snapshot';
const TIANTIAN_LIMIT = 24;
const EASTMONEY_OFFICIAL_NAV_RECHECK_MS = 15 * 60_000;
const navInFlight = new Map();
let lofTargetSnapshotInFlight = null;
let lofTargetRetryAfterAt = 0;
let lofTargetRetryReason = '';

export async function getNavMap(quotes, { force = false } = {}) {
  if (!force) {
    const cached = cache.get(NAV_KEY);
    if (cached) return cached;
  }

  const inFlightKey = navRequestKey(quotes);
  if (navInFlight.has(inFlightKey)) return navInFlight.get(inFlightKey);

  const promise = fetchFreshNavMap(quotes, { force }).finally(() => {
    navInFlight.delete(inFlightKey);
  });
  navInFlight.set(inFlightKey, promise);

  return promise;
}

export async function getLofPremiumReferenceMap({ force = false } = {}) {
  const snapshot = await getLofTargetSnapshot({ force });
  return buildLofPremiumReferenceMap(snapshot);
}

export function buildLofPremiumReferenceMap(snapshot = {}) {
  const result = new Map();
  const stale = Boolean(snapshot.stale);
  const fetchedAt = normalizeSnapshotTime(snapshot.scrapedAt);
  for (const row of snapshot.rows || []) {
    const code = normalizeCode(row.code);
    const candidate = selectLofPremiumReference(row);
    if (!code || !candidate) continue;
    result.set(code, {
      code,
      value: candidate.value,
      source: 'lof',
      kind: candidate.kind,
      estimateDate: String(row.estDate || ''),
      quoteTime: normalizeTargetQuoteTime(row.quoteDate, row.quoteTime) || fetchedAt,
      fetchedAt,
      sourcePremiumRate: candidate.premiumRate,
      stale,
    });
  }
  return result;
}

async function getLofTargetSnapshot({ force = false } = {}) {
  if (Date.now() < lofTargetRetryAfterAt) {
    const stale = cache.getStale(LOF_TARGET_SNAPSHOT_KEY, { maxAgeMs: 5 * 60_000 });
    if (stale) return { ...stale, stale: true, error: lofTargetRetryReason };
    throw new Error(lofTargetRetryReason || '目标估值源限流冷却中');
  }
  if (!force) {
    const cached = cache.get(LOF_TARGET_SNAPSHOT_KEY);
    if (cached) return cached;
  }
  if (lofTargetSnapshotInFlight) return lofTargetSnapshotInFlight;

  lofTargetSnapshotInFlight = fetchLofSnapshot()
    .then((snapshot) => {
      lofTargetRetryAfterAt = 0;
      lofTargetRetryReason = '';
      return cache.set(LOF_TARGET_SNAPSHOT_KEY, { ...snapshot, stale: false }, cacheTtl.quotes);
    })
    .catch((error) => {
      const retryAfterMs = Number(error?.retryAfterMs);
      if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
        lofTargetRetryAfterAt = Date.now() + retryAfterMs;
        lofTargetRetryReason = String(error?.message || '目标估值源限流冷却中');
      }
      const stale = cache.getStale(LOF_TARGET_SNAPSHOT_KEY, { maxAgeMs: 5 * 60_000 });
      if (stale) return { ...stale, stale: true, error: String(error?.message || error) };
      throw error;
    })
    .finally(() => {
      lofTargetSnapshotInFlight = null;
    });
  return lofTargetSnapshotInFlight;
}

function selectLofPremiumReference(row) {
  const candidates = [
    { value: firstNumber(row.realtimeEstValue, row.realtimeEst), kind: 'realtime', premiumRate: firstNumber(row.realtimePremiumValue) },
    { value: firstNumber(row.officialEstValue, row.officialEst), kind: 'official-estimate', premiumRate: firstNumber(row.officialPremiumValue) },
    { value: firstNumber(row.referenceEstValue, row.referenceEst), kind: 'reference-estimate', premiumRate: firstNumber(row.referencePremiumValue) },
  ];
  return candidates.find((candidate) => Number.isFinite(candidate.value) && candidate.value > 0) || null;
}

function normalizeTargetQuoteTime(date, time) {
  const safeDate = String(date || '').trim();
  const safeTime = String(time || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(safeDate) || !/^\d{2}:\d{2}(:\d{2})?$/.test(safeTime)) return '';
  return `${safeDate} ${safeTime.length === 5 ? `${safeTime}:00` : safeTime}`;
}

function normalizeSnapshotTime(value) {
  const time = new Date(value || 0);
  return Number.isFinite(time.getTime()) ? formatShanghaiTime(time) : '';
}

export async function getSingleNav(code) {
  const normalizedCode = normalizeCode(code);
  const freshMap = cache.get(NAV_KEY);
  const fresh = freshMap?.get(normalizedCode);
  if (fresh?.lastNav || fresh?.estimatedNav) return fresh;

  const cachedMap = cache.getStale(NAV_KEY) || new Map();
  const cached = cachedMap.get(normalizedCode);
  const startedAt = Date.now();
  const [tiantianResult, eastmoneyResult] = await Promise.allSettled([
    fetchTiantianNav(normalizedCode),
    fetchEastmoneyFundNav(normalizedCode),
  ]);
  recordSingleSourceResult('tiantian', tiantianResult, startedAt);
  recordSingleSourceResult('eastmoney-fund-nav', eastmoneyResult, startedAt);

  const tiantian = tiantianResult.status === 'fulfilled' ? tiantianResult.value : null;
  const eastmoney = eastmoneyResult.status === 'fulfilled'
    ? { ...eastmoneyResult.value, eastmoneyCheckedAt: eastmoneyResult.value.updateTime || '' }
    : null;
  if (!tiantian && !eastmoney) return cached || null;

  const estimatedNav = tiantian?.estimatedNav ?? cached?.estimatedNav ?? null;
  const merged = applyOfficialNav({
    ...(cached || {}),
    ...(tiantian || {}),
    ...(eastmoney || {}),
    code: normalizedCode,
    estimatedNav,
    estimatedNavSource: estimatedNav !== null
      ? tiantian?.estimatedNavSource || tiantian?.navSource || cached?.estimatedNavSource || ''
      : '',
  }, [cached, tiantian, eastmoney]);
  cachedMap.set(normalizedCode, merged);
  cache.set(NAV_KEY, cachedMap, cacheTtl.nav);
  return merged;
}

async function fetchFreshNavMap(quotes, { force = false } = {}) {
  const previous = cache.getStale(NAV_KEY);

  const navMap = new Map();
  if (previous) {
    for (const [code, row] of previous.entries()) navMap.set(code, row);
  }

  await Promise.allSettled([
    loadJisilu(navMap),
    loadLof(navMap, { force }),
    loadHaoetf(navMap, quotes),
    loadLof8(navMap),
    loadAkshareEstimates(navMap, quotes),
  ]);
  await loadTiantian(navMap, selectTiantianCodes(quotes, navMap));
  await loadEastmoneyFundNav(navMap, selectEastmoneyNavCodes(quotes, navMap));

  return cache.set(NAV_KEY, navMap, cacheTtl.nav);
}

async function loadJisilu(navMap) {
  const startedAt = Date.now();
  try {
    const snapshot = await fetchJisiluQdiiSnapshot({ section: 'qdii' });
    for (const row of snapshot.rows || []) {
      const code = normalizeCode(row.code);
      if (!code) continue;
      const estimatedNav = firstNumber(row.realtimeEstValue, row.realtimeEst, row.referenceEstValue, row.referenceEst);
      const existing = navMap.get(code) || {};
      const incoming = {
        code,
        lastNav: firstNumber(row.officialEstValue, row.officialEst),
        estimatedNav,
        navDate: row.estDate || '',
        navQuoteTime: row.navQuoteTime || row.quoteTime || '',
        navSource: 'jisilu',
        estimatedNavSource: estimatedNav !== null ? 'jisilu' : '',
        subscriptionStatus: row.purchaseLimit?.limitText || '',
      };
      navMap.set(code, mergeEstimateCandidate(
        applyOfficialNav({ ...existing, ...incoming }, [existing, incoming]),
        estimatedNav !== null ? { value: estimatedNav, source: 'jisilu', time: row.estimatedNavTime || row.quoteTime || '' } : null,
      ));
    }
    recordSourceSuccess('jisilu', Date.now() - startedAt);
  } catch (error) {
    recordSourceFailure('jisilu', error, Date.now() - startedAt);
  }
}

async function loadLof(navMap, { force = false } = {}) {
  const startedAt = Date.now();
  try {
    const snapshot = await getLofTargetSnapshot({ force });
    for (const row of snapshot.rows || []) {
      const code = normalizeCode(row.code);
      if (!code) continue;
      const existing = navMap.get(code) || {};
      navMap.set(code, mergeLofNavRow(existing, row));
    }
    recordSourceSuccess('lof', Date.now() - startedAt);
  } catch (error) {
    recordSourceFailure('lof', error, Date.now() - startedAt);
  }
}

export function mergeLofNavRow(existing = {}, row = {}) {
  const code = normalizeCode(row.code);
  const estimatedNav = firstNumber(
    row.realtimeEstValue,
    row.realtimeEst,
    row.referenceEstValue,
    row.referenceEst,
    row.officialEstValue,
    row.officialEst,
  );
  const merged = applyOfficialNav({
    ...existing,
    code,
    subscriptionStatus: existing.subscriptionStatus || row.purchaseLimit?.limitText || '',
  }, [existing]);
  return mergeEstimateCandidate(merged, estimatedNav !== null ? {
    value: estimatedNav,
    source: 'lof',
    time: normalizeTargetQuoteTime(row.quoteDate, row.quoteTime),
  } : null);
}

async function loadHaoetf(navMap, quotes = []) {
  const quoteCategories = new Set(quotes
    .map((row) => String(row.category || '').toUpperCase())
    .filter((category) => category === 'LOF' || category === 'QDII' || category === 'ETF'));
  // HaoETF exposes LOF and QDII-LOF through the same table, so fetch it once.
  const categories = [
    ...([...quoteCategories].some((category) => category === 'LOF' || category === 'QDII') ? ['LOF'] : []),
    ...(quoteCategories.has('ETF') ? ['ETF'] : []),
  ];
  if (!categories.length) return;

  const quoteCodes = new Set(quotes.map((row) => normalizeCode(row.code)).filter(Boolean));
  const startedAt = Date.now();
  let success = 0;
  try {
    const snapshots = await Promise.allSettled(categories.map((category) => fetchHaoetfQuotes(category)));
    for (const snapshot of snapshots) {
      if (snapshot.status !== 'fulfilled') continue;
      for (const row of snapshot.value || []) {
        const code = normalizeCode(row.code);
        if (!code || !quoteCodes.has(code)) continue;
        const existing = navMap.get(code) || {};
        const merged = mergeHaoetfNavRow(existing, row);
        navMap.set(code, merged);
        if (merged.estimatedNav !== null || merged.lastNav !== null) success += 1;
      }
    }
    if (!success) throw new Error('HaoETF 未返回匹配的估算净值');
    recordSourceSuccess('haoetf', Date.now() - startedAt);
  } catch (error) {
    recordSourceFailure('haoetf', error, Date.now() - startedAt);
  }
}

export function mergeHaoetfNavRow(existing = {}, row = {}) {
  const code = normalizeCode(row.code);
  const estimatedNav = firstNumber(row.estimatedNav);
  const incomingOfficialNav = {
    lastNav: firstNumber(row.lastNav),
    navDate: row.navDate || '',
    navQuoteTime: row.navQuoteTime || row.quoteTime || '',
    navSource: 'haoetf',
    updateTime: row.updateTime || '',
  };
  const merged = applyOfficialNav({
    ...existing,
    code,
  }, [existing, incomingOfficialNav]);
  return mergeEstimateCandidate(merged, estimatedNav !== null ? {
    value: estimatedNav,
    source: 'haoetf',
    time: row.estimatedNavTime || row.quoteTime || row.navQuoteTime || row.updateTime || '',
  } : null);
}

async function loadLof8(navMap) {
  const startedAt = Date.now();
  try {
    const rows = await fetchLof8Estimates();
    for (const row of rows) {
      const existing = navMap.get(row.code) || {};
      navMap.set(row.code, mergeEstimateCandidate(existing, {
        value: row.estimatedNav,
        source: row.estimatedNavSource,
        time: row.estimatedNavTime,
      }));
    }
    if (!rows.length) throw new Error('LOF8 未返回今日估算净值');
    recordSourceSuccess('lof8-estimate', Date.now() - startedAt);
  } catch (error) {
    recordSourceFailure('lof8-estimate', error, Date.now() - startedAt);
  }
}

async function loadAkshareEstimates(navMap, quotes = []) {
  const startedAt = Date.now();
  try {
    const codes = quotes.map((row) => normalizeCode(row.code)).filter(Boolean);
    const rows = await fetchAkshareEstimatedNavs({ codes });
    for (const row of rows) {
      const existing = navMap.get(row.code) || {};
      navMap.set(row.code, mergeEstimateCandidate(existing, {
        value: row.estimatedNav,
        source: row.estimatedNavSource,
        time: row.estimatedNavTime,
      }));
    }
    if (!rows.length) throw new Error('AKShare 估值上游未返回匹配的今日估算净值');
    recordSourceSuccess('akshare-estimate', Date.now() - startedAt);
  } catch (error) {
    recordSourceFailure('akshare-estimate', error, Date.now() - startedAt);
  }
}

async function loadTiantian(navMap, codes) {
  const startedAt = Date.now();
  let success = 0;
  try {
    for (const group of chunk(codes, 8)) {
      const results = await Promise.allSettled(group.map((code) => fetchTiantianNav(code)));
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const row = result.value;
        const existing = navMap.get(row.code) || {};
        const merged = applyOfficialNav({
          ...existing,
          ...row,
        }, [existing, { ...row, navSource: 'tiantian' }]);
        navMap.set(row.code, mergeEstimateCandidate(merged, row.estimatedNav !== null && row.estimatedNav !== undefined ? {
          value: row.estimatedNav,
          source: 'tiantian',
          time: row.navQuoteTime || row.updateTime || '',
        } : null));
        success += 1;
      }
    }
    if (!success) throw new Error('天天基金未返回有效净值');
    recordSourceSuccess('tiantian', Date.now() - startedAt);
  } catch (error) {
    recordSourceFailure('tiantian', error, Date.now() - startedAt);
  }
}

async function loadEastmoneyFundNav(navMap, codes) {
  if (!codes.length) return;
  const startedAt = Date.now();
  let success = 0;
  try {
    for (const group of chunk(codes, 6)) {
      const results = await Promise.allSettled(group.map((code) => fetchEastmoneyFundNav(code)));
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const row = result.value;
        const existing = navMap.get(row.code) || {};
        navMap.set(row.code, applyOfficialNav({
          ...existing,
          ...row,
          eastmoneyCheckedAt: row.updateTime || existing.eastmoneyCheckedAt || '',
          estimatedNav: existing.estimatedNav ?? row.estimatedNav ?? null,
          estimatedNavSource: existing.estimatedNavSource || (row.estimatedNav !== null && row.estimatedNav !== undefined ? 'eastmoney' : ''),
        }, [existing, { ...row, navSource: 'eastmoney' }]));
        success += 1;
      }
    }
    if (!success) throw new Error('东方财富基金净值未返回有效净值');
    recordSourceSuccess('eastmoney-fund-nav', Date.now() - startedAt);
  } catch (error) {
    recordSourceFailure('eastmoney-fund-nav', error, Date.now() - startedAt);
  }
}

export function selectTiantianCodes(quotes, navMap = new Map()) {
  return quotes
    .filter((row) => row.category === 'QDII' || row.category === 'LOF' || isNasdaqTechnologyQuote(row))
    .filter((row) => !hasCurrentEstimate(navMap.get(normalizeCode(row.code))))
    .sort((left, right) => (right.turnover || 0) - (left.turnover || 0))
    .map((row) => row.code)
    .slice(0, TIANTIAN_LIMIT);
}

export function selectEastmoneyNavCodes(quotes, navMap = new Map(), { now = Date.now() } = {}) {
  return quotes
    .filter((row) => row.category === 'LOF')
    .filter((row) => {
      const code = normalizeCode(row.code);
      const nav = navMap.get(code);
      if (!nav?.lastNav) return true;
      if (!/(eastmoney|tiantian)/i.test(String(nav.navSource || ''))) return true;
      const checkedAt = parseShanghaiTime(nav.eastmoneyCheckedAt);
      return !checkedAt || now - checkedAt >= EASTMONEY_OFFICIAL_NAV_RECHECK_MS;
    })
    .map((row) => normalizeCode(row.code))
    .filter(Boolean);
}

export function isNasdaqTechnologyQuote(row = {}) {
  const text = `${row.code || ''} ${row.name || ''} ${row.fundName || ''} ${row.indexName || ''}`;
  return /纳斯达克|纳指|NASDAQ/i.test(text) || /标普科技/.test(text);
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = toNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function recordSingleSourceResult(source, result, startedAt) {
  const latency = Date.now() - startedAt;
  if (result.status === 'fulfilled') recordSourceSuccess(source, latency);
  else recordSourceFailure(source, result.reason, latency);
}

function navRequestKey(quotes = []) {
  const codes = [...new Set((quotes || []).map((row) => normalizeCode(row.code)).filter(Boolean))].sort();
  return codes.join(',');
}
