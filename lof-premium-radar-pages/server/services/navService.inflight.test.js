import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchJisiluQdiiSnapshot: vi.fn(),
  fetchLofSnapshot: vi.fn(),
  fetchTiantianNav: vi.fn(),
  fetchEastmoneyFundNav: vi.fn(),
  fetchHaoetfQuotes: vi.fn(),
}));

vi.mock('../sources/jisiluQdiiProvider.js', () => ({
  fetchJisiluQdiiSnapshot: mocks.fetchJisiluQdiiSnapshot,
}));

vi.mock('../sources/lofProvider.js', () => ({
  fetchLofSnapshot: mocks.fetchLofSnapshot,
}));

vi.mock('../sources/tiantianSource.js', () => ({
  fetchTiantianNav: mocks.fetchTiantianNav,
}));

vi.mock('../sources/eastmoneyFundNavSource.js', () => ({
  fetchEastmoneyFundNav: mocks.fetchEastmoneyFundNav,
}));

vi.mock('../sources/haoetfSource.js', () => ({
  fetchHaoetfQuotes: mocks.fetchHaoetfQuotes,
}));

const { getLofPremiumReferenceMap, getNavMap, getSingleNav } = await import('./navService.js');
const { cache } = await import('./cacheService.js');

describe('navService in-flight isolation', () => {
  beforeEach(() => {
    cache.items.clear();
    cache.lastValid.clear();
    cache.lastObserved.clear();
    mocks.fetchLofSnapshot.mockReset();
    mocks.fetchJisiluQdiiSnapshot.mockResolvedValue({ rows: [] });
    mocks.fetchLofSnapshot.mockResolvedValue({ rows: [] });
    mocks.fetchHaoetfQuotes.mockResolvedValue([]);
    mocks.fetchEastmoneyFundNav.mockRejectedValue(new Error('not needed'));
    mocks.fetchTiantianNav.mockImplementation(async (code) => ({
      code,
      lastNav: code === '160140' ? 1.4 : 2.3,
      estimatedNav: code === '160140' ? 1.39 : 2.29,
      navSource: 'tiantian',
      estimatedNavSource: 'tiantian',
      navQuoteTime: '2026-06-08 15:00:00',
    }));
  });

  it('does not share an in-flight LOF NAV request with a concurrent QDII request', async () => {
    const [lofMap, qdiiMap] = await Promise.all([
      getNavMap([{ code: '160140', category: 'LOF' }], { force: true }),
      getNavMap([{ code: '513100', category: 'QDII' }], { force: true }),
    ]);

    expect(lofMap.get('160140')?.lastNav).toBe(1.4);
    expect(qdiiMap.get('513100')?.lastNav).toBe(2.3);
    expect(mocks.fetchTiantianNav).toHaveBeenCalledWith('160140');
    expect(mocks.fetchTiantianNav).toHaveBeenCalledWith('513100');
  });

  it('bypasses the target website cache on every forced manual refresh', async () => {
    mocks.fetchLofSnapshot.mockResolvedValue({
      scrapedAt: '2026-06-29T02:38:27.000Z',
      rows: [{
        code: 'SH501225', quoteDate: '2026-06-29', quoteTime: '10:38',
        officialEstValue: 3.487, officialPremiumValue: 30.07, estDate: '2026-06-26',
      }],
    });

    const first = await getLofPremiumReferenceMap({ force: true });
    const second = await getLofPremiumReferenceMap({ force: true });

    expect(first.get('501225')?.value).toBe(3.487);
    expect(second.get('501225')?.value).toBe(3.487);
    expect(mocks.fetchLofSnapshot).toHaveBeenCalledTimes(2);
  });

  it('honors target website rate-limit cooldown instead of hitting it on every refresh', async () => {
    const limited = new Error('源站限流');
    limited.retryAfterMs = 60_000;
    mocks.fetchLofSnapshot.mockRejectedValue(limited);

    await expect(getLofPremiumReferenceMap({ force: true })).rejects.toThrow('源站限流');
    await expect(getLofPremiumReferenceMap({ force: true })).rejects.toThrow('源站限流');

    expect(mocks.fetchLofSnapshot).toHaveBeenCalledTimes(1);
  });

  it('selects the newest dated official NAV for a direct fund lookup', async () => {
    mocks.fetchTiantianNav.mockResolvedValueOnce({
      code: '501225', lastNav: 3.4, navDate: '2026-06-24', navSource: 'tiantian',
      estimatedNav: 3.45, estimatedNavSource: 'tiantian', updateTime: '2026-06-26 09:30:00',
    });
    mocks.fetchEastmoneyFundNav.mockResolvedValueOnce({
      code: '501225', lastNav: 3.5, navDate: '2026-06-25', navSource: 'eastmoney',
      navQuoteTime: '2026-06-25 00:00:00', updateTime: '2026-06-26 09:30:01',
    });

    const row = await getSingleNav('501225');

    expect(row).toMatchObject({
      code: '501225', lastNav: 3.5, navDate: '2026-06-25', navSource: 'eastmoney',
      estimatedNav: 3.45, estimatedNavSource: 'tiantian',
    });
  });
});
