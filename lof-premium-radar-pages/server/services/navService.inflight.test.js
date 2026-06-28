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

const { getNavMap } = await import('./navService.js');
const { cache } = await import('./cacheService.js');

describe('navService in-flight isolation', () => {
  beforeEach(() => {
    cache.items.clear();
    cache.lastValid.clear();
    cache.lastObserved.clear();
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
});
