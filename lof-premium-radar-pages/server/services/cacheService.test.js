import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryCache } from './cacheService.js';

describe('MemoryCache stale data age limit', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns stale values only inside the requested max age window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T10:00:00+08:00'));
    const cache = new MemoryCache();

    cache.set('quotes:LOF', { rows: [{ code: '501312' }] }, 30_000);
    vi.setSystemTime(new Date('2026-06-08T10:01:00+08:00'));

    expect(cache.get('quotes:LOF')).toBeNull();
    expect(cache.getStale('quotes:LOF', { maxAgeMs: 2 * 60_000 })).toEqual({ rows: [{ code: '501312' }] });

    vi.setSystemTime(new Date('2026-06-08T10:03:01+08:00'));

    expect(cache.getStale('quotes:LOF', { maxAgeMs: 2 * 60_000 })).toBeNull();
  });
});
