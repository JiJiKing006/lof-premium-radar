export function relativeTime(input?: string | null, now = Date.now()): string {
  if (!input) return '数据源异常';
  const time = new Date(input).getTime();
  if (!Number.isFinite(time)) return '数据源异常';
  const diff = Math.max(0, now - time);
  if (diff < 45_000) return '刚刚更新';
  if (diff < 60_000) return `${Math.round(diff / 1000)} 秒前`;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 5) return `${minutes} 分钟前`;
  return '数据延迟';
}

export function isStale(input?: string | null, thresholdMs = 5 * 60_000, now = Date.now()): boolean {
  if (!input) return true;
  const time = new Date(input).getTime();
  if (!Number.isFinite(time)) return true;
  return now - time > thresholdMs;
}

export function isOldNavDate(navDate?: string | null, now = new Date()): boolean {
  if (!navDate) return true;
  const date = new Date(`${navDate}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return true;
  const diffDays = (startOfDay(now).getTime() - startOfDay(date).getTime()) / 86_400_000;
  return diffDays > 3;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
