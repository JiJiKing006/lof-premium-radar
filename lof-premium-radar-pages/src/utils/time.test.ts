import { describe, expect, it } from 'vitest';
import { isStale, relativeTime } from './time';

describe('relativeTime', () => {
  const now = new Date('2026-05-28T10:00:00Z').getTime();

  it('formats fresh and delayed states', () => {
    expect(relativeTime('2026-05-28T09:59:40Z', now)).toBe('刚刚更新');
    expect(relativeTime('2026-05-28T09:59:00Z', now)).toBe('1 分钟前');
    expect(relativeTime('2026-05-28T09:54:00Z', now)).toBe('数据延迟');
  });

  it('detects stale timestamps', () => {
    expect(isStale('2026-05-28T09:59:00Z', 5 * 60_000, now)).toBe(false);
    expect(isStale('2026-05-28T09:50:00Z', 5 * 60_000, now)).toBe(true);
  });
});
