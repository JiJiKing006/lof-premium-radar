const { requestJson } = require('./request');
const { toNumber, formatNumber, officialNavText, percentText, amountText, premiumClass, priceClass, valueClass } = require('./format');
const { sourceLabel } = require('./source-links');

async function fetchFundsSnapshot(options = {}) {
  const params = {
    t: String(Date.now())
  };
  const section = String(options.section || '').toUpperCase();
  if (section && section !== 'HOME' && section !== 'ALL') params.category = section;
  if (options.force) params.force = '1';
  if (options.includeTrends === false) params.trends = '0';
  if (options.fields) params.fields = String(options.fields);
  if (options.page) params.page = String(options.page);
  if (options.pageSize) params.pageSize = String(options.pageSize);
  if (options.query) params.query = String(options.query);
  if (options.marketFilter && options.marketFilter !== 'ALL') params.marketFilter = String(options.marketFilter);
  if (options.excludePausedPurchase) params.excludePausedPurchase = '1';
  if (options.sortKey) params.sortKey = String(options.sortKey);
  if (options.sortDirection) params.sortDirection = String(options.sortDirection);
  const endpoint = options.requestMode === 'page'
    ? '/api/funds/quotes/page'
    : options.requestMode === 'refresh'
      ? '/api/funds/quotes/refresh'
      : '/api/funds/quotes';
  const raw = await requestJson(endpoint, params, {
    timeoutMs: options.timeoutMs,
    timeoutMessage: options.timeoutMessage
  });
  const meta = normalizeMeta(raw.meta || {}, section || 'HOME');
  const rows = (raw.rows || []).map((row) => normalizeFund(row, meta));
  return { meta, rows };
}

async function fetchFundDetail(code, options = {}) {
  const params = { t: String(Date.now()) };
  if (options.force) params.force = '1';
  const section = String(options.section || '').toUpperCase();
  if (['LOF', 'QDII', 'ETF'].includes(section)) params.category = section;
  const row = await requestJson(`/api/funds/${code}`, params, {
    timeoutMs: 60000,
    timeoutMessage: '详情数据源暂时无响应'
  });
  const meta = normalizeMeta({ sourceProvider: row.source, updateTime: row.updateTime }, row.category || options.section || '');
  return normalizeFund(row, meta);
}

async function fetchFundHistory(code, options = {}) {
  const params = { t: String(Date.now()), limit: String(options.limit || 60) };
  if (options.force) params.force = '1';
  return requestJson(`/api/funds/${code}/history`, params);
}

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
    estimatedValue: toNumber(row.estimatedNav),
    estimatedNav: toNumber(row.estimatedNav),
    premiumRate: toNumber(row.premiumRate),
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
    amount: toNumber(row.turnover),
    turnover: toNumber(row.turnover),
    shareAmount: String(row.shareAmount || ''),
    shareChange: String(row.shareChange || ''),
    shareSource: String(row.shareSource || ''),
    shareTime: String(row.shareTime || ''),
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

function decorateFund(fund) {
  const navSource = fund.navSource || fund.source || '';
  const estimatedSource = fund.estimatedNavSource || '';
  return Object.assign(fund, {
    display: {
      premiumRate: percentText(fund.premiumRate),
      marketPrice: formatNumber(fund.marketPrice ?? fund.price),
      changeRate: percentText(fund.changeRate ?? fund.changePercent, { sign: true }),
      lastNav: officialNavText(fund.lastNav ?? fund.nav),
      estimatedNav: formatNumber(fund.estimatedNav ?? fund.estimatedValue, 4),
      turnover: amountText(fund.turnover ?? fund.amount),
      volume: amountText(fund.volume),
      navSource: sourceLabel(navSource) || '暂无数据',
      estimatedSource: sourceLabel(estimatedSource) || '暂无数据',
      navDate: fund.navDate || fund.navQuoteTime || fund.quoteTime || '暂无数据',
      estimatedTime: fund.estimatedNavTime || fund.navQuoteTime || fund.navDate || fund.quoteTime || '',
      updateTime: fund.updateTime || fund.quoteTime || '暂无数据'
    },
    classes: {
      premiumRate: premiumClass(fund.premiumRate),
      price: priceClass(fund.changeRate ?? fund.changePercent),
      changeRate: valueClass(fund.changeRate ?? fund.changePercent),
      shareChange: ''
    }
  });
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

module.exports = {
  fetchFundsSnapshot,
  fetchFundDetail,
  fetchFundHistory,
  normalizeFund,
  normalizeMeta,
  mergeStablePurchaseStatuses
};
