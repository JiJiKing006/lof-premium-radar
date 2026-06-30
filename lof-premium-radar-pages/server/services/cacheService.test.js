import { describe, expect, it } from 'vitest';
import { MemoryCache } from './cacheService.js';

describe('MemoryCache verified snapshot boundary', () => {
  it('keeps transient observations out of the serving cache', () => {
    const cache = new MemoryCache();
    const partial = { meta: { status: 'refreshing' }, rows: [] };

    cache.setTransient('quotes', partial, 5_000);

    expect(cache.get('quotes')).toBeNull();
    expect(cache.getStale('quotes')).toBeNull();
    expect(cache.getObserved('quotes')).toBe(partial);
  });

  it('promotes only verified values into fresh and last-valid storage', () => {
    const cache = new MemoryCache();
    const verified = { meta: { status: 'ok' }, rows: [{ code: '160216' }] };

    cache.set('quotes', verified, 30_000);

    expect(cache.get('quotes')).toBe(verified);
    expect(cache.getStale('quotes')).toBe(verified);
    expect(cache.getObserved('quotes')).toBe(verified);
  });
});
