import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getQuotes: vi.fn(),
  getNavMap: vi.fn(),
  fetchEastmoneyQuoteMap: vi.fn(),
  fetchSinaQuoteMap: vi.fn(),
  fetchSubscriptionLimitMap: vi.fn(),
  fetchEastmoneyTrendMap: vi.fn(),
  fetchExchangeShareMap: vi.fn(),
}));

vi.mock('./quoteService.js', () => ({
  getQuotes: mocks.getQuotes,
}));

vi.mock('./navService.js', () => ({
  getNavMap: mocks.getNavMap,
  getSingleNav: vi.fn(),
}));

vi.mock('../sources/eastmoneySupplementSource.js', () => ({
  fetchEastmoneyQuoteMap: mocks.fetchEastmoneyQuoteMap,
  fetchEastmoneyTrendMap: mocks.fetchEastmoneyTrendMap,
}));

vi.mock('../sources/sinaSupplementSource.js', () => ({
  fetchSinaQuoteMap: mocks.fetchSinaQuoteMap,
}));

vi.mock('../sources/subscriptionLimitSource.js', () => ({
  fetchSubscriptionLimitMap: mocks.fetchSubscriptionLimitMap,
}));

vi.mock('../sources/exchangeShareSource.js', () => ({
  fetchExchangeShareMap: mocks.fetchExchangeShareMap,
}));

const { getFundQuotes } = await import('./fundAggregator.js');
const { cache } = await import('./cacheService.js');

describe('fundAggregator performance', () => {
  beforeEach(() => {
    vi.useRealTimers();
    cache.items.clear();
    cache.lastValid.clear();
    mocks.getQuotes.mockReset();
    mocks.getNavMap.mockReset();
    mocks.fetchEastmoneyQuoteMap.mockReset();
    mocks.fetchSinaQuoteMap.mockReset();
    mocks.fetchSubscriptionLimitMap.mockReset();
    mocks.fetchEastmoneyTrendMap.mockReset();
    mocks.fetchExchangeShareMap.mockReset();

    mocks.getQuotes.mockResolvedValue({
      rows: [
        {
          code: '501300',
          name: '美元债LOF',
          category: 'LOF',
          marketPrice: 0.942,
          changeRate: -0.21,
          source: 'sina',
          sourceStatus: 'fallback',
          quoteTime: '2026-06-08 10:30:00',
        },
      ],
      source: 'sina',
      sourceStatus: 'fallback',
      errors: [],
    });
    mocks.getNavMap.mockResolvedValue(new Map([
      ['501300', {
        code: '501300',
        lastNav: 0.94,
        estimatedNav: 0.941,
        navSource: 'tiantian',
        estimatedNavSource: 'tiantian',
        navQuoteTime: '2026-06-08 10:30:00',
      }],
    ]));
    mocks.fetchEastmoneyQuoteMap.mockResolvedValue(new Map());
    mocks.fetchSinaQuoteMap.mockResolvedValue(new Map());
    mocks.fetchSubscriptionLimitMap.mockResolvedValue(new Map());
    mocks.fetchEastmoneyTrendMap.mockResolvedValue(new Map());
    mocks.fetchExchangeShareMap.mockResolvedValue(new Map());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not let slow non-LOF NAV supplements block the homepage quote snapshot', async () => {
    vi.useFakeTimers();
    mocks.getNavMap.mockReturnValue(new Promise((resolve) => {
      setTimeout(() => resolve(new Map([
        ['513100', {
          code: '513100',
          lastNav: 1.5,
          estimatedNav: 1.52,
          navSource: 'tiantian',
          estimatedNavSource: 'tiantian',
          navQuoteTime: '2026-06-08 10:30:00',
        }],
      ])), 5_000);
    }));

    mocks.getQuotes.mockResolvedValue({
      rows: [
        {
          code: '513100',
          name: '纳指ETF',
          category: 'QDII',
          marketPrice: 1.543,
          source: 'sina',
          sourceStatus: 'fallback',
          quoteTime: '2026-06-08 10:30:00',
        },
      ],
      source: 'sina',
      sourceStatus: 'fallback',
      errors: [],
    });

    const pending = getFundQuotes({ category: 'QDII', force: true, includeTrends: true });
    await vi.advanceTimersByTimeAsync(1_550);

    let settled = false;
    pending.then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    const snapshot = await pending;

    expect(snapshot.rows).toHaveLength(0);
    expect(snapshot.meta.warn).toContain('supplemental data timed out');
  });

  it('waits for critical LOF NAV before returning visible rows with prices', async () => {
    vi.useFakeTimers();
    mocks.getNavMap.mockReturnValue(new Promise((resolve) => {
      setTimeout(() => resolve(new Map([
        ['501300', {
          code: '501300',
          lastNav: 0.94,
          estimatedNav: 0.941,
          navSource: 'tiantian',
          estimatedNavSource: 'tiantian',
          navQuoteTime: '2026-06-08 10:30:00',
        }],
      ])), 5_000);
    }));

    const pending = getFundQuotes({ category: 'LOF', force: true, includeTrends: false });
    await vi.advanceTimersByTimeAsync(1_550);

    let settled = false;
    pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(3_400);
    const snapshot = await pending;

    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0].lastNav).toBe(0.94);
    expect(snapshot.rows[0].premiumRate).toBeCloseTo(0.1063, 4);
    expect(snapshot.meta.warn).not.toContain('nav supplemental data timed out');
  });

  it('hides LOF rows that still miss NAV and premium after the critical wait', async () => {
    vi.useFakeTimers();
    mocks.getNavMap.mockReturnValue(new Promise((resolve) => {
      setTimeout(() => resolve(new Map()), 30_000);
    }));

    const pending = getFundQuotes({ category: 'LOF', force: true, includeTrends: false });
    await vi.advanceTimersByTimeAsync(19_700);
    const snapshot = await pending;

    expect(snapshot.rows).toHaveLength(0);
    expect(snapshot.meta.allCount).toBe(1);
    expect(snapshot.meta.warn).toContain('critical NAV wait timed out');
    expect(snapshot.meta.warn).toContain('hidden incomplete critical rows: 501300');
  });

  it('reuses a recently built full snapshot instead of re-running supplement fetches', async () => {
    const first = await getFundQuotes({ category: 'LOF', includeTrends: false });
    const second = await getFundQuotes({ category: 'LOF', includeTrends: false });

    expect(first.rows).toHaveLength(1);
    expect(second.rows).toHaveLength(1);
    expect(mocks.getQuotes).toHaveBeenCalledTimes(1);
    expect(mocks.getNavMap).toHaveBeenCalledTimes(1);
    expect(mocks.fetchEastmoneyQuoteMap).toHaveBeenCalledTimes(1);
    expect(mocks.fetchSinaQuoteMap).toHaveBeenCalledTimes(1);
  });

  it('returns a complete cached snapshot immediately during forced refresh', async () => {
    const first = await getFundQuotes({ category: 'LOF', includeTrends: false });
    const forced = await getFundQuotes({ category: 'LOF', force: true, includeTrends: false });

    expect(first.rows).toHaveLength(1);
    expect(forced.rows).toHaveLength(1);
    expect(forced.rows[0].lastNav).toBe(0.94);
    expect(forced.rows[0].premiumRate).toBeCloseTo(0.1063, 4);
    expect(forced.meta.status).toBe('refreshing');
    expect(forced.meta.stale).toBe(true);
    expect(forced.meta.warn).toContain('后台刷新中');
  });

  it('deduplicates concurrent forced snapshot builds to avoid request storms', async () => {
    let resolveNav;
    mocks.getNavMap.mockReturnValue(new Promise((resolve) => {
      resolveNav = resolve;
    }));

    const first = getFundQuotes({ category: 'LOF', force: true, includeTrends: false });
    const second = getFundQuotes({ category: 'LOF', force: true, includeTrends: false });
    await Promise.resolve();

    expect(mocks.getQuotes).toHaveBeenCalledTimes(1);
    expect(mocks.getNavMap).toHaveBeenCalledTimes(1);

    resolveNav(new Map([
      ['501300', {
        code: '501300',
        lastNav: 0.94,
        estimatedNav: 0.941,
        navSource: 'tiantian',
        estimatedNavSource: 'tiantian',
        navQuoteTime: '2026-06-08 10:30:00',
      }],
    ]));

    const [firstSnapshot, secondSnapshot] = await Promise.all([first, second]);

    expect(firstSnapshot).toBe(secondSnapshot);
    expect(firstSnapshot.rows).toHaveLength(1);
    expect(firstSnapshot.rows[0].premiumRate).toBeCloseTo(0.1063, 4);
  });
});
