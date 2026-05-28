export function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseFloat(String(value).replace('%', '').replace(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function percentValue(value) {
  return parseNumber(value);
}
