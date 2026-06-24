import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMarketIndices } from './marketIndexSource.js';

describe('marketIndexSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a degraded snapshot instead of throwing when the index source is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));

    const snapshot = await fetchMarketIndices({ force: true });

    expect(snapshot).toMatchObject({
      meta: {
        source: 'eastmoney',
        sourceStatus: 'error',
        stale: true,
        rowCount: 0,
        error: 'fetch failed',
      },
      rows: [],
    });
  });
});
