function filterAndSortFunds(funds, state) {
  const keyword = String(state.query || '').trim().toLowerCase();
  const filtered = funds.filter((fund) => {
    const matchesKeyword =
      !keyword ||
      String(fund.code || '').toLowerCase().includes(keyword) ||
      String(fund.name || '').toLowerCase().includes(keyword) ||
      String(fund.raw && fund.raw.indexName || '').toLowerCase().includes(keyword);

    if (!matchesKeyword) return false;
    if (!hasCompletePremiumDisplaySet(fund)) return false;
    if (state.marketFilter && state.marketFilter !== 'ALL' && settlementCycle(fund) !== state.marketFilter) return false;
    if (state.excludePausedPurchase && isPausedPurchase(fund)) return false;
    if (!matchesPurchaseStatusFilters(fund, state.purchaseStatusFilters, state.purchaseStatusFilter)) return false;
    if (state.redemptionFilter && state.redemptionFilter !== 'ALL' && settlementCycle(fund) !== state.redemptionFilter) return false;
    if (!withinRange(displayPremiumRateValue(fund), state.premiumMin, state.premiumMax)) return false;
    if (!meetsTurnoverMinimumWan(turnoverValue(fund), state.turnoverMin)) return false;
    return true;
  });

  const multiplier = state.sortDirection === 'asc' ? 1 : -1;
  return filtered.slice().sort((left, right) => {
    const leftValue = sortValue(left, state.sortKey);
    const rightValue = sortValue(right, state.sortKey);
    const delta = (leftValue - rightValue) * multiplier;
    if (delta !== 0) return delta;
    return String(left.code || '').localeCompare(String(right.code || ''));
  });
}

function hasRenderablePremiumRate(fund) {
  return displayPremiumRateValue(fund) !== null;
}

function hasCompletePremiumDisplaySet(fund) {
  const raw = fund.raw || {};
  const category = String(fund.type || raw.category || raw.fundType || '').toUpperCase();
  const price = Number(fund.marketPrice ?? fund.price ?? raw.marketPrice ?? raw.price);
  const nav = Number(fund.lastNav ?? fund.nav ?? raw.lastNav ?? raw.nav);
  return category === 'LOF'
    && Number.isFinite(price) && price > 0
    && Number.isFinite(nav) && nav > 0
    && hasRenderablePremiumRate(fund);
}

function displayPremiumRateValue(fund) {
  const raw = fund.raw || {};
  const value = fund.premiumRate !== null && fund.premiumRate !== undefined
    ? fund.premiumRate
    : raw.premiumRate !== null && raw.premiumRate !== undefined
      ? raw.premiumRate
      : raw.realtimePremiumValue !== null && raw.realtimePremiumValue !== undefined
        ? raw.realtimePremiumValue
        : raw.realtimePremium;
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace('%', '').replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function sortValue(fund, key) {
  if (key === 'premiumRate') return displayPremiumRateValue(fund) ?? Number.NEGATIVE_INFINITY;
  if (key === 'price') return fund.marketPrice ?? fund.price ?? Number.NEGATIVE_INFINITY;
  if (key === 'turnover') return fund.turnover ?? fund.amount ?? Number.NEGATIVE_INFINITY;
  if (key === 'changeRate') return fund.changeRate ?? fund.changePercent ?? Number.NEGATIVE_INFINITY;
  if (key === 'lastNav') return fund.lastNav ?? fund.nav ?? Number.NEGATIVE_INFINITY;
  if (key === 'estimatedNav') return fund.estimatedNav ?? fund.estimatedValue ?? Number.NEGATIVE_INFINITY;
  if (key === 'volume') return fund.volume ?? Number.NEGATIVE_INFINITY;
  return fund[key] ?? Number.NEGATIVE_INFINITY;
}

function isPausedPurchase(fund) {
  const limit = fund.purchaseLimit || {};
  const state = String(limit.state || fund.subscriptionState || 'unknown');
  const label = String(limit.label || limit.limitText || fund.subscriptionStatus || '');
  return state === 'paused' || /暂停申购|停止申购/.test(label);
}

function matchesPurchaseStatusFilter(fund, filter) {
  if (filter === 'PAUSED') return isPausedPurchase(fund);
  if (filter === 'OPEN') return isOpenPurchase(fund);
  if (filter === 'LIMITED') return isLimitedPurchase(fund);
  return true;
}

function matchesPurchaseStatusFilters(fund, filters, legacyFilter) {
  const selected = Array.isArray(filters)
    ? filters.filter((filter) => filter && filter !== 'ALL')
    : legacyFilter && legacyFilter !== 'ALL' ? [legacyFilter] : [];
  if (!selected.length) return true;
  return selected.some((filter) => matchesPurchaseStatusFilter(fund, filter));
}

function isOpenPurchase(fund) {
  const limit = fund.purchaseLimit || {};
  const state = String(limit.state || fund.subscriptionState || '').toLowerCase();
  const label = String(limit.label || limit.limitText || fund.subscriptionStatus || '');
  const explicitAmount = purchaseLimitAmount(limit, label);
  return state === 'open'
    || /不限额|无限额|不限|开放/.test(label)
    || explicitAmount !== null && explicitAmount >= 800_000_000;
}

function isLimitedPurchase(fund) {
  const limit = fund.purchaseLimit || {};
  const state = String(limit.state || fund.subscriptionState || '').toLowerCase();
  const label = String(limit.label || limit.limitText || fund.subscriptionStatus || '');
  return !isPausedPurchase(fund)
    && !isOpenPurchase(fund)
    && (state === 'limited' || /限|大额/.test(label));
}

function purchaseLimitAmount(limit, label) {
  const value = limit.dailyLimit ?? limit.limitAmount ?? limit.amountYuan;
  if (value !== null && value !== undefined && value !== '') {
    const amount = Number(value);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  const match = String(label || '').match(/(\d+(?:\.\d+)?)\s*(亿|万|元)/);
  if (!match) return null;
  const scale = match[2] === '亿' ? 100_000_000 : match[2] === '万' ? 10_000 : 1;
  const amount = Number(match[1]) * scale;
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function withinRange(value, minValue, maxValue) {
  const min = normalizeRangeNumber(minValue);
  const max = normalizeRangeNumber(maxValue);
  if (min === null && max === null) return true;
  const number = Number(value);
  if (!Number.isFinite(number)) return false;
  if (min !== null && number < min) return false;
  if (max !== null && number > max) return false;
  return true;
}

function normalizeRangeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(number) ? number : null;
}

function turnoverValue(fund) {
  const raw = fund.raw || {};
  const value = fund.turnover ?? fund.amount ?? raw.turnover ?? raw.amount;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function meetsTurnoverMinimumWan(value, minimumWan) {
  const minimum = normalizeRangeNumber(minimumWan);
  if (minimum === null) return true;
  const number = Number(value);
  return Number.isFinite(number) && number > minimum * 10_000;
}

function marketRegion(fund) {
  const region = String(fund.marketRegion || fund.raw && fund.raw.marketRegion || '').toLowerCase();
  if (region === 'domestic' || region === 'overseas') return region;
  const text = String(`${fund.market || ''} ${fund.name || ''} ${fund.type || ''}`).toUpperCase();
  if (/港股|港美|恒生|H股|香港|纳指|纳斯达克|标普|道琼斯|美国|美股|NASDAQ|S&P|日本|日经|全球|海外|国际|德国|法国|英国|欧洲|EUROPE|EU\b|亚太|东南亚|ASIA|APAC|沙特|巴西|印度|越南|新经济|教育|商品|石油|原油|黄金|白银|油气|抗通胀/.test(text)) {
    return 'overseas';
  }
  return 'domestic';
}

function settlementCycle(fund) {
  const explicitCycle = String(fund.settlementCycle || fund.raw && (fund.raw.settlementCycle || fund.raw.redemptionCycle) || '')
    .toUpperCase()
    .replace(/\s/g, '');
  if (explicitCycle === 'T+2' || explicitCycle === 'T+3') return explicitCycle;
  return marketRegion(fund) === 'overseas' ? 'T+3' : 'T+2';
}

module.exports = { filterAndSortFunds, marketRegion, settlementCycle };
