import { calculatePremium } from './premiumService.js';
import { getNavMap, getSingleNav } from './navService.js';
import { getQuotes } from './quoteService.js';
import { validateFundRecord } from './dataValidator.js';
import { formatShanghaiTime } from './sourceHealth.js';
import { fetchEastmoneyQuoteMap, fetchEastmoneyTrendMap } from '../sources/eastmoneySupplementSource.js';
import { fetchSubscriptionLimitMap } from '../sources/subscriptionLimitSource.js';

export async function getFundQuotes({ category = '', force = false, includeTrends = true } = {}) {
  const normalizedCategory = String(category || 'LOF').toUpperCase();
  const quotePayload = await getQuotes({ category: normalizedCategory, force });
  const navMap = quotePayload.hasNav ? new Map() : await getNavMap(quotePayload.rows, { force });
  const updateTime = formatShanghaiTime();
  const codes = quotePayload.rows.map((quote) => quote.code);
  const [marketQuoteMap, subscriptionLimitMap, trendMap] = await Promise.all([
    fetchEastmoneyQuoteMap(codes, { force }),
    fetchSubscriptionLimitMap(codes, { force }),
    includeTrends ? fetchEastmoneyTrendMap(codes, { force }) : Promise.resolve(new Map()),
  ]);
  const rows = quotePayload.rows.map((quote) =>
    toUnifiedFund({
      quote,
      nav: navMap.get(quote.code),
      updateTime,
      marketQuote: marketQuoteMap.get(quote.code),
      subscriptionLimit: subscriptionLimitMap.get(quote.code),
      trend: trendMap.get(quote.code),
    }),
  );
  const filtered = normalizedCategory === 'ALL' ? rows : rows.filter((row) => row.category === normalizedCategory);

  return {
    meta: {
      sourceId: 'fund-aggregator',
      sourceTitle: '基金实时行情与溢价聚合',
      sourceProvider: quotePayload.source,
      sourceStatus: quotePayload.sourceStatus,
      rowCount: filtered.length,
      allCount: rows.length,
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

function toUnifiedFund({ quote, nav, updateTime, marketQuote, subscriptionLimit, trend }) {
  const intraday = trend?.points || [];
  const marketPrice = marketQuote?.marketPrice ?? quote.marketPrice;
  const changeRate = marketQuote?.changeRate ?? quote.changeRate;
  const volume = marketQuote?.volume ?? quote.volume;
  const turnover = marketQuote?.turnover ?? quote.turnover;
  const quoteTime = marketQuote?.quoteTime || quote.quoteTime || nav?.navQuoteTime || '';
  const premium = calculatePremium({
    marketPrice,
    estimatedNav: quote.estimatedNav ?? nav?.estimatedNav,
    lastNav: quote.lastNav ?? nav?.lastNav,
  });
  const record = {
    code: quote.code,
    name: quote.name,
    category: quote.category,
    marketPrice,
    lastNav: quote.lastNav ?? nav?.lastNav ?? null,
    estimatedNav: quote.estimatedNav ?? nav?.estimatedNav ?? null,
    premiumRate: premium.premiumRate,
    premiumBasis: premium.basis,
    premiumNote: premium.note,
    changeRate,
    volume,
    turnover,
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

function latestQuoteTime(rows) {
  return rows
    .map((row) => row.quoteTime)
    .filter(Boolean)
    .sort()
    .at(-1) || '';
}
