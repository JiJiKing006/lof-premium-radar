function purchaseText(fund) {
  const limit = fund && fund.purchaseLimit || {};
  const label = String(limit.label || limit.limitText || fund && fund.subscriptionStatus || '').trim();
  const state = String(limit.state || fund && fund.subscriptionState || '').toLowerCase();
  const explicitAmount = purchaseLimitAmount(limit, label);

  if (state === 'paused' || /暂停|停止/.test(label)) return '暂停';
  if (state === 'open' || /不限额|无限额|不限|开放/.test(label) || explicitAmount !== null && explicitAmount >= 800_000_000) return '不限';
  if (state === 'limited' || /限|大额/.test(label)) {
    return explicitAmount === null ? '暂无数据' : `限 ${formatPurchaseAmount(explicitAmount)}`;
  }
  return '暂无数据';
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

function formatPurchaseAmount(amount) {
  if (amount > 10_000) return `${trimPurchaseDecimal(amount / 10_000, 4)} 万`;
  return `${trimPurchaseDecimal(amount, 2)} 元`;
}

function trimPurchaseDecimal(value, precision) {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(precision).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
}

function purchaseState(fund) {
  const state = fund && fund.purchaseLimit && fund.purchaseLimit.state || fund && fund.subscriptionState;
  return !state || state === 'unknown' ? 'unavailable' : state;
}

function settlementCycleDisplay(value, reviewCopyMode = false) {
  if (value === 'T+2') return reviewCopyMode ? '延2天' : value;
  if (value === 'T+3') return reviewCopyMode ? '延3天' : value;
  return value || '暂无数据';
}

module.exports = { purchaseText, purchaseState, settlementCycleDisplay };
