function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseFloat(String(value).replace('%', '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatEmpty(value) {
  return value === null || value === undefined || value === '' ? '暂无数据' : value;
}

function formatNumber(value, digits = 3) {
  if (value === null || value === undefined || value === '') return '暂无数据';
  const number = Number(value);
  if (!Number.isFinite(number)) return '暂无数据';
  return number.toFixed(digits).replace(/\.?0+$/, '');
}

function officialNavText(value, digits = 4) {
  if (value === null || value === undefined || value === '') return '净值未公布';
  const number = Number(value);
  if (!Number.isFinite(number)) return '净值未公布';
  return number.toFixed(digits).replace(/\.?0+$/, '');
}

function percentText(value, options = {}) {
  if (value === null || value === undefined || value === '') return '暂无数据';
  const number = Number(value);
  if (!Number.isFinite(number)) return '暂无数据';
  const prefix = options.sign && number > 0 ? '+' : '';
  return `${prefix}${number.toFixed(2)}%`;
}

function amountText(value) {
  if (value === null || value === undefined || value === '') return '暂无数据';
  const number = Number(value);
  if (!Number.isFinite(number)) return '暂无数据';
  if (Math.abs(number) >= 100000000) return `${(number / 100000000).toFixed(2)}亿`;
  if (Math.abs(number) >= 10000) return `${(number / 10000).toFixed(1)}万`;
  return number.toFixed(0);
}

function formatShareValue(value) {
  if (value === null || value === undefined || value === '') return '暂无数据';
  return String(value).trim() || '暂无数据';
}

function shareChangeClass(value) {
  const text = formatShareValue(value);
  const number = Number.parseFloat(text.replace(/,/g, '').replace(/[^\d.+\-−]/g, '').replace('−', '-'));
  if (!Number.isFinite(number) || number === 0) return 'share-flat';
  return number > 0 ? 'share-up' : 'share-down';
}

function valueClass(value, inverse) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return 'value-flat';
  const up = inverse ? number < 0 : number > 0;
  return up ? 'value-up' : 'value-down';
}

function premiumClass(value) {
  const number = toNumber(value);
  if (number === null) return 'is-muted';
  if (number > 0) return 'is-premium';
  if (number < 0) return 'is-discount';
  return 'is-flat';
}

function priceClass(change) {
  const number = toNumber(change);
  if (number === null) return 'is-muted';
  if (number > 0) return 'is-up';
  if (number < 0) return 'is-down';
  return 'is-flat';
}

module.exports = {
  toNumber,
  formatEmpty,
  formatNumber,
  officialNavText,
  percentText,
  amountText,
  formatShareValue,
  shareChangeClass,
  valueClass,
  premiumClass,
  priceClass
};
