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

export function formatShareValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '暂无数据';
  return String(value).trim() || '暂无数据';
}

export function formatShareChangeText(value: unknown): string {
  const text = formatShareValue(value);
  if (text === '暂无数据') return '较上一日份额 暂无数据';
  if (shareChangeClass(text) === 'share-down') return `较上一日份额减少 ${text.replace(/^[-−]/, '')}`;
  if (shareChangeClass(text) === 'share-up') return `较上一日份额增加 ${text.replace(/^\+/, '')}`;
  return `较上一日份额 ${text}`;
}

export function shareChangeClass(value: unknown): 'share-up' | 'share-down' | 'share-flat' {
  const text = formatShareValue(value);
  const number = Number.parseFloat(text.replace(/,/g, '').replace(/[^\d.+\-−]/g, '').replace('−', '-'));
  if (!Number.isFinite(number) || number === 0) return 'share-flat';
  return number > 0 ? 'share-up' : 'share-down';
}
