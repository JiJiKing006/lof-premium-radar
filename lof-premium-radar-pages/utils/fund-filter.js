function filterAndSortFunds(funds, state) {
  const keyword = String(state.query || '').trim().toLowerCase();
  const filtered = funds.filter((fund) => {
    const matchesKeyword =
      !keyword ||
      String(fund.code || '').toLowerCase().includes(keyword) ||
      String(fund.name || '').toLowerCase().includes(keyword) ||
      String(fund.raw && fund.raw.indexName || '').toLowerCase().includes(keyword);

    if (!matchesKeyword) return false;
    if (!isLofFund(fund) && !hasRenderablePremiumRate(fund)) return false;
    if (state.marketFilter && state.marketFilter !== 'ALL' && settlementCycle(fund) !== state.marketFilter) return false;
    if (state.excludePausedPurchase && isPausedPurchase(fund)) return false;
    return true;
  });

  const multiplier = state.sortDirection === 'asc' ? 1 : -1;
  return filtered.slice().sort((left, right) => {
    const leftValue = sortValue(left, state.sortKey);
    const rightValue = sortValue(right, state.sortKey);
    return (leftValue - rightValue) * multiplier;
  });
}

function hasRenderablePremiumRate(fund) {
  return displayPremiumRateValue(fund) !== null;
}

function isLofFund(fund) {
  return String(fund.type || fund.raw && (fund.raw.category || fund.raw.type) || '').toUpperCase() === 'LOF';
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
