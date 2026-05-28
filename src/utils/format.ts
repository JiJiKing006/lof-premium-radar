export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseFloat(String(value).replace('%', '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatPercent(value: number | null): string {
  return value === null ? '--' : `${value.toFixed(2)}%`;
}

export function formatNumber(value: number | null, digits = 3): string {
  return value === null ? '--' : value.toFixed(digits);
}

export function formatAmount(value: number | null): string {
  if (value === null) return '--';
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(1)}亿`;
  return `${value.toFixed(0)}万`;
}
