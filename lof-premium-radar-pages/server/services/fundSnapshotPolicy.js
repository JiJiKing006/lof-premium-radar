import { selectLatestOfficialNav } from './officialNavResolver.js';
import { validateFundRecord } from './dataValidator.js';
import { hasCompletePremiumDisplaySet, hasCurrentEstimate, isHomeLofRow } from './fundListProjector.js';

const MIN_COMPLETE_ROWS = process.env.NODE_ENV === 'test'
  ? { ALL: 1, LOF: 1, QDII: 1, ETF: 1 }
  : { ALL: 120, LOF: 80, QDII: 20, ETF: 10 };

export function buildExchangeMarketValue({ marketPrice, quoteSource, quoteTime, share }) {
  const price = Number(marketPrice);
  const rawShareValueWan = share?.shareValueWan;
  const shareValueWan = rawShareValueWan === null || rawShareValueWan === undefined || rawShareValueWan === ''
    ? Number.NaN
    : Number(rawShareValueWan);
  const normalizedQuoteSource = String(quoteSource || '').trim();
  const normalizedQuoteTime = String(quoteTime || '').trim();
  const shareSource = String(share?.shareSource || '').trim();
  const shareTime = String(share?.shareTime || '').trim();
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(shareValueWan) || shareValueWan < 0
    || !normalizedQuoteSource || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalizedQuoteTime)
    || !shareSource || !shareTime) {
    return {
      marketValue: null,
      marketValueSource: '',
      marketValueTime: '',
      marketValueBasis: '',
    };
  }
  return {
    marketValue: price * shareValueWan * 10_000,
    marketValueSource: `${normalizedQuoteSource}+${shareSource}`,
    marketValueTime: normalizedQuoteTime,
    marketValueBasis: 'marketPrice*exchangeShare',
  };
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
    const previous = previousByCode.get(normalizeFundCode(row.code || row.fundCode));
    const officialNav = selectLatestOfficialNav([row, previous]);
    const carriedNav = Boolean(previous && officialNav?.candidateIndex === 1);
    if (!previous || (!carriedNav && hasUsableNav(row) && hasCurrentEstimate(row) && hasFiniteNumericValue(row.premiumRate))) return row;

    const carriedQuote = !hasUsableMarketPrice(row);
    const marketPrice = carriedQuote ? Number(previous.marketPrice) : Number(row.marketPrice);
    const lastNav = Number(officialNav?.lastNav);
    const hasPrice = Number.isFinite(marketPrice) && marketPrice > 0;
    const hasNav = Number.isFinite(lastNav) && lastNav > 0;
    const hasRealtimeReferencePremium = ['iopv', 'estimatedNav'].includes(String(row.premiumBasis || ''))
      && hasCurrentEstimate(row)
      && hasFiniteNumericValue(row.premiumRate);
    if (!hasPrice && !hasNav) return row;
    const premiumRate = hasRealtimeReferencePremium ? Number(row.premiumRate) : null;
    const officialPremiumRate = hasPrice && hasNav ? ((marketPrice / lastNav) - 1) * 100 : null;
    const merged = {
      ...row,
      marketPrice: hasPrice ? marketPrice : row.marketPrice,
      price: hasPrice ? marketPrice : row.price,
      lastNav: hasNav ? lastNav : row.lastNav,
      nav: hasNav ? lastNav : row.nav,
      premiumRate,
      realtimePremiumRate: premiumRate,
      officialPremiumRate,
      officialDiscountRate: officialPremiumRate !== null && officialPremiumRate < 0 ? Math.abs(officialPremiumRate) : null,
      discountRate: premiumRate !== null && premiumRate < 0 ? Math.abs(premiumRate) : null,
      premiumBasis: hasRealtimeReferencePremium ? row.premiumBasis : 'none',
      premiumNote: hasRealtimeReferencePremium ? row.premiumNote : '今日估算净值暂无数据',
      navDate: officialNav?.navDate || '',
      navQuoteTime: officialNav?.navQuoteTime || '',
      navSource: officialNav?.navSource || '',
      quoteTime: carriedQuote ? previous.quoteTime || row.quoteTime || '' : row.quoteTime,
      quoteSource: carriedQuote ? previous.quoteSource || previous.source || row.quoteSource || '' : row.quoteSource,
      source: carriedQuote ? previous.source || row.source : row.source,
      valuationCarriedForward: carriedQuote || carriedNav,
      carriedForwardFields: [carriedQuote ? 'quote' : '', carriedNav ? 'officialNav' : ''].filter(Boolean),
    };
    return { ...merged, ...validateFundRecord(merged) };
  });
}

export function mergeStableExchangeShareFields(previousRows, incomingRows) {
  const previousByCode = new Map((Array.isArray(previousRows) ? previousRows : [])
    .map((row) => [normalizeFundCode(row?.code || row?.fundCode), row])
    .filter(([code]) => code));

  return (Array.isArray(incomingRows) ? incomingRows : []).map((row) => {
    if (hasVerifiedExchangeShare(row)) return row;
    const previous = previousByCode.get(normalizeFundCode(row?.code || row?.fundCode));
    if (!hasVerifiedExchangeShare(previous)) return row;
    const share = {
      shareAmount: previous.shareAmount,
      shareValueWan: previous.shareValueWan,
      shareChange: previous.shareChange,
      shareSource: previous.shareSource,
      shareTime: previous.shareTime,
    };
    return {
      ...row,
      ...share,
      ...buildExchangeMarketValue({
        marketPrice: row.marketPrice,
        quoteSource: row.quoteSource || row.source,
        quoteTime: row.quoteTime,
        share,
      }),
      shareDataCarriedForward: true,
    };
  });
}

export function hasVerifiedExchangeShare(row) {
  return isExchangeShareSource(row?.shareSource)
    && Number.isFinite(Number(row?.shareValueWan))
    && Number(row.shareValueWan) >= 0
    && Boolean(String(row?.shareTime || '').trim());
}

export function stabilizeSnapshotPurchaseStatuses(snapshot, previousSnapshot) {
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

export function hasUsablePurchaseLimit(limit) {
  if (!limit || typeof limit !== 'object') return false;
  const label = String(limit.label || limit.limitText || limit.status || limit.purchaseStatus || '').trim();
  const state = String(limit.state || '').toLowerCase();
  return Boolean(label)
    && !/^(未知|暂无数据|--|-|N\/A)$/i.test(label)
    && !['unknown', 'unavailable'].includes(state);
}

export function isExchangeShareSource(source) {
  return /^(sse|szse)$/i.test(String(source || ''));
}

export function hasUsableMarketPrice(row) {
  const price = Number(row?.marketPrice);
  return Number.isFinite(price) && price > 0;
}

export function findIncompleteCriticalRows(rows) {
  return rows.filter(isIncompleteCriticalRow);
}

function isIncompleteCriticalRow(row) {
  if (!hasUsableMarketPrice(row)) return false;
  if (row.dataStatus === 'missing_quote' || row.sourceStatus === 'missing') return false;
  return !hasUsableNav(row) || !hasFiniteNumericValue(row.premiumRate);
}

export function isDisplayStableSnapshot(snapshot, category = 'ALL') {
  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  if (rows.length < (MIN_COMPLETE_ROWS[category] || 1)) return false;
  if ((category === 'ALL' || category === 'LOF') && countHomePremiumRows(rows) < 1) return false;
  return true;
}

export function protectSnapshotWithPrevious(snapshot, previous, category) {
  if (isDisplayStableSnapshot(snapshot, category) && !hasSevereRowDrop(snapshot, previous)) return snapshot;
  if (!isDisplayStableSnapshot(previous, category)) return snapshot;
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

export function hasSevereRowDrop(snapshot, previous) {
  const previousRows = Array.isArray(previous?.rows) ? previous.rows : [];
  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  if (!previousRows.length || !rows.length) return false;
  if (rows.length < previousRows.length) return true;

  const previousHomeCount = countHomePremiumRows(previousRows);
  const nextHomeCount = countHomePremiumRows(rows);
  return previousHomeCount > 0 && nextHomeCount < previousHomeCount;
}

function countHomePremiumRows(rows) {
  return rows.filter((row) => isHomeLofRow(row) && hasCompletePremiumDisplaySet(row)).length;
}

export function hasUsableNav(row) {
  const nav = Number(row?.lastNav);
  return Number.isFinite(nav) && nav > 0;
}

function hasFiniteNumericValue(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function normalizeFundCode(code) {
  return String(code || '').replace(/^(SH|SZ)/i, '');
}
