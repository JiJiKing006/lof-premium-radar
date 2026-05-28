export function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseFloat(String(value).replace('%', '').replace(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatEmpty(value) {
  return value === null || value === undefined || value === '' ? '-' : value;
}

export function premiumClass(value) {
  const number = toNumber(value);
  if (number === null) return 'is-muted';
  if (number > 0) return 'is-premium';
  if (number < 0) return 'is-discount';
  return 'is-flat';
}

export function priceClass(row) {
  const change = toNumber(row.change);
  if (change === null) return 'is-muted';
  if (change > 0) return 'is-up';
  if (change < 0) return 'is-down';
  return 'is-flat';
}

export function quoteDateTime(row) {
  const date = row.quoteDate || '';
  const time = row.quoteTime || '';
  return `${date} ${time}`.trim() || '-';
}
