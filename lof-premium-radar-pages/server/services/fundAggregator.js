import { calculatePremium } from './premiumService.js';
import { getNavMap, getSingleNav } from './navService.js';
import { getQuotes } from './quoteService.js';
import { validateFundRecord } from './dataValidator.js';
import { formatShanghaiTime } from './sourceHealth.js';
import { fetchEastmoneyQuoteMap, fetchEastmoneyTrendMap } from '../sources/eastmoneySupplementSource.js';
import { fetchExchangeShareMap } from '../sources/exchangeShareSource.js';
import { fetchSubscriptionLimitMap } from '../sources/subscriptionLimitSource.js';

const SUPPLEMENT_TIMEOUT_MS = 3_000;
const NAV_SUPPLEMENT_TIMEOUT_MS = 3_500;

export async function getFundQuotes({ category = '', force = false, includeTrends = true } = {}) {
  const normalizedCategory = String(category || 'LOF').toUpperCase();
  const quotePayload = await getQuotes({ category: normalizedCategory, force });
  const updateTime = formatShanghaiTime();
  const codes = quotePayload.rows.map((quote) => quote.code);
  const navPromise = getNavMap(quotePayload.rows, { force });
  const quoteRowsHaveNav = quotePayload.rows.length > 0 && quotePayload.rows.every(hasQuoteNav);
  const [navMap, marketQuoteMap, subscriptionLimitMap, trendMap, exchangeShareMap] = await Promise.all([
    quoteRowsHaveNav ? withMapTimeout(navPromise, NAV_SUPPLEMENT_TIMEOUT_MS) : navPromise,
    fetchEastmoneyQuoteMap(codes, { force }),
    withMapTimeout(fetchSubscriptionLimitMap(codes, { force }), SUPPLEMENT_TIMEOUT_MS),
    includeTrends ? withMapTimeout(fetchEastmoneyTrendMap(codes, { force }), SUPPLEMENT_TIMEOUT_MS) : Promise.resolve(new Map()),
    withMapTimeout(fetchExchangeShareMap(codes, { force }), SUPPLEMENT_TIMEOUT_MS),
  ]);
  const rows = quotePayload.rows.map((quote) =>
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
  const dedupedRows = dedupeFundsByCodePriority(rows);
  const filtered = filterRenderablePremiumRows(
    normalizedCategory === 'ALL' ? dedupedRows : dedupedRows.filter((row) => row.category === normalizedCategory),
  );

  return {
    meta: {
      sourceId: 'fund-aggregator',
      sourceTitle: '基金实时行情与溢价聚合',
      sourceProvider: quotePayload.source,
      sourceStatus: quotePayload.sourceStatus,
      rowCount: filtered.length,
      allCount: dedupedRows.length,
      warn: quotePayload.errors?.join('；') || '',
      latestQuoteTime: latestQuoteTime(filtered),
      updateTime,
      status: 'ok',
      stale: quotePayload.sourceStatus === 'cache',
      trendsIncluded: includeTrends,
    },
    rows: filtered,
  };
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

export function filterRenderablePremiumRows(rows) {
  return rows.filter((row) => Number.isFinite(row.premiumRate));
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
    const snapshot = await getFundQuotes({ ...options, category });
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
  const marketPrice = marketQuote?.marketPrice ?? quote.marketPrice;
  const changeRate = marketQuote?.changeRate ?? quote.changeRate;
  const volume = marketQuote?.volume ?? quote.volume;
  const turnover = marketQuote?.turnover ?? quote.turnover;
  const quoteTime = marketQuote?.quoteTime || quote.quoteTime || nav?.navQuoteTime || '';
  const verifiedShare = exchangeShare || (isExchangeShareSource(quote.shareSource) ? quote : null);
  const premium = calculatePremium({
    marketPrice,
    estimatedNav: quote.estimatedNav,
    estimatedNavSource: quote.navSource || quote.source,
    estimatedNavTime: quote.navQuoteTime || quote.quoteTime || '',
    supplementalEstimatedNav: nav?.estimatedNav,
    supplementalNavSource: nav?.navSource || '',
    supplementalNavTime: nav?.navQuoteTime || '',
    lastNav: quote.lastNav ?? nav?.lastNav,
  });
  const record = {
    code: quote.code,
    name: quote.name,
    category: quote.category,
    marketPrice,
    lastNav: quote.lastNav ?? nav?.lastNav ?? null,
    estimatedNav: premium.estimatedNav ?? quote.estimatedNav ?? nav?.estimatedNav ?? null,
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
    source: quote.source,
    quoteSource: marketQuote?.source || quote.source,
    subscriptionSource: subscriptionLimit?.source || '',
    trendSource: trend?.source || '',
    navSource: nav?.navSource || '',
    sourceStatus: quote.sourceStatus,
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

function hasQuoteNav(quote) {
  return quote.lastNav !== null && quote.lastNav !== undefined && quote.lastNav !== ''
    && quote.estimatedNav !== null && quote.estimatedNav !== undefined && quote.estimatedNav !== '';
}

function withMapTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(new Map()), timeoutMs);
  });
  const guarded = promise.then(
    (value) => {
      clearTimeout(timer);
      return value;
    },
    () => {
      clearTimeout(timer);
      return new Map();
    },
  );
  return Promise.race([guarded, timeout]);
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
