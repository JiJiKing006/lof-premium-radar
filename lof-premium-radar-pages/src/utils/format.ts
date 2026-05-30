export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseFloat(String(value).replace('%', '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatPercent(value: number | null): string {
  return value === null ? '暂无数据' : `${value.toFixed(2)}%`;
}

export function formatNumber(value: number | null, digits = 3): string {
  return value === null ? '暂无数据' : value.toFixed(digits);
}

export function formatAmount(value: number | null): string {
  if (value === null) return '暂无数据';
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`;
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return value.toFixed(0);
}
