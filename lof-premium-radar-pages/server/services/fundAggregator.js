import fs from 'node:fs';
import path from 'node:path';
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

const SUPPLEMENT_TIMEOUT_MS = 180;
const SNAPSHOT_RESPONSE_BUDGET_MS = 900;
const NAV_SUPPLEMENT_TIMEOUT_MS = 300;
const SNAPSHOT_CACHE_TTL_MS = 30_000;
const PARTIAL_SNAPSHOT_CACHE_TTL_MS = 5_000;
const COMPLETE_SNAPSHOT_MAX_STALE_MS = 5 * 60_000;
const HOME_CATEGORIES = ['LOF', 'QDII', 'ETF'];
const MIN_COMPLETE_ROWS = { ALL: 120, LOF: 80, QDII: 20, ETF: 10 };
const snapshotInFlight = new Map();
const persistentSnapshotFile = String(process.env.FUND_SNAPSHOT_FILE || '').trim();
let persistentSnapshotPayload = { version: 1, snapshots: {} };
let persistentWriteChain = Promise.resolve();
const VERIFIED_T3_CODES = new Map([
  [
    '160644',
    {
      settlementCycle: 'T+3',
      marketRegion: 'overseas',
      source: '鹏华基金/东方财富基金档案：港美互联网LOF为QDII跨境基金',
    },
  ],
]);
const HOME_LIST_FIELDS = [
  'code',
  'fundCode',
  'name',
  'fundName',
  'category',
  'fundType',
  'marketPrice',
  'price',
  'changeRate',
  'lastNav',
  'nav',
  'navDate',
  'navQuoteTime',
  'estimatedNav',
  'premiumRate',
  'discountRate',
  'premiumBasis',
  'premiumNote',
  'estimatedNavSource',
  'estimatedNavTime',
  'estimateConfidence',
  'estimateDeviationRate',
  'estimateWarning',
  'volume',
  'turnover',
  'purchaseLimit',
  'source',
  'quoteSource',
  'subscriptionSource',
  'subscriptionTime',
  'navSource',
  'sourceStatus',
  'dataStatus',
  'quoteTime',
  'updateTime',
  'isRealtime',
  'isAbnormal',
  'abnormalReason',
  'market',
  'marketRegion',
  'settlementCycle',
  'settlementRuleSource',
  'showEstimatedNav',
  'snapshotCarriedForward',
  'valuationCarriedForward',
  'carriedForwardFields',
  'purchaseStatusCarriedForward',
];

export async function getFundQuotes({ category = '', force = false, includeTrends = true, waitForFresh = false } = {}) {
  const normalizedCategory = normalizeSnapshotCategory(category);
  const snapshotCacheKey = snapshotKey(normalizedCategory, includeTrends);
  const cached = cache.get(snapshotCacheKey);
  if (!force && cached) return cached;
  const staleCompleteSnapshot = cache.getStale(snapshotCacheKey, { maxAgeMs: COMPLETE_SNAPSHOT_MAX_STALE_MS });
  const observedSnapshot = cache.getObserved(snapshotCacheKey, { maxAgeMs: COMPLETE_SNAPSHOT_MAX_STALE_MS });
  const reusableSnapshot = isDisplayStableSnapshot(staleCompleteSnapshot, normalizedCategory)
    ? staleCompleteSnapshot
    : isReusableObservedSnapshot(observedSnapshot, normalizedCategory)
      ? observedSnapshot
      : null;
  if (!force && reusableSnapshot) {
    refreshSnapshotInBackground({ normalizedCategory, includeTrends, snapshotCacheKey });
    return markSnapshotRefreshing(reusableSnapshot);
  }
  if (force && !waitForFresh && (cached?.rows?.length || reusableSnapshot)) {
    refreshSnapshotInBackground({ normalizedCategory, includeTrends, snapshotCacheKey });
    return markSnapshotRefreshing(cached || reusableSnapshot);
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
      warn: [snapshot.meta.warn, '后台刷新中，先返回上一份已展示快照'].filter(Boolean).join('；'),
    },
  };
}

async function buildFundQuotes({ normalizedCategory, force, includeTrends, snapshotCacheKey }) {
  const startedAt = Date.now();
  const previousSnapshot = cache.getStale(snapshotCacheKey, { maxAgeMs: COMPLETE_SNAPSHOT_MAX_STALE_MS });
  const responseBudgetMs = SNAPSHOT_RESPONSE_BUDGET_MS;
  const baseSupplementTimeoutMs = SUPPLEMENT_TIMEOUT_MS;
  const baseNavTimeoutMs = navTimeoutForCategory(normalizedCategory);
  const quotePayload = await getQuotePayload({ category: normalizedCategory, force });
  const updateTime = formatShanghaiTime();
  const codes = quotePayload.rows.map((quote) => quote.code);
  const navPromise = getNavMap(quotePayload.rows, { force: false });
  const subscriptionLimitPromise = fetchSubscriptionLimitMap(codes, { force });
  const remainingMs = Math.max(0, responseBudgetMs - (Date.now() - startedAt));
  const supplementTimeoutMs = Math.min(baseSupplementTimeoutMs, remainingMs);
  const navTimeoutMs = Math.min(baseNavTimeoutMs, remainingMs);
  const [navResult, eastmoneyQuoteResult, sinaQuoteResult, subscriptionLimitResult, trendResult, exchangeShareResult] = await Promise.all([
    withMapTimeout(navPromise, navTimeoutMs, 'nav'),
    withMapTimeout(fetchEastmoneyQuoteMap(codes, { force }), supplementTimeoutMs, 'eastmoney-quote'),
    withMapTimeout(fetchSinaQuoteMap(codes, { force }), supplementTimeoutMs, 'sina-quote'),
    withMapTimeout(subscriptionLimitPromise, supplementTimeoutMs, 'subscription-limit'),
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
  rows = mergeStableFinancialFields(previousSnapshot?.rows, rows);
  let dedupedRows = dedupeFundsByCodePriority(rows);
  let filtered = filterDisplayRows(dedupedRows, normalizedCategory);

  const incompleteAfterCriticalWait = findIncompleteCriticalRows(filtered);
  if (incompleteAfterCriticalWait.length) {
    supplementWarnings.push(
      `critical fields pending: ${incompleteAfterCriticalWait.map((row) => row.code).slice(0, 20).join(',')}`,
    );
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

  const stableSnapshot = stabilizeSnapshotPurchaseStatuses(snapshot, previousSnapshot);
  const guardedSnapshot = protectSnapshotConsistency(stableSnapshot, normalizedCategory, snapshotCacheKey);
  const isStable = isDisplayStableSnapshot(guardedSnapshot, normalizedCategory);
  const cacheTtl = isStable ? SNAPSHOT_CACHE_TTL_MS : PARTIAL_SNAPSHOT_CACHE_TTL_MS;
  const storedSnapshot = isStable
    ? cache.set(snapshotCacheKey, guardedSnapshot, cacheTtl)
    : cache.setTransient(snapshotCacheKey, guardedSnapshot, cacheTtl);
  if (isStable) persistFundSnapshot(snapshotCacheKey, storedSnapshot);
  if (subscriptionLimitResult.timedOut) {
    completePurchaseStatusesInBackground(subscriptionLimitPromise, snapshotCacheKey, cacheTtl, normalizedCategory);
  }
  if (navResult.timedOut) {
    completeNavInBackground(navPromise, snapshotCacheKey, cacheTtl, normalizedCategory);
  }
  return storedSnapshot;
}

function completeNavInBackground(promise, snapshotCacheKey, ttlMs, category) {
  promise.then((navMap) => {
    if (!(navMap instanceof Map) || !navMap.size) return;
    const current = cache.get(snapshotCacheKey) || cache.getStale(snapshotCacheKey, { maxAgeMs: COMPLETE_SNAPSHOT_MAX_STALE_MS });
    if (!current?.rows?.length) return;
    const updateTime = formatShanghaiTime();
    const rows = current.rows.map((row) => {
      const nav = navMap.get(normalizeFundCode(row.code));
      if (!nav) return row;
      return toUnifiedFund({
        quote: row,
        nav,
        updateTime,
        marketQuote: row,
        subscriptionLimit: row.purchaseLimit,
        trend: { points: row.intraday || [], source: row.trendSource || '' },
        exchangeShare: isExchangeShareSource(row.shareSource) ? row : undefined,
      });
    });
    const completed = stabilizeSnapshotPurchaseStatuses({
      ...current,
      meta: {
        ...(current.meta || {}),
        updateTime,
        warn: [current.meta?.warn, '官方净值已异步补齐'].filter(Boolean).join('；'),
      },
      rows,
    }, current);
    if (isDisplayStableSnapshot(completed, category)) {
      cache.set(snapshotCacheKey, completed, ttlMs);
      persistFundSnapshot(snapshotCacheKey, completed);
    } else cache.setTransient(snapshotCacheKey, completed, ttlMs);
  }).catch(() => {});
}

function completePurchaseStatusesInBackground(promise, snapshotCacheKey, ttlMs, category) {
  promise.then((purchaseMap) => {
    if (!(purchaseMap instanceof Map) || !purchaseMap.size) return;
    const current = cache.get(snapshotCacheKey) || cache.getStale(snapshotCacheKey, { maxAgeMs: COMPLETE_SNAPSHOT_MAX_STALE_MS });
    if (!current?.rows?.length) return;
    let changed = 0;
    const rows = current.rows.map((row) => {
      const incoming = purchaseMap.get(normalizeFundCode(row.code));
      if (!hasUsablePurchaseLimit(incoming)) return row;
      const selected = selectPurchaseLimit(incoming, row.purchaseLimit);
      if (hasUsablePurchaseLimit(row.purchaseLimit) && row.purchaseLimit.label === selected.label) return row;
      changed += 1;
      return {
        ...row,
        purchaseLimit: selected,
        subscriptionSource: selected.source || row.subscriptionSource || '',
        subscriptionTime: selected.updateTime || row.subscriptionTime || '',
        purchaseStatusCarriedForward: false,
      };
    });
    if (!changed) return;
    const completed = {
      ...current,
      meta: {
        ...(current.meta || {}),
        warn: [current.meta?.warn, `${changed} 条申购状态已异步补齐`].filter(Boolean).join('；'),
      },
      rows,
    };
    if (isDisplayStableSnapshot(completed, category)) {
      cache.set(snapshotCacheKey, completed, ttlMs);
      persistFundSnapshot(snapshotCacheKey, completed);
    } else cache.setTransient(snapshotCacheKey, completed, ttlMs);
  }).catch(() => {});
}

export function hydratePersistentFundSnapshots() {
  if (!persistentSnapshotFile) return 0;
  try {
    const payload = JSON.parse(fs.readFileSync(persistentSnapshotFile, 'utf8'));
    const snapshots = payload?.snapshots && typeof payload.snapshots === 'object' ? payload.snapshots : {};
    let count = 0;
    persistentSnapshotPayload = { version: 1, savedAt: payload.savedAt || '', snapshots: {} };
    for (const [key, snapshot] of Object.entries(snapshots)) {
      if (!snapshot?.rows?.length) continue;
      const carried = markPersistentSnapshot(snapshot);
      persistentSnapshotPayload.snapshots[key] = snapshot;
      cache.set(key, carried, 1);
      count += 1;
    }
    return count;
  } catch {
    return 0;
  }
}

function markPersistentSnapshot(snapshot) {
  return {
    ...snapshot,
    meta: {
      ...(snapshot.meta || {}),
      stale: true,
      status: 'persistent-cache',
      sourceStatus: 'cache',
      warn: [snapshot.meta?.warn, '服务重启后先返回上一份已验证快照，后台刷新中'].filter(Boolean).join('；'),
    },
    rows: snapshot.rows.map((row) => ({
      ...row,
      sourceStatus: 'cache',
      isRealtime: false,
      snapshotCarriedForward: true,
    })),
  };
}

function persistFundSnapshot(key, snapshot) {
  if (!persistentSnapshotFile || !snapshot?.rows?.length) return;
  persistentSnapshotPayload = {
    version: 1,
    savedAt: formatShanghaiTime(),
    snapshots: {
      ...(persistentSnapshotPayload.snapshots || {}),
      [key]: snapshot,
    },
  };
  persistentWriteChain = persistentWriteChain.then(async () => {
    const directory = path.dirname(persistentSnapshotFile);
    const temporary = `${persistentSnapshotFile}.${process.pid}.tmp`;
    await fs.promises.mkdir(directory, { recursive: true });
    await fs.promises.writeFile(temporary, JSON.stringify(persistentSnapshotPayload), 'utf8');
    await fs.promises.rename(temporary, persistentSnapshotFile);
  }).catch(() => {});
}

async function getQuotePayload({ category, force }) {
  if (category !== 'ALL') return getQuotes({ category, force });
  const payloads = await Promise.all(HOME_CATEGORIES.map((item) => getQuotes({ category: item, force })));
  return {
    rows: payloads.flatMap((payload) => payload.rows || []),
    source: payloads.map((payload, index) => `${HOME_CATEGORIES[index]}:${payload.source || 'unknown'}`).join(' / '),
    sourceStatus: payloads.some((payload) => payload.sourceStatus === 'error')
      ? 'fallback'
      : payloads.some((payload) => payload.sourceStatus === 'cache')
        ? 'cache'
        : 'primary',
    hasNav: payloads.some((payload) => payload.hasNav),
    errors: payloads.flatMap((payload) => payload.errors || []),
  };
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
    if (!existing) {
      byCode.set(code, row);
      return;
    }
    const preferred = dedupeRank(row) < dedupeRank(existing) ? row : existing;
    const alternate = preferred === row ? existing : row;
    byCode.set(code, mergeComplementaryFundFields(preferred, alternate));
  });
  return [...byCode.values()];
}

function mergeComplementaryFundFields(preferred, alternate) {
  if (hasUsablePurchaseLimit(preferred.purchaseLimit) || !hasUsablePurchaseLimit(alternate.purchaseLimit)) {
    return preferred;
  }
  return {
    ...preferred,
    purchaseLimit: alternate.purchaseLimit,
    subscriptionSource: alternate.subscriptionSource || alternate.purchaseLimit.source || '',
    subscriptionTime: alternate.subscriptionTime || alternate.purchaseLimit.updateTime || '',
  };
}

export function filterRenderablePremiumRows(rows, category = '') {
  const normalizedCategory = String(category || '').toUpperCase();
  return rows.filter((row) => {
    if (['LOF', 'QDII', 'ETF'].includes(normalizedCategory) && row.category !== normalizedCategory) return false;
    if (!normalizedCategory) return Number.isFinite(row.premiumRate);
    return Boolean(normalizeFundCode(row.code || row.fundCode));
  });
}

function filterDisplayRows(rows, normalizedCategory) {
  return filterRenderablePremiumRows(
    normalizedCategory === 'ALL' ? rows : rows.filter((row) => row.category === normalizedCategory),
    normalizedCategory,
  );
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

export function getFundQuotePage({ category = '', includeTrends = false } = {}) {
  const normalizedCategory = normalizeSnapshotCategory(category);
  const key = snapshotKey(normalizedCategory, includeTrends);
  const snapshot = cache.get(key)
    || cache.getObserved(key, { maxAgeMs: COMPLETE_SNAPSHOT_MAX_STALE_MS })
    || cache.getStale(key, { maxAgeMs: COMPLETE_SNAPSHOT_MAX_STALE_MS });
  if (!snapshot) {
    const error = new Error('分页快照尚未就绪，请先刷新首页数据');
    error.code = 'PAGE_SNAPSHOT_NOT_READY';
    throw error;
  }
  return snapshot;
}

export function formatFundQuoteResponse(snapshot, options = {}) {
  const sourceRows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  const filteredRows = applyListQuery(sourceRows, options);
  const sortedRows = sortListRows(filteredRows, options.sortKey, options.sortDirection);
  const pagination = paginateRows(sortedRows, options);
  const rows = shouldUseHomeFields(options)
    ? pagination.rows.map(projectHomeListRow)
    : pagination.rows;

  return {
    meta: {
      ...(snapshot.meta || {}),
      rowCount: rows.length,
      filteredCount: sortedRows.length,
      totalCount: sortedRows.length,
      allCount: snapshot?.meta?.allCount ?? sourceRows.length,
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: sortedRows.length,
        totalPages: pagination.totalPages,
        hasMore: pagination.hasMore,
      },
    },
    rows,
  };
}

export async function getFundDetail(code, options = {}) {
  const normalizedCode = String(code).replace(/^(SZ|SH)/i, '');
  const cachedFund = findFundInCachedSnapshots(normalizedCode, options.category);
  if (cachedFund) {
    if (options.force) refreshFundDetailInBackground(normalizedCode, options);
    return cachedFund;
  }
  return loadFundDetail(normalizedCode, options);
}

async function loadFundDetail(normalizedCode, options = {}) {
  const categories = options.category && String(options.category).toUpperCase() !== 'ALL' ? [options.category] : HOME_CATEGORIES;
  let fund = null;
  for (const category of categories) {
    const snapshot = await getFundQuotes({ ...options, category, includeTrends: false });
    fund = snapshot.rows.find((row) => row.code === normalizedCode);
    if (fund) break;
  }
  if (!fund && categories.length !== HOME_CATEGORIES.length) {
    const snapshot = await getFundQuotes({ ...options, category: 'ALL', includeTrends: false });
    fund = snapshot.rows.find((row) => row.code === normalizedCode);
  }
  if (!fund) return null;
  if (fund.lastNav || fund.estimatedNav) return fund;

  const nav = await getSingleNav(normalizedCode);
  if (!nav) return fund;
  return toUnifiedFund({ quote: fund, nav, updateTime: formatShanghaiTime() });
}

function findFundInCachedSnapshots(code, category = '') {
  const requestedCategory = normalizeSnapshotCategory(category);
  const categories = requestedCategory === 'ALL'
    ? ['ALL', ...HOME_CATEGORIES]
    : [requestedCategory, 'ALL', ...HOME_CATEGORIES.filter((item) => item !== requestedCategory)];
  for (const item of categories) {
    for (const includeTrends of [false, true]) {
      const key = snapshotKey(item, includeTrends);
      const snapshot = cache.get(key) || cache.getStale(key, { maxAgeMs: COMPLETE_SNAPSHOT_MAX_STALE_MS });
      const fund = snapshot?.rows?.find((row) => normalizeFundCode(row.code) === code);
      if (fund) return fund;
    }
  }
  return null;
}

function refreshFundDetailInBackground(code, options) {
  loadFundDetail(code, { ...options, force: true }).catch(() => {});
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
  const market = quote.market || '';
  const marketRegion = inferMarketRegion({ ...quote, market });
  const settlementRule = inferSettlementRule({ ...quote, market }, marketRegion);
  const settlementCycle = settlementRule.settlementCycle;
  const showEstimatedNav = settlementCycle === 'T+3';
  const selectedPurchaseLimit = selectPurchaseLimit(subscriptionLimit, quote.purchaseLimit);
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
    fundCode: quote.code,
    name: quote.name,
    fundName: quote.name,
    category: quote.category,
    fundType: quote.category,
    marketPrice,
    price: marketPrice,
    lastNav: quote.lastNav ?? nav?.lastNav ?? null,
    nav: quote.lastNav ?? nav?.lastNav ?? null,
    estimatedNav: premium.estimatedNav ?? null,
    premiumRate: premium.premiumRate,
    discountRate: Number.isFinite(Number(premium.premiumRate)) && Number(premium.premiumRate) < 0 ? Math.abs(Number(premium.premiumRate)) : null,
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
    purchaseLimit: selectedPurchaseLimit,
    source: displaySource,
    quoteSource,
    subscriptionSource: selectedPurchaseLimit.source || quote.subscriptionSource || '',
    subscriptionTime: selectedPurchaseLimit.updateTime || quote.subscriptionTime || '',
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
    market,
    marketRegion: settlementRule.marketRegion || marketRegion,
    settlementCycle,
    settlementRuleSource: settlementRule.source || '',
    showEstimatedNav,
    intraday,
  };
  const validation = validateFundRecord(record);
  return { ...record, ...validation };
}

function selectPurchaseLimit(...candidates) {
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const label = String(candidate.label || candidate.limitText || candidate.status || candidate.purchaseStatus || '').trim();
    if (!label || /^(未知|暂无数据|--|-|N\/A)$/i.test(label)) continue;
    const unlimited = isUnlimitedPurchaseLimit(candidate, label);
    const normalizedState = unlimited ? 'open' : normalizePurchaseState(candidate.state, label);
    const compactLabel = unlimited ? '不限额' : compactPurchaseLimitLabel(candidate, label, normalizedState);
    return {
      ...candidate,
      state: normalizedState,
      label: compactLabel,
      limitText: compactLabel,
    };
  }
  return { state: 'unavailable', label: '暂无数据', limitText: '暂无数据', source: '', updateTime: '' };
}

function isUnlimitedPurchaseLimit(candidate, label) {
  const amount = Number(candidate.dailyLimit);
  const hasAmount = candidate.dailyLimit !== null && candidate.dailyLimit !== undefined && candidate.dailyLimit !== '';
  return /不限额|无限额/.test(label) || (hasAmount && Number.isFinite(amount) && amount >= 800_000_000);
}

function compactPurchaseLimitLabel(candidate, label, state) {
  if (state !== 'limited' && !/限|大额/.test(label)) return label;
  const hasExplicitAmount = candidate.dailyLimit !== null && candidate.dailyLimit !== undefined && candidate.dailyLimit !== '';
  const explicitAmount = Number(candidate.dailyLimit);
  if (hasExplicitAmount && Number.isFinite(explicitAmount) && explicitAmount >= 0) return `限${formatPurchaseAmount(explicitAmount)}`;
  const match = String(label).match(/(\d+(?:\.\d+)?)\s*(亿|万|元)/);
  if (!match) return '限额';
  const unitScale = match[2] === '亿' ? 100_000_000 : match[2] === '万' ? 10_000 : 1;
  return `限${formatPurchaseAmount(Number(match[1]) * unitScale)}`;
}

function formatPurchaseAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return '额';
  if (amount > 10_000) return `${trimPurchaseNumber(amount / 10_000)}万`;
  return `${trimPurchaseNumber(amount)}元`;
}

function trimPurchaseNumber(value) {
  return Number(Number(value).toFixed(2)).toString();
}

export function mergeStablePurchaseStatuses(previousRows, incomingRows) {
  const previousByCode = new Map((Array.isArray(previousRows) ? previousRows : [])
    .map((row) => [normalizeFundCode(row?.code || row?.fundCode), row])
    .filter(([code]) => code));

  return (Array.isArray(incomingRows) ? incomingRows : []).map((row) => {
    if (hasUsablePurchaseLimit(row?.purchaseLimit)) return row;
    const previous = previousByCode.get(normalizeFundCode(row?.code || row?.fundCode));
    if (!hasUsablePurchaseLimit(previous?.purchaseLimit)) return row;
    const purchaseLimit = { ...previous.purchaseLimit, carriedForward: true };
    return {
      ...row,
      purchaseLimit,
      subscriptionSource: previous.subscriptionSource || purchaseLimit.source || '',
      subscriptionTime: previous.subscriptionTime || purchaseLimit.updateTime || '',
      purchaseStatusCarriedForward: true,
    };
  });
}

export function mergeStableFinancialFields(previousRows, incomingRows) {
  const previousByCode = new Map((Array.isArray(previousRows) ? previousRows : [])
    .map((row) => [normalizeFundCode(row?.code || row?.fundCode), row])
    .filter(([code]) => code));

  return (Array.isArray(incomingRows) ? incomingRows : []).map((row) => {
    if (!row || !normalizeFundCode(row.code || row.fundCode)) return row;
    if (hasUsableNav(row) && Number.isFinite(Number(row.premiumRate))) return row;
    const previous = previousByCode.get(normalizeFundCode(row.code || row.fundCode));
    if (!previous) return row;

    const carriedQuote = !hasUsableMarketPrice(row);
    const carriedNav = !hasUsableNav(row);
    const marketPrice = carriedQuote ? Number(previous.marketPrice) : Number(row.marketPrice);
    const lastNav = carriedNav ? Number(previous.lastNav) : Number(row.lastNav);
    const hasPrice = Number.isFinite(marketPrice) && marketPrice > 0;
    const hasNav = Number.isFinite(lastNav) && lastNav > 0;
    if (!hasPrice && !hasNav) return row;
    const premiumRate = hasPrice && hasNav ? ((marketPrice / lastNav) - 1) * 100 : null;
    return {
      ...row,
      marketPrice: hasPrice ? marketPrice : row.marketPrice,
      price: hasPrice ? marketPrice : row.price,
      lastNav: hasNav ? lastNav : row.lastNav,
      nav: hasNav ? lastNav : row.nav,
      premiumRate,
      discountRate: premiumRate !== null && premiumRate < 0 ? Math.abs(premiumRate) : null,
      premiumBasis: premiumRate !== null ? 'lastNav' : row.premiumBasis,
      premiumNote: premiumRate !== null ? '基于已公布官方净值' : row.premiumNote,
      navDate: carriedNav ? previous.navDate || row.navDate || '' : row.navDate,
      navQuoteTime: carriedNav ? previous.navQuoteTime || row.navQuoteTime || '' : row.navQuoteTime,
      navSource: carriedNav ? previous.navSource || row.navSource || '' : row.navSource,
      quoteTime: carriedQuote ? previous.quoteTime || row.quoteTime || '' : row.quoteTime,
      quoteSource: carriedQuote ? previous.quoteSource || previous.source || row.quoteSource || '' : row.quoteSource,
      source: carriedQuote ? previous.source || row.source : row.source,
      valuationCarriedForward: carriedQuote || carriedNav,
      carriedForwardFields: [carriedQuote ? 'quote' : '', carriedNav ? 'officialNav' : ''].filter(Boolean),
    };
  });
}

function stabilizeSnapshotPurchaseStatuses(snapshot, previousSnapshot) {
  const rows = mergeStablePurchaseStatuses(previousSnapshot?.rows, snapshot?.rows);
  const carriedCount = rows.filter((row) => row.purchaseStatusCarriedForward).length;
  if (!carriedCount) return { ...snapshot, rows };
  return {
    ...snapshot,
    meta: {
      ...(snapshot.meta || {}),
      warn: [snapshot.meta?.warn, `${carriedCount} 条申购状态沿用上一份已验证快照`].filter(Boolean).join('；'),
    },
    rows,
  };
}

function hasUsablePurchaseLimit(limit) {
  if (!limit || typeof limit !== 'object') return false;
  const label = String(limit.label || limit.limitText || limit.status || limit.purchaseStatus || '').trim();
  const state = String(limit.state || '').toLowerCase();
  return Boolean(label)
    && !/^(未知|暂无数据|--|-|N\/A)$/i.test(label)
    && !['unknown', 'unavailable'].includes(state);
}

function normalizePurchaseState(state, label) {
  const normalizedState = String(state || '').toLowerCase();
  if (['open', 'limited', 'paused', 'exchange', 'reported'].includes(normalizedState)) return normalizedState;
  if (/暂停|停止|封闭|终止|失败/.test(label)) return 'paused';
  if (/限|大额/.test(label)) return 'limited';
  if (/开放|不限额|无限额/.test(label)) return 'open';
  if (/场内交易/.test(label)) return 'exchange';
  return 'reported';
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

function isDisplayStableSnapshot(snapshot, category = 'ALL') {
  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  if (rows.length < (MIN_COMPLETE_ROWS[category] || 1)) return false;
  if (category === 'ALL') {
    const categories = new Set(rows.map((row) => String(row.category || row.fundType || '').toUpperCase()));
    if (!categories.has('LOF') || !categories.has('QDII') || !categories.has('ETF')) return false;
  }
  return true;
}

function isReusableObservedSnapshot(snapshot, category = 'ALL') {
  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  return rows.length >= (MIN_COMPLETE_ROWS[category] || 1);
}

function protectSnapshotConsistency(snapshot, category, snapshotCacheKey) {
  if (isReusableObservedSnapshot(snapshot, category) && !hasSevereRowDrop(snapshot, snapshotCacheKey)) return snapshot;
  const previous = cache.getStale(snapshotCacheKey, { maxAgeMs: COMPLETE_SNAPSHOT_MAX_STALE_MS })
    || cache.getObserved(snapshotCacheKey, { maxAgeMs: COMPLETE_SNAPSHOT_MAX_STALE_MS });
  if (!isReusableObservedSnapshot(previous, category)) return snapshot;
  return {
    ...previous,
    meta: {
      ...previous.meta,
      stale: true,
      sourceStatus: previous.meta?.sourceStatus || 'cache',
      status: 'stable-cache',
      warn: [
        previous.meta?.warn,
        snapshot.meta?.warn,
        '本次刷新未通过完整性/一致性校验，保留上一份完整快照',
      ].filter(Boolean).join('；'),
    },
  };
}

function hasSevereRowDrop(snapshot, snapshotCacheKey) {
  const previous = cache.getStale(snapshotCacheKey, { maxAgeMs: COMPLETE_SNAPSHOT_MAX_STALE_MS })
    || cache.getObserved(snapshotCacheKey, { maxAgeMs: COMPLETE_SNAPSHOT_MAX_STALE_MS });
  const previousRows = Array.isArray(previous?.rows) ? previous.rows : [];
  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  if (!previousRows.length || !rows.length) return false;
  return rows.length < previousRows.length;
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

function dedupeRank(row) {
  const code = normalizeFundCode(row.code);
  if (VERIFIED_T3_CODES.has(code)) return -20;
  const marketRegion = inferMarketRegion(row);
  const cycle = inferSettlementRule(row, marketRegion).settlementCycle;
  return (cycle === 'T+3' || marketRegion === 'overseas' ? -10 : 0) + categoryRank(row.category);
}

function snapshotKey(category, includeTrends) {
  return `fund-quotes:snapshot:${category}:trends:${includeTrends ? '1' : '0'}`;
}

function navTimeoutForCategory(category) {
  return NAV_SUPPLEMENT_TIMEOUT_MS;
}

function normalizeSnapshotCategory(category) {
  const text = String(category || 'ALL').toUpperCase();
  if (text === 'LOF' || text === 'QDII' || text === 'ETF' || text === 'ALL') return text;
  return 'ALL';
}

function inferMarketRegion(row) {
  const code = normalizeFundCode(row.code || row.fundCode);
  if (VERIFIED_T3_CODES.has(code)) return 'overseas';
  const text = String([row.market, row.name, row.category, row.fundType, row.indexName].filter(Boolean).join(' ')).toUpperCase();
  if (/港股|港美|恒生|H股|香港|纳指|纳斯达克|标普|道琼斯|美国|美股|NASDAQ|S&P|日本|日经|全球|海外|国际|德国|法国|英国|欧洲|EUROPE|EU\b|亚太|东南亚|ASIA|APAC|沙特|巴西|印度|越南|新经济|教育|商品|石油|原油|黄金|白银|油气|抗通胀/.test(text)) {
    return 'overseas';
  }
  return 'domestic';
}

function inferSettlementCycle(row, marketRegion) {
  return inferSettlementRule(row, marketRegion).settlementCycle;
}

function inferSettlementRule(row, marketRegion) {
  const code = normalizeFundCode(row.code || row.fundCode);
  const verified = VERIFIED_T3_CODES.get(code);
  if (verified) return verified;
  const explicitCycle = String(row.settlementCycle || row.redemptionCycle || '').toUpperCase().replace(/\s/g, '');
  if (explicitCycle === 'T+2' || explicitCycle === 'T+3') {
    return { settlementCycle: explicitCycle, marketRegion, source: 'source-explicit' };
  }
  if (marketRegion === 'overseas') {
    return { settlementCycle: 'T+3', marketRegion: 'overseas', source: 'cross-border-fund-rule' };
  }
  return { settlementCycle: 'T+2', marketRegion: 'domestic', source: 'domestic-fund-rule' };
}

function applyListQuery(rows, options = {}) {
  const keyword = String(options.query || '').trim().toLowerCase();
  const marketFilter = String(options.marketFilter || '').toUpperCase().replace(/\s/g, '');
  const excludePausedPurchase = options.excludePausedPurchase === true || String(options.excludePausedPurchase || '') === '1';
  return rows.filter((row) => {
    if (keyword) {
      const text = [row.code, row.fundCode, row.name, row.fundName, row.market, row.indexName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!text.includes(keyword)) return false;
    }
    if ((marketFilter === 'T+2' || marketFilter === 'T+3') && row.settlementCycle !== marketFilter) return false;
    if (excludePausedPurchase && isPausedPurchase(row)) return false;
    return true;
  });
}

function sortListRows(rows, sortKey = 'premiumRate', sortDirection = 'desc') {
  const direction = String(sortDirection || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  const key = normalizeSortKey(sortKey);
  return rows.slice().sort((left, right) => {
    const leftValue = sortValue(left, key);
    const rightValue = sortValue(right, key);
    if (leftValue === null && rightValue !== null) return 1;
    if (leftValue !== null && rightValue === null) return -1;
    const delta = leftValue === null ? 0 : leftValue - rightValue;
    if (delta !== 0) return delta * direction;
    return String(left.code || '').localeCompare(String(right.code || ''));
  });
}

function normalizeSortKey(key) {
  const text = String(key || 'premiumRate');
  if (['premiumRate', 'price', 'marketPrice', 'changeRate', 'lastNav', 'nav', 'estimatedNav', 'turnover', 'volume'].includes(text)) return text;
  return 'premiumRate';
}

function sortValue(row, key) {
  const value = key === 'price' ? row.marketPrice
    : key === 'nav' ? row.lastNav
      : row[key];
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isPausedPurchase(row) {
  const limit = row.purchaseLimit || {};
  const text = String([limit.state, limit.label, limit.limitText, row.subscriptionStatus].filter(Boolean).join(' '));
  return /paused|暂停申购|停止申购/.test(text);
}

function paginateRows(rows, options = {}) {
  const hasPaging = options.page !== undefined || options.pageSize !== undefined || shouldUseHomeFields(options);
  if (!hasPaging) {
    return { rows, page: 1, pageSize: rows.length || 0, totalPages: 1, hasMore: false };
  }
  const pageSize = clampInteger(options.pageSize, 30, 1, 100);
  const page = clampInteger(options.page, 1, 1, 10000);
  const start = (page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  return { rows: pageRows, page, pageSize, totalPages, hasMore: page < totalPages };
}

function shouldUseHomeFields(options = {}) {
  const fields = String(options.fields || '').toLowerCase();
  return fields === 'home' || fields === 'list' || fields === 'slim';
}

function projectHomeListRow(row) {
  return HOME_LIST_FIELDS.reduce((result, key) => {
    if (row[key] !== undefined) result[key] = row[key];
    return result;
  }, {});
}

function clampInteger(value, fallback, min, max) {
  const number = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
