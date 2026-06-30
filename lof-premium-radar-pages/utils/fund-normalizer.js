const { toNumber } = require('./format');
const { decorateFund } = require('./fund-presenter');

function normalizeMeta(meta, section) {
  return {
    sourceId: String(meta.sourceId || section),
    sourceTitle: String(meta.sourceTitle || section),
    sourceProvider: String(meta.sourceProvider || meta.sourceId || 'internal'),
    rowCount: toNumber(meta.rowCount) || 0,
    allCount: toNumber(meta.allCount) || toNumber(meta.rowCount) || 0,
    warn: String(meta.warn || ''),
    fetchedAt: typeof meta.fetchedAt === 'string' ? meta.fetchedAt : undefined,
    scrapedAt: typeof meta.scrapedAt === 'string' ? meta.scrapedAt : undefined,
    latestQuoteTime: typeof meta.latestQuoteTime === 'string' ? meta.latestQuoteTime : undefined,
    updateTime: typeof meta.updateTime === 'string' ? meta.updateTime : undefined,
    sourceStatus: typeof meta.sourceStatus === 'string' ? meta.sourceStatus : undefined,
    stale: Boolean(meta.stale),
    status: String(meta.status || 'ok'),
    trendsIncluded: Boolean(meta.trendsIncluded),
    filteredCount: toNumber(meta.filteredCount) || 0,
    totalCount: toNumber(meta.totalCount) || 0,
    pagination: meta.pagination || null
  };
}

function normalizeFund(row, meta) {
  if (isNormalizedFund(row)) return row;
  if ('marketPrice' in row || 'lastNav' in row || 'estimatedNav' in row) {
    return normalizeUnifiedFund(row, meta);
  }
  return normalizeLegacyFund(row, meta);
}

function mergeStablePurchaseStatuses(previousFunds, incomingFunds) {
  const previousByCode = new Map((Array.isArray(previousFunds) ? previousFunds : [])
    .filter((fund) => fund && fund.code)
    .map((fund) => [fund.code, fund]));

  return (Array.isArray(incomingFunds) ? incomingFunds : []).map((fund) => {
    if (hasUsablePurchaseStatus(fund)) return fund;
    const previous = previousByCode.get(fund && fund.code);
    if (!hasUsablePurchaseStatus(previous)) return fund;
    const purchaseLimit = Object.assign({}, previous.purchaseLimit, { carriedForward: true });
    return Object.assign({}, fund, {
      purchaseLimit,
      subscriptionStatus: previous.subscriptionStatus,
      subscriptionState: previous.subscriptionState,
      redemptionStatus: previous.redemptionStatus,
      subscriptionSource: previous.subscriptionSource || purchaseLimit.source || '',
      subscriptionTime: previous.subscriptionTime || purchaseLimit.updateTime || '',
      purchaseStatusCarriedForward: true
    });
  });
}

function hasUsablePurchaseStatus(fund) {
  if (!fund || typeof fund !== 'object') return false;
  const limit = fund.purchaseLimit || {};
  const label = String(limit.label || limit.limitText || fund.subscriptionStatus || '').trim();
  const state = String(limit.state || fund.subscriptionState || '').toLowerCase();
  return Boolean(label) && !/^(未知|暂无数据|--|-|N\/A)$/i.test(label) && !['', 'unknown', 'unavailable'].includes(state);
}

function isNormalizedFund(row) {
  return Boolean(
    row &&
    typeof row === 'object' &&
    row.raw &&
    row.display &&
    row.classes &&
    typeof row.code === 'string' &&
    typeof row.type === 'string'
  );
}

function normalizeUnifiedFund(row, meta) {
  const type = normalizeUnifiedType(row.category);
  const updatedAt = String(row.updateTime || row.quoteTime || meta.updateTime || '');
  const stale = row.sourceStatus === 'cache' || Boolean(row.isAbnormal);
  const purchaseLimit = normalizePurchaseLimit(row.purchaseLimit, row.subscriptionStatus);
  const fund = {
    code: String(row.code || ''),
    name: String(row.name || ''),
    type,
    price: toNumber(row.marketPrice),
    marketPrice: toNumber(row.marketPrice),
    changePercent: toNumber(row.changeRate),
    changeRate: toNumber(row.changeRate),
    nav: toNumber(row.lastNav),
    lastNav: toNumber(row.lastNav),
    navDate: row.navDate || null,
    navQuoteTime: row.navQuoteTime || '',
    estimatedValue: toNumber(row.estimatedNav),
    estimatedNav: toNumber(row.estimatedNav),
    premiumRate: toNumber(row.premiumRate),
    realtimePremiumRate: toNumber(row.realtimePremiumRate ?? row.premiumRate),
    officialPremiumRate: toNumber(row.officialPremiumRate),
    officialDiscountRate: toNumber(row.officialDiscountRate),
    premiumBasis: row.premiumBasis || '',
    premiumNote: row.premiumNote || '',
    estimatedNavSource: row.estimatedNavSource || '',
    estimatedNavTime: row.estimatedNavTime || '',
    navSource: row.navSource || '',
    estimateConfidence: row.estimateConfidence || '',
    estimateDeviationRate: toNumber(row.estimateDeviationRate),
    estimateWarning: row.estimateWarning || '',
    estimateSources: Array.isArray(row.estimateSources) ? row.estimateSources : [],
    volume: toNumber(row.volume),
    volumeUnit: String(row.volumeUnit || ''),
    amount: toNumber(row.turnover),
    turnover: toNumber(row.turnover),
    shareAmount: String(row.shareAmount || ''),
    shareValueWan: toNumber(row.shareValueWan),
    shareChange: String(row.shareChange || ''),
    shareSource: String(row.shareSource || ''),
    shareTime: String(row.shareTime || ''),
    marketValue: toNumber(row.marketValue),
    marketValueSource: String(row.marketValueSource || ''),
    marketValueTime: String(row.marketValueTime || ''),
    marketValueBasis: String(row.marketValueBasis || ''),
    fundScale: toNumber(row.fundScale),
    fundScaleSource: String(row.fundScaleSource || ''),
    fundScaleDate: String(row.fundScaleDate || ''),
    fundScaleTime: String(row.fundScaleTime || ''),
    fundScaleStatus: String(row.fundScaleStatus || ''),
    fundScaleStale: Boolean(row.fundScaleStale),
    turnoverRate: toNumber(row.turnoverRate),
    turnoverRateSource: String(row.turnoverRateSource || ''),
    turnoverRateTime: String(row.turnoverRateTime || ''),
    turnoverRateBasis: String(row.turnoverRateBasis || ''),
    turnoverRateVolumeUnit: String(row.turnoverRateVolumeUnit || ''),
    subscriptionStatus: purchaseLimit.label,
    subscriptionState: purchaseLimit.state,
    redemptionStatus: purchaseLimit.redemptionStatus || '--',
    market: normalizeExchange(row),
    marketRegion: normalizeMarketRegion(row),
    settlementCycle: row.settlementCycle || (normalizeMarketRegion(row) === 'overseas' ? 'T+3' : 'T+2'),
    showEstimatedNav: row.showEstimatedNav !== false,
    source: row.source || meta.sourceProvider || 'internal',
    quoteSource: row.quoteSource || '',
    subscriptionSource: row.subscriptionSource || '',
    subscriptionTime: row.subscriptionTime || '',
    trendSource: row.trendSource || '',
    sourceStatus: row.sourceStatus,
    purchaseLimit,
    intraday: Array.isArray(row.intraday) ? row.intraday : [],
    quoteTime: row.quoteTime || '',
    updatedAt,
    updateTime: row.updateTime || '',
    changedFields: Array.isArray(row.changedFields) ? row.changedFields : [],
    isRealtime: Boolean(row.isRealtime),
    isAbnormal: Boolean(row.isAbnormal),
    abnormalReason: row.abnormalReason || '',
    stale,
    confidence: row.isAbnormal ? 60 : row.sourceStatus === 'cache' ? 70 : 100,
    errorMessage: row.abnormalReason || '',
    raw: row
  };
  return decorateFund(fund);
}

function normalizeLegacyFund(row, meta) {
  const subscriptionStatus = row.purchaseLimit && (row.purchaseLimit.limitText || row.purchaseLimit.status) || row.subscriptionStatus || '';
  const fund = {
    code: String(row.code || ''),
    name: String(row.name || ''),
    type: normalizeType(row, meta.sourceId),
    price: toNumber(row.priceValue || row.price),
    changePercent: toNumber(row.changeValue || row.change),
    nav: toNumber(row.officialEstValue || row.officialEst),
    navDate: row.estDate || row.navDate || null,
    estimatedValue: toNumber(row.realtimeEstValue || row.realtimeEst || row.referenceEst),
    premiumRate: toNumber(row.realtimePremiumValue || row.realtimePremium || row.officialPremiumValue || row.officialPremium),
    volume: toNumber(row.volume),
    amount: toNumber(row.amount || row.volume),
    subscriptionStatus: subscriptionStatus || '暂无数据',
    subscriptionState: row.purchaseLimit && row.purchaseLimit.state || normalizeSubscriptionState(subscriptionStatus),
    redemptionStatus: row.redeemStatus || row.purchaseLimit && row.purchaseLimit.redeemStatus || '--',
    market: normalizeExchange(row),
    marketRegion: normalizeMarketRegion(row),
    settlementCycle: row.settlementCycle || (normalizeMarketRegion(row) === 'overseas' ? 'T+3' : 'T+2'),
    showEstimatedNav: row.showEstimatedNav !== false,
    source: row.source || meta.sourceProvider || 'internal',
    updatedAt: meta.fetchedAt || meta.scrapedAt || '',
    changedFields: Array.isArray(row.changedFields) ? row.changedFields : [],
    stale: Boolean(row.stale || meta.stale),
    confidence: 100,
    errorMessage: '',
    raw: row
  };
  return decorateFund(fund);
}

function normalizeUnifiedType(value) {
  const text = String(value || '').toUpperCase();
  if (text === 'LOF') return 'LOF';
  if (text === 'ETF') return 'ETF';
  return 'QDII';
}

function normalizeType(row, section) {
  const text = `${row.fundType || ''} ${row.name || ''} ${section}`.toUpperCase();
  if (text.includes('LOF')) return 'LOF';
  if (text.includes('ETF')) return 'ETF';
  return 'QDII';
}

function normalizeExchange(row) {
  const explicit = String(row.exchange || row.exchangeMarket || row.marketCode || '').toUpperCase();
  if (explicit.includes('SH') || explicit.includes('SSE') || explicit.includes('沪')) return 'SH';
  if (explicit.includes('SZ') || explicit.includes('SZSE') || explicit.includes('深')) return 'SZ';
  const code = String(row.code || '').replace(/^(SH|SZ)/i, '');
  if (/^(15|16|18)/.test(code)) return 'SZ';
  if (/^(50|51|52|56|58)/.test(code)) return 'SH';
  return '';
}

function normalizeMarketRegion(row) {
  const value = String(row.marketRegion || '').toLowerCase();
  if (value === 'domestic' || value === 'overseas') return value;
  const text = String(`${row.market || ''} ${row.name || ''} ${row.category || ''} ${row.indexName || ''}`).toUpperCase();
  if (/港股|港美|恒生|H股|香港|纳指|纳斯达克|标普|道琼斯|美国|美股|NASDAQ|S&P|日本|日经|全球|海外|国际|德国|法国|英国|欧洲|EUROPE|EU\b|亚太|东南亚|ASIA|APAC|沙特|巴西|印度|越南|新经济|教育|商品|石油|原油|黄金|白银|油气|抗通胀/.test(text)) {
    return 'overseas';
  }
  return 'domestic';
}

function normalizeSubscriptionState(status) {
  const text = status || '';
  if (/暂停/.test(text)) return 'paused';
  if (/限/.test(text)) return 'limited';
  if (/开放/.test(text)) return 'open';
  if (/场内交易/.test(text)) return 'exchange';
  return 'unavailable';
}

function normalizePurchaseLimit(limit, fallbackStatus) {
  const source = limit && typeof limit === 'object' ? limit : {};
  const rawLabel = String(source.label || source.limitText || source.status || fallbackStatus || '').trim();
  const label = !rawLabel || /^(未知|--|-|N\/A)$/i.test(rawLabel) ? '暂无数据' : rawLabel;
  return Object.assign({}, source, {
    state: !source.state || source.state === 'unknown' ? normalizeSubscriptionState(label) : source.state,
    label,
    limitText: source.limitText || label,
    redemptionStatus: source.redemptionStatus || source.redeemStatus || ''
  });
}

module.exports = { normalizeFund, normalizeMeta, mergeStablePurchaseStatuses };
