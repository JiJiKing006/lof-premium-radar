import { calculatePremium } from './premiumService.js';
import { cache } from './cacheService.js';
import { getNavMap, getSingleNav } from './navService.js';
import { getQuotes } from './quoteService.js';
import { validateFundRecord } from './dataValidator.js';
import { formatShanghaiTime } from './sourceHealth.js';
import { fetchEastmoneyQuoteMap, fetchEastmoneyTrendMap } from '../sources/eastmoneySupplementSource.js';
import { fetchExchangeShareMap } from '../sources/exchangeShareSource.js';
import { fetchSubscriptionLimitMap } from '../sources/subscriptionLimitSource.js';
import { fetchSinaQuoteMap } from '../sources/sinaSupplementSource.js';

const SUPPLEMENT_TIMEOUT_MS = 600;
const SNAPSHOT_RESPONSE_BUDGET_MS = 2_800;
const NAV_SUPPLEMENT_TIMEOUT_MS = 1_600;
const CRITICAL_NAV_WAIT_MS = 18_000;
const SNAPSHOT_CACHE_TTL_MS = 10_000;
const snapshotInFlight = new Map();

export async function getFundQuotes({ category = '', force = false, includeTrends = true } = {}) {
  const normalizedCategory = String(category || 'LOF').toUpperCase();
  const snapshotCacheKey = snapshotKey(normalizedCategory, includeTrends);
  const cached = cache.get(snapshotCacheKey);
  if (!force && cached) return cached;
  if (force && isCompleteSnapshot(cached)) {
    refreshSnapshotInBackground({ normalizedCategory, includeTrends, snapshotCacheKey });
    return markSnapshotRefreshing(cached);
  }
  if (snapshotInFlight.has(snapshotCacheKey)) return snapshotInFlight.get(snapshotCacheKey);

  const promise = buildFundQuotes({ normalizedCategory, force, includeTrends, snapshotCacheKey }).finally(() => {
    snapshotInFlight.delete(snapshotCacheKey);
  });
  snapshotInFlight.set(snapshotCacheKey, promise);
  return promise;
}

function refreshSnapshotInBackground({ normalizedCategory, includeTrends, snapshotCacheKey }) {
  if (snapshotInFlight.has(snapshotCacheKey)) return;
  const promise = buildFundQuotes({ normalizedCategory, force: true, includeTrends, snapshotCacheKey }).finally(() => {
    snapshotInFlight.delete(snapshotCacheKey);
  });
  snapshotInFlight.set(snapshotCacheKey, promise);
  promise.catch(() => {});
}

function markSnapshotRefreshing(snapshot) {
  return {
    ...snapshot,
    meta: {
      ...snapshot.meta,
      stale: true,
      sourceStatus: snapshot.meta.sourceStatus || 'cache',
      status: 'refreshing',
      warn: [snapshot.meta.warn, '后台刷新中，先返回上一份完整快照'].filter(Boolean).join('；'),
    },
  };
}

async function buildFundQuotes({ normalizedCategory, force, includeTrends, snapshotCacheKey }) {
  const startedAt = Date.now();
  const quotePayload = await getQuotes({ category: normalizedCategory, force });
  const updateTime = formatShanghaiTime();
  const codes = quotePayload.rows.map((quote) => quote.code);
  const navPromise = getNavMap(quotePayload.rows, { force: false });
  const remainingMs = Math.max(0, SNAPSHOT_RESPONSE_BUDGET_MS - (Date.now() - startedAt));
  const supplementTimeoutMs = Math.min(SUPPLEMENT_TIMEOUT_MS, remainingMs);
  const navTimeoutMs = Math.min(navTimeoutForCategory(normalizedCategory), remainingMs);
  const [navResult, eastmoneyQuoteResult, sinaQuoteResult, subscriptionLimitResult, trendResult, exchangeShareResult] = await Promise.all([
    withMapTimeout(navPromise, navTimeoutMs, 'nav'),
    withMapTimeout(fetchEastmoneyQuoteMap(codes, { force }), supplementTimeoutMs, 'eastmoney-quote'),
    withMapTimeout(fetchSinaQuoteMap(codes, { force }), supplementTimeoutMs, 'sina-quote'),
    withMapTimeout(fetchSubscriptionLimitMap(codes, { force }), supplementTimeoutMs, 'subscription-limit'),
    includeTrends ? withMapTimeout(fetchEastmoneyTrendMap(codes, { force }), supplementTimeoutMs, 'trend') : Promise.resolve(mapResult(new Map(), 'trend')),
    withMapTimeout(fetchExchangeShareMap(codes, { force }), supplementTimeoutMs, 'exchange-share'),
  ]);
  let navMap = navResult.map;
  const eastmoneyQuoteMap = eastmoneyQuoteResult.map;
  const sinaQuoteMap = sinaQuoteResult.map;
  const subscriptionLimitMap = subscriptionLimitResult.map;
  const trendMap = trendResult.map;
  const exchangeShareMap = exchangeShareResult.map;
  const supplementResults = [
    navResult,
    eastmoneyQuoteResult,
    sinaQuoteResult,
    subscriptionLimitResult,
    trendResult,
    exchangeShareResult,
  ];
  let supplementWarnings = supplementResults
    .filter((result) => result.timedOut)
    .map((result) => `${result.label} supplemental data timed out`);
  const marketQuoteMap = mergeMarketQuoteMaps(eastmoneyQuoteMap, sinaQuoteMap);
  let rows = buildUnifiedRows({
    quoteRows: quotePayload.rows,
    navMap,
    updateTime,
    marketQuoteMap,
    subscriptionLimitMap,
    trendMap,
    exchangeShareMap,
  });
  let dedupedRows = dedupeFundsByCodePriority(rows);
  let filtered = filterRenderablePremiumRows(
    normalizedCategory === 'ALL' ? dedupedRows : dedupedRows.filter((row) => row.category === normalizedCategory),
    normalizedCategory,
  );

  const incompleteCriticalRows = findIncompleteCriticalRows(filtered);
  if (navResult.timedOut && incompleteCriticalRows.length) {
    const waitedNavResult = await withMapTimeout(navPromise, CRITICAL_NAV_WAIT_MS, 'critical-nav');
    if (waitedNavResult.map.size) {
      navMap = waitedNavResult.map;
      rows = buildUnifiedRows({
        quoteRows: quotePayload.rows,
        navMap,
        updateTime,
        marketQuoteMap,
        subscriptionLimitMap,
        trendMap,
        exchangeShareMap,
      });
      dedupedRows = dedupeFundsByCodePriority(rows);
      filtered = filterRenderablePremiumRows(
        normalizedCategory === 'ALL' ? dedupedRows : dedupedRows.filter((row) => row.category === normalizedCategory),
        normalizedCategory,
      );
      supplementWarnings = supplementWarnings.filter((warning) => !warning.startsWith('nav '));
    }
    if (waitedNavResult.timedOut) {
      supplementWarnings.push('critical NAV wait timed out');
    }
  }

  const incompleteAfterCriticalWait = findIncompleteCriticalRows(filtered);
  if (incompleteAfterCriticalWait.length) {
    supplementWarnings.push(
      `hidden incomplete critical rows: ${incompleteAfterCriticalWait.map((row) => row.code).slice(0, 20).join(',')}`,
    );
    filtered = filtered.filter((row) => !isIncompleteCriticalRow(row));
  }

  const snapshot = {
    meta: {
      sourceId: 'fund-aggregator',
      sourceTitle: '基金实时行情与溢价聚合',
      sourceProvider: quotePayload.source,
      sourceStatus: quotePayload.sourceStatus,
      rowCount: filtered.length,
      allCount: dedupedRows.length,
      warn: [...(quotePayload.errors || []), ...supplementWarnings].join('；'),
      latestQuoteTime: latestQuoteTime(filtered),
      updateTime,
      status: 'ok',
      stale: quotePayload.sourceStatus === 'cache' || quotePayload.sourceStatus === 'error',
      trendsIncluded: includeTrends,
    },
    rows: filtered,
  };

  return cache.set(snapshotCacheKey, snapshot, SNAPSHOT_CACHE_TTL_MS);
}

function buildUnifiedRows({
  quoteRows,
  navMap,
  updateTime,
  marketQuoteMap,
  subscriptionLimitMap,
  trendMap,
  exchangeShareMap,
}) {
  return quoteRows.map((quote) =>
    toUnifiedFund({
      quote,
      nav: navMap.get(quote.code),
      updateTime,
      marketQuote: marketQuoteMap.get(quote.code),
      subscriptionLimit: subscriptionLimitMap.get(quote.code),
      trend: trendMap.get(quote.code),
      exchangeShare: exchangeShareMap.get(quote.code),
    }),
  );
}

export function dedupeFundsByCodePriority(rows) {
  const byCode = new Map();
  rows.forEach((row) => {
    const code = normalizeFundCode(row.code);
    if (!code) return;
    const existing = byCode.get(code);
    if (!existing || categoryRank(row.category) < categoryRank(existing.category)) {
      byCode.set(code, row);
    }
  });
  return [...byCode.values()];
}

export function filterRenderablePremiumRows(rows, category = '') {
  const normalizedCategory = String(category || '').toUpperCase();
  return rows.filter((row) => {
    if (normalizedCategory === 'LOF' && row.category === 'LOF') return true;
    if (Number.isFinite(row.premiumRate)) return true;
    return false;
  });
}

export function mergeMarketQuoteMaps(primaryMap = new Map(), fallbackMap = new Map()) {
  const merged = new Map(primaryMap);
  for (const [code, fallback] of fallbackMap.entries()) {
    const primary = merged.get(code);
    if (!hasUsableMarketPrice(primary) && hasUsableMarketPrice(fallback)) {
      merged.set(code, fallback);
    }
  }
  return merged;
}

export async function getFundList({ category = '', force = false } = {}) {
  const snapshot = await getFundQuotes({ category, force });
  return {
    meta: snapshot.meta,
    rows: snapshot.rows.map(({ code, name, category, source, sourceStatus, quoteTime, updateTime, isAbnormal, abnormalReason }) => ({
      code,
      name,
      category,
      source,
      sourceStatus,
      quoteTime,
      updateTime,
      isAbnormal,
      abnormalReason,
    })),
  };
}

export async function getFundDetail(code, options = {}) {
  const normalizedCode = String(code).replace(/^(SZ|SH)/i, '');
  const categories = options.category ? [options.category] : ['LOF', 'QDII', 'ETF'];
  let fund = null;
  for (const category of categories) {
    const snapshot = await getFundQuotes({ ...options, category, includeTrends: false });
    fund = snapshot.rows.find((row) => row.code === normalizedCode);
    if (fund) break;
  }
  if (!fund) return null;
  if (fund.lastNav || fund.estimatedNav) return fund;

  const nav = await getSingleNav(normalizedCode);
  if (!nav) return fund;
  return toUnifiedFund({ quote: fund, nav, updateTime: formatShanghaiTime() });
}

export function toUnifiedFund({ quote, nav, updateTime, marketQuote, subscriptionLimit, trend, exchangeShare }) {
  const intraday = trend?.points || [];
  const marketPrice = firstPositiveNumber(marketQuote?.marketPrice, quote.marketPrice);
  const changeRate = marketQuote?.changeRate ?? quote.changeRate;
  const volume = marketQuote?.volume ?? quote.volume;
  const turnover = marketQuote?.turnover ?? quote.turnover;
  const quoteTime = marketQuote?.quoteTime || quote.quoteTime || nav?.navQuoteTime || '';
  const quoteSource = marketQuote?.source || quote.source;
  const displaySource = marketQuote?.source || quote.source;
  const verifiedShare = exchangeShare || (isExchangeShareSource(quote.shareSource) ? quote : null);
  const premium = calculatePremium({
    marketPrice,
    estimatedNav: quote.estimatedNav,
    estimatedNavSource: quote.navSource || quote.source,
    estimatedNavTime: quote.navQuoteTime || quote.quoteTime || '',
    supplementalEstimatedNav: nav?.estimatedNav,
    supplementalNavSource: nav?.estimatedNavSource || nav?.navSource || '',
    supplementalNavTime: nav?.navQuoteTime || '',
    lastNav: quote.lastNav ?? nav?.lastNav,
  });
  const record = {
    code: quote.code,
    name: quote.name,
    category: quote.category,
    marketPrice,
    lastNav: quote.lastNav ?? nav?.lastNav ?? null,
    estimatedNav: premium.estimatedNav ?? null,
    premiumRate: premium.premiumRate,
    premiumBasis: premium.basis,
    premiumNote: premium.note,
    estimatedNavSource: premium.selectedNavSource,
    estimatedNavTime: premium.selectedNavTime,
    estimateConfidence: premium.estimateConfidence,
    estimateDeviationRate: premium.estimateDeviationRate,
    estimateWarning: premium.estimateWarning,
    estimateSources: premium.estimateSources,
    changeRate,
    volume,
    turnover,
    shareAmount: verifiedShare?.shareAmount || '',
    shareChange: verifiedShare?.shareChange || '',
    shareSource: verifiedShare?.shareSource || '',
    shareTime: verifiedShare?.shareTime || '',
    purchaseLimit: subscriptionLimit || quote.purchaseLimit || { state: 'unknown', label: '未知' },
    source: displaySource,
    quoteSource,
    subscriptionSource: subscriptionLimit?.source || '',
    trendSource: trend?.source || '',
    navSource: nav?.navSource || '',
    sourceStatus: quote.sourceStatus,
    dataStatus: quote.dataStatus || '',
    referenceSource: quote.referenceSource || '',
    quoteTime,
    updateTime,
    isRealtime: Boolean(quoteTime && quote.sourceStatus !== 'cache'),
    isAbnormal: false,
    abnormalReason: '',
    navDate: quote.navDate || nav?.navDate || '',
    navQuoteTime: quote.navQuoteTime || nav?.navQuoteTime || '',
    market: quote.market || '',
    intraday,
  };
  const validation = validateFundRecord(record);
  return { ...record, ...validation };
}

function isExchangeShareSource(source) {
  return /^(sse|szse)$/i.test(String(source || ''));
}

function hasUsableMarketPrice(row) {
  const price = Number(row?.marketPrice);
  return Number.isFinite(price) && price > 0;
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function findIncompleteCriticalRows(rows) {
  return rows.filter(isIncompleteCriticalRow);
}

function isIncompleteCriticalRow(row) {
  if (!hasUsableMarketPrice(row)) return false;
  if (row.dataStatus === 'missing_quote' || row.sourceStatus === 'missing') return false;
  return !hasUsableNav(row) || !Number.isFinite(Number(row.premiumRate));
}

function isCompleteSnapshot(snapshot) {
  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  return rows.length > 0 && !findIncompleteCriticalRows(rows).length;
}

function hasUsableNav(row) {
  const nav = Number(row?.lastNav);
  return Number.isFinite(nav) && nav > 0;
}

function withMapTimeout(promise, timeoutMs, label = 'source') {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ map: new Map(), timedOut: true, label }), timeoutMs);
  });
  const guarded = promise.then(
    (value) => {
      clearTimeout(timer);
      return mapResult(value, label);
    },
    () => {
      clearTimeout(timer);
      return mapResult(new Map(), label);
    },
  );
  return Promise.race([guarded, timeout]);
}

function mapResult(value, label) {
  return {
    map: value instanceof Map ? value : new Map(),
    timedOut: false,
    label,
  };
}

function latestQuoteTime(rows) {
  return rows
    .map((row) => row.quoteTime)
    .filter(Boolean)
    .sort()
    .at(-1) || '';
}

function normalizeFundCode(code) {
  return String(code || '').replace(/^(SZ|SH)/i, '').trim();
}

function categoryRank(category) {
  const text = String(category || '').toUpperCase();
  if (text === 'LOF') return 0;
  if (text === 'QDII') return 1;
  if (text === 'ETF') return 2;
  return 99;
}

function snapshotKey(category, includeTrends) {
  return `fund-quotes:snapshot:${category}:trends:${includeTrends ? '1' : '0'}`;
}

function navTimeoutForCategory(category) {
  return NAV_SUPPLEMENT_TIMEOUT_MS;
}
