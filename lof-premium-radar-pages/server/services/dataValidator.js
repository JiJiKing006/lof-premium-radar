const DEFAULT_STALE_MS = 30 * 60_000;

export function validateFundRecord(record, options = {}) {
  const reasons = [];
  const price = toPositiveNumber(record.marketPrice);
  const nav = toPositiveNumber(record.lastNav);
  const estimatedNav = toPositiveNumber(record.estimatedNav);
  const premium = toNumber(record.premiumRate);
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const now = options.now ?? Date.now();

  if (!price) reasons.push('price 缺失或为 0');
  if (!nav && !estimatedNav) reasons.push('nav 缺失或为 0');
  if (premium !== null && Math.abs(premium) > 30) reasons.push('溢价率异常超过 30%');
  if (record.priceDeviationRate !== undefined && record.priceDeviationRate !== null && Math.abs(Number(record.priceDeviationRate)) > 1) {
    reasons.push('不同数据源价格偏差超过 1%');
  }
  if (record.estimateConfidence === 'low') {
    const deviation = toNumber(record.estimateDeviationRate);
    reasons.push(deviation === null ? '估算净值多源偏差过大' : `估算净值多源偏差过大 ${deviation.toFixed(2)}%`);
  }
  if (isStaleQuoteTime(record.quoteTime, now, staleMs)) reasons.push('数据时间过旧');

  return {
    isAbnormal: reasons.length > 0,
    abnormalReason: reasons.join('；'),
  };
}

function isStaleQuoteTime(quoteTime, now, staleMs) {
  if (!quoteTime) return true;
  const normalized = String(quoteTime).replace(' ', 'T');
  const time = new Date(`${normalized}+08:00`).getTime();
  if (!Number.isFinite(time)) return true;
  if (isValidSameDayCloseQuote(quoteTime, now)) return false;
  return now - time > staleMs;
}

function isValidSameDayCloseQuote(quoteTime, now) {
  const match = String(quoteTime).match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})/);
  if (!match) return false;
  const [, quoteDate, hour, minute] = match;
  const shanghai = new Date(now + 8 * 60 * 60_000);
  const nowDate = shanghai.toISOString().slice(0, 10);
  const nowMinutes = shanghai.getUTCHours() * 60 + shanghai.getUTCMinutes();
  const quoteMinutes = Number(hour) * 60 + Number(minute);
  return quoteDate === nowDate && nowMinutes >= 15 * 60 + 30 && quoteMinutes >= 14 * 60 + 55;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toPositiveNumber(value) {
  const number = toNumber(value);
  return number !== null && number > 0 ? number : null;
}
