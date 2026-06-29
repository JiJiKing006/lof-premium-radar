import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getQuotes: vi.fn(),
  getNavMap: vi.fn(),
  getSingleNav: vi.fn(),
  getLofPremiumReferenceMap: vi.fn(),
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
  getSingleNav: mocks.getSingleNav,
  getLofPremiumReferenceMap: mocks.getLofPremiumReferenceMap,
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

const { getFundDetail, getFundQuotePage, getFundQuotes } = await import('./fundAggregator.js');
const { cache } = await import('./cacheService.js');

describe('fundAggregator performance', () => {
  beforeEach(() => {
    vi.useRealTimers();
    cache.items.clear();
    cache.lastValid.clear();
    cache.lastObserved.clear();
    mocks.getQuotes.mockReset();
    mocks.getNavMap.mockReset();
    mocks.getSingleNav.mockReset();
    mocks.getLofPremiumReferenceMap.mockReset();
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
          turnover: 2_000_000,
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
    mocks.getSingleNav.mockResolvedValue(null);
    mocks.getLofPremiumReferenceMap.mockResolvedValue(new Map());
    mocks.fetchEastmoneyQuoteMap.mockResolvedValue(new Map());
    mocks.fetchSinaQuoteMap.mockResolvedValue(new Map());
    mocks.fetchSubscriptionLimitMap.mockResolvedValue(new Map());
    mocks.fetchEastmoneyTrendMap.mockResolvedValue(new Map());
    mocks.fetchExchangeShareMap.mockResolvedValue(new Map());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('forces the target premium website into the same manual-refresh response', async () => {
    mocks.getLofPremiumReferenceMap.mockResolvedValue(new Map([
      ['501300', {
        value: 0.95, source: 'lof', kind: 'official-estimate', estimateDate: '2026-06-08',
        quoteTime: '2026-06-08 10:30:00', stale: false,
      }],
    ]));

    const snapshot = await getFundQuotes({
      category: 'LOF', force: true, waitForFresh: true, includeTrends: false,
    });

    expect(mocks.getLofPremiumReferenceMap).toHaveBeenCalledWith({ force: true });
    expect(mocks.getNavMap).toHaveBeenCalledWith(expect.any(Array), { force: true });
    expect(snapshot.rows[0]).toMatchObject({
      estimatedNav: 0.95,
      premiumBasis: 'estimatedNav',
      premiumNote: '基于目标网站估值（非官方净值）',
    });
  });

  it('reports target premium source failure while falling back to the official NAV basis', async () => {
    mocks.getLofPremiumReferenceMap.mockRejectedValue(new Error('源站限流'));

    const snapshot = await getFundQuotes({
      category: 'LOF', force: true, waitForFresh: true, includeTrends: false,
    });

    expect(snapshot.meta.warn).toContain('premium-reference supplemental data failed: 源站限流');
    expect(snapshot.rows[0].premiumBasis).toBe('lastNav');
    expect(snapshot.rows[0].premiumRate).toBeCloseTo((0.942 / 0.94 - 1) * 100, 8);
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
          turnover: 2_000_000,
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
    await vi.advanceTimersByTimeAsync(250);

    let settled = false;
    pending.then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    const snapshot = await pending;

    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0].premiumRate).toBeNull();
    expect(snapshot.meta.warn).toContain('supplemental data timed out');
  });

  it('returns LOF rows within budget and fills official NAV in the background', async () => {
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
    await vi.advanceTimersByTimeAsync(250);

    let settled = false;
    pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    const snapshot = await pending;

    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0].lastNav).toBeNull();
    expect(snapshot.rows[0].premiumRate).toBeNull();
    expect(snapshot.meta.warn).toContain('nav supplemental data timed out');

    await vi.advanceTimersByTimeAsync(4_650);
    const completed = getFundQuotePage({ category: 'LOF', includeTrends: false });
    expect(completed.rows[0].lastNav).toBe(0.94);
    expect(completed.rows[0].premiumRate).toBeCloseTo(0.2128, 4);
  });

  it('keeps LOF rows visible with an explicit pending valuation when NAV is slow', async () => {
    vi.useFakeTimers();
    mocks.getNavMap.mockReturnValue(new Promise((resolve) => {
      setTimeout(() => resolve(new Map()), 30_000);
    }));

    const pending = getFundQuotes({ category: 'LOF', force: true, includeTrends: false });
    await vi.advanceTimersByTimeAsync(700);
    const snapshot = await pending;

    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0].premiumRate).toBeNull();
    expect(snapshot.meta.allCount).toBe(1);
    expect(snapshot.meta.warn).toContain('nav supplemental data timed out');
    expect(snapshot.meta.warn).toContain('critical fields pending: 501300');
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

  it('主动刷新立即返回已展示快照并在后台更新', async () => {
    const first = await getFundQuotes({ category: 'LOF', includeTrends: false });
    const forced = await getFundQuotes({ category: 'LOF', force: true, includeTrends: false });

    expect(first.rows).toHaveLength(1);
    expect(forced.rows).toHaveLength(1);
    expect(forced.meta.status).toBe('refreshing');
    expect(forced.meta.stale).toBe(true);
    await vi.waitFor(() => expect(mocks.getQuotes).toHaveBeenCalledTimes(2));
  });

  it('分页只读取已有稳定快照，不重新请求外部数据源', async () => {
    await getFundQuotes({ category: 'LOF', includeTrends: false });
    const callsBeforePage = mocks.getQuotes.mock.calls.length;

    const snapshot = getFundQuotePage({ category: 'LOF', includeTrends: false });

    expect(snapshot.rows).toHaveLength(1);
    expect(mocks.getQuotes).toHaveBeenCalledTimes(callsBeforePage);
  });

  it('短期首页快照过期后分页仍读取最后一次已展示数据', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-28T10:00:00+08:00'));
    await getFundQuotes({ category: 'LOF', includeTrends: false });
    vi.setSystemTime(new Date('2026-06-28T10:00:10+08:00'));

    const snapshot = getFundQuotePage({ category: 'LOF', includeTrends: false });

    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0].code).toBe('501300');
  });

  it('短期首页快照过期后立即回显已展示数据并后台刷新', async () => {
    const key = 'fund-quotes:snapshot:ALL:trends:0';
    const rows = Array.from({ length: 120 }, (_, index) => ({
      code: `16${String(index).padStart(4, '0')}`,
      name: `已展示基金${index + 1}`,
      category: 'LOF',
      marketPrice: 1,
      source: 'sina',
      updateTime: '2026-06-28 10:00:00',
    }));
    cache.setTransient(key, {
      meta: { status: 'ok', sourceStatus: 'cache', updateTime: '2026-06-28 10:00:00' },
      rows,
    }, 5_000);
    cache.items.get(key).expiresAt = Date.now() - 1;

    const quoteResolvers = [];
    mocks.getQuotes.mockImplementation(() => new Promise((resolve) => quoteResolvers.push(resolve)));

    const snapshot = await getFundQuotes({ category: 'ALL', includeTrends: false });

    expect(snapshot.rows).toHaveLength(120);
    expect(snapshot.meta.status).toBe('refreshing');
    expect(snapshot.meta.warn).toContain('先返回上一份已展示快照');
    expect(quoteResolvers).toHaveLength(3);

    quoteResolvers.forEach((resolve) => resolve({
      rows: [],
      source: 'test',
      sourceStatus: 'cache',
      errors: [],
    }));
    await vi.waitFor(() => expect(mocks.getNavMap).toHaveBeenCalled());
  });

  it('详情优先命中首页快照，不再触发聚合请求', async () => {
    await getFundQuotes({ category: 'LOF', includeTrends: false });
    const callsBeforeDetail = mocks.getQuotes.mock.calls.length;

    const fund = await getFundDetail('501300', { category: 'LOF' });

    expect(fund.code).toBe('501300');
    expect(fund.updateTime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(mocks.getQuotes).toHaveBeenCalledTimes(callsBeforeDetail);
  });

  it('详情聚合快照偶发缺行时使用真实单基金行情补查', async () => {
    mocks.getQuotes.mockResolvedValue({ rows: [], source: 'sina', sourceStatus: 'fallback', errors: [] });
    mocks.fetchEastmoneyQuoteMap.mockResolvedValue(new Map([
      ['501225', {
        code: '501225', name: '全球芯片LOF', category: 'LOF', marketPrice: 4.6,
        source: 'eastmoney', sourceStatus: 'primary', quoteTime: '2026-06-29 10:00:00',
      }],
    ]));
    mocks.getSingleNav.mockResolvedValue({
      code: '501225', lastNav: 3.5, navSource: 'tiantian', navQuoteTime: '2026-06-28 22:00:00',
    });

    const fund = await getFundDetail('501225', { category: 'LOF' });

    expect(fund).toMatchObject({
      code: '501225', name: '全球芯片LOF', marketPrice: 4.6, lastNav: 3.5,
      source: 'eastmoney', navSource: 'tiantian',
    });
    expect(fund.premiumRate).toBeCloseTo(31.4286, 4);
  });

  it('详情接口超过 1.5 秒仍继续等待真实数据', async () => {
    vi.useFakeTimers();
    const payload = {
      rows: [{ code: '501300', name: '美元债LOF', category: 'LOF', marketPrice: 0.942, source: 'sina', sourceStatus: 'primary', quoteTime: '2026-06-08 10:30:00' }],
      source: 'sina', sourceStatus: 'primary', errors: [],
    };
    mocks.getQuotes.mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve(payload), 2_000);
    }));

    const pending = getFundDetail('501300', { category: 'LOF' });
    let settled = false;
    pending.finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(500);

    await expect(pending).resolves.toMatchObject({ code: '501300', marketPrice: 0.942 });
  });

  it('returns a complete cached snapshot immediately during forced refresh', async () => {
    const rows = Array.from({ length: 80 }, (_, index) => ({
      code: `501${String(index + 300).padStart(3, '0')}`,
      name: `美元债LOF${index + 1}`,
      category: 'LOF',
      marketPrice: 0.942,
      changeRate: -0.21,
      turnover: 2_000_000,
      source: 'sina',
      sourceStatus: 'fallback',
      quoteTime: '2026-06-08 10:30:00',
    }));
    mocks.getQuotes.mockResolvedValue({
      rows,
      source: 'sina',
      sourceStatus: 'fallback',
      errors: [],
    });
    mocks.getNavMap.mockImplementation((quoteRows) => Promise.resolve(new Map(quoteRows.map((row) => [
      row.code,
      {
        code: row.code,
        lastNav: 0.94,
        estimatedNav: 0.941,
        navSource: 'tiantian',
        estimatedNavSource: 'tiantian',
        navQuoteTime: '2026-06-08 10:30:00',
      },
    ]))));

    const first = await getFundQuotes({ category: 'LOF', includeTrends: false });
    const forced = await getFundQuotes({ category: 'LOF', force: true, includeTrends: false });

    expect(first.rows).toHaveLength(80);
    expect(forced.rows).toHaveLength(80);
    expect(forced.rows[0].lastNav).toBe(0.94);
    expect(forced.rows[0].premiumRate).toBeCloseTo(0.2128, 4);
    expect(forced.meta.status).toBe('refreshing');
    expect(forced.meta.stale).toBe(true);
    expect(forced.meta.warn).toContain('后台刷新中');
    await vi.waitFor(() => expect(mocks.getQuotes).toHaveBeenCalledTimes(2));
  });

  it('returns the previous complete snapshot immediately after ttl while refreshing in background', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T10:30:00+08:00'));
    const rows = Array.from({ length: 80 }, (_, index) => ({
      code: `501${String(index + 300).padStart(3, '0')}`,
      name: `美元债LOF${index + 1}`,
      category: 'LOF',
      marketPrice: 0.942,
      changeRate: -0.21,
      turnover: 2_000_000,
      source: 'sina',
      sourceStatus: 'fallback',
      quoteTime: '2026-06-08 10:30:00',
    }));
    mocks.getQuotes.mockResolvedValue({
      rows,
      source: 'sina',
      sourceStatus: 'fallback',
      errors: [],
    });
    mocks.getNavMap.mockImplementation((quoteRows) => Promise.resolve(new Map(quoteRows.map((row) => [
      row.code,
      {
        code: row.code,
        lastNav: 0.94,
        estimatedNav: 0.941,
        navSource: 'tiantian',
        estimatedNavSource: 'tiantian',
        navQuoteTime: '2026-06-08 10:30:00',
      },
    ]))));

    const first = await getFundQuotes({ category: 'LOF', includeTrends: false });
    vi.setSystemTime(new Date('2026-06-08T10:31:00+08:00'));
    const second = await getFundQuotes({ category: 'LOF', includeTrends: false });

    expect(first.rows).toHaveLength(80);
    expect(second.rows).toHaveLength(80);
    expect(second.meta.status).toBe('refreshing');
    expect(second.meta.stale).toBe(true);
    expect(second.meta.warn).toContain('后台刷新中');
    await vi.waitFor(() => expect(mocks.getQuotes).toHaveBeenCalledTimes(2));
  });

  it('deduplicates concurrent forced snapshot builds to avoid request storms', async () => {
    let resolveNav;
    mocks.getNavMap.mockReturnValue(new Promise((resolve) => {
      resolveNav = resolve;
    }));

    const first = getFundQuotes({ category: 'LOF', force: true, includeTrends: false });
    const second = getFundQuotes({ category: 'LOF', force: true, includeTrends: false });
    await vi.waitFor(() => expect(mocks.getNavMap).toHaveBeenCalledTimes(1));
    expect(mocks.getQuotes).toHaveBeenCalledTimes(1);

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
    expect(firstSnapshot.rows[0].premiumRate).toBeCloseTo(0.2128, 4);
  });

  it('waits for an existing background build and then performs a fresh manual-refresh build', async () => {
    await getFundQuotes({ category: 'LOF', includeTrends: false });

    let resolveBackground;
    mocks.getQuotes
      .mockImplementationOnce(() => new Promise((resolve) => { resolveBackground = resolve; }))
      .mockResolvedValueOnce({
        rows: [{
          code: '501300', name: '美元债LOF', category: 'LOF', marketPrice: 1.02,
          changeRate: 1.2, turnover: 3_000_000, source: 'sina', sourceStatus: 'fallback',
          quoteTime: '2026-06-08 10:31:00',
        }],
        source: 'sina', sourceStatus: 'fallback', errors: [],
      });

    await getFundQuotes({ category: 'LOF', force: true, waitForFresh: false, includeTrends: false });
    const manualRefresh = getFundQuotes({ category: 'LOF', force: true, waitForFresh: true, includeTrends: false });

    resolveBackground({
      rows: [{
        code: '501300', name: '美元债LOF', category: 'LOF', marketPrice: 0.95,
        changeRate: 0.1, turnover: 0, source: 'sina', sourceStatus: 'fallback',
        quoteTime: '2026-06-08 10:30:30',
      }],
      source: 'sina', sourceStatus: 'fallback', errors: [],
    });

    const snapshot = await manualRefresh;

    expect(mocks.getQuotes).toHaveBeenCalledTimes(3);
    expect(snapshot.rows[0]).toMatchObject({ marketPrice: 1.02, turnover: 3_000_000 });
  });
});
