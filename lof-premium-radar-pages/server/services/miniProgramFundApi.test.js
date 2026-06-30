import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function loadMiniProgramModule(filename, moduleCache = new Map()) {
  const absolutePath = path.resolve(filename);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;

  const module = { exports: {} };
  moduleCache.set(absolutePath, module);
  const source = fs.readFileSync(absolutePath, 'utf8');
  const localRequire = (request) => {
    const target = path.resolve(path.dirname(absolutePath), request.endsWith('.js') ? request : `${request}.js`);
    return loadMiniProgramModule(target, moduleCache);
  };
  const factory = new vm.Script(`(function (require, module, exports) { ${source}\n})`, {
    filename: absolutePath,
  }).runInThisContext();
  factory(localRequire, module, module.exports);
  return module.exports;
}

describe('mini-program fund API normalization', () => {
  it('keeps the fund-api facade exports wired to the extracted normalizer', () => {
    const cache = new Map();
    const facade = loadMiniProgramModule(path.resolve('utils/fund-api.js'), cache);
    const normalizer = loadMiniProgramModule(path.resolve('utils/fund-normalizer.js'), cache);

    expect(facade.normalizeFund).toBe(normalizer.normalizeFund);
    expect(facade.normalizeMeta).toBe(normalizer.normalizeMeta);
    expect(facade.mergeStablePurchaseStatuses).toBe(normalizer.mergeStablePurchaseStatuses);
  });

  it('sends table queries as POST JSON so filters and snapshot ids are not encoded into the URL', async () => {
    const originalWx = globalThis.wx;
    const request = vi.fn((options) => options.success({
      statusCode: 200,
      data: { meta: { pagination: { snapshotId: 'snapshot-1' } }, rows: [] },
    }));
    globalThis.wx = {
      getStorageSync: () => '',
      request,
    };

    try {
      const { fetchFundsSnapshot } = loadMiniProgramModule(path.resolve('utils/fund-api.js'));
      await fetchFundsSnapshot({
        fields: 'home', page: 2, pageSize: 30, query: '全球芯片',
        excludePausedPurchase: true, snapshotId: 'snapshot-1', requestMode: 'page',
      });

      expect(request).toHaveBeenCalledTimes(1);
      expect(request.mock.calls[0][0]).toMatchObject({
        method: 'POST',
        url: expect.stringContaining('/api/funds/quotes/page'),
        data: expect.objectContaining({
          page: '2', query: '全球芯片', snapshotId: 'snapshot-1', excludePausedPurchase: '1',
        }),
      });
    } finally {
      globalThis.wx = originalWx;
    }
  });

  it('keeps refresh requests on the frozen refresh endpoint and preserves filter parameters', async () => {
    const originalWx = globalThis.wx;
    const request = vi.fn((options) => options.success({ statusCode: 200, data: { meta: {}, rows: [] } }));
    globalThis.wx = { getStorageSync: () => '', request };

    try {
      const { fetchFundsSnapshot } = loadMiniProgramModule(path.resolve('utils/fund-api.js'));
      await fetchFundsSnapshot({
        requestMode: 'refresh', section: 'LOF', force: true, marketFilter: 'T+3',
        sortKey: 'premiumRate', sortDirection: 'desc', includeTrends: false,
      });

      expect(request.mock.calls[0][0]).toMatchObject({
        method: 'POST',
        url: expect.stringContaining('/api/funds/quotes/refresh'),
        data: expect.objectContaining({
          category: 'LOF', force: '1', marketFilter: 'T+3', sortKey: 'premiumRate', sortDirection: 'desc', trends: '0',
        }),
      });
    } finally {
      globalThis.wx = originalWx;
    }
  });

  it('keeps the last verified purchase status when refresh only returns unavailable', () => {
    const { normalizeFund, mergeStablePurchaseStatuses } = loadMiniProgramModule(path.resolve('utils/fund-api.js'));
    const meta = { sourceProvider: 'eastmoney', updateTime: '2026-06-27 15:00:00' };
    const previous = normalizeFund({
      code: '501200', name: '科技创新LOF', category: 'LOF', marketPrice: 1.2, lastNav: 1.1, premiumRate: 9,
      purchaseLimit: { state: 'limited', label: '限大额 1000元', source: 'tiantian', updateTime: '2026-06-27 14:59:58' },
    }, meta);
    const incoming = normalizeFund({
      code: '501200', name: '科技创新LOF', category: 'LOF', marketPrice: 1.21, lastNav: 1.1, premiumRate: 10,
      purchaseLimit: { state: 'unavailable', label: '暂无数据' },
    }, meta);

    const [merged] = mergeStablePurchaseStatuses([previous], [incoming]);

    expect(merged.marketPrice).toBe(1.21);
    expect(merged.purchaseLimit).toMatchObject({
      state: 'limited', label: '限大额 1000元', source: 'tiantian', carriedForward: true,
    });
    expect(merged.subscriptionTime).toBe('2026-06-27 14:59:58');
    expect(merged.purchaseStatusCarriedForward).toBe(true);
  });

  it('normalizes an unknown purchase status to an explicit unavailable state', () => {
    const { normalizeFund } = loadMiniProgramModule(path.resolve('utils/fund-api.js'));
    const fund = normalizeFund({
      code: '162719',
      name: '石油LOF',
      category: 'LOF',
      marketPrice: 1.1,
      lastNav: 1,
      premiumRate: 10,
      purchaseLimit: { state: 'unknown', label: '未知' },
      source: 'sina',
      updateTime: '2026-06-27 15:00:00',
    }, { sourceProvider: 'sina', updateTime: '2026-06-27 15:00:00' });

    expect(fund.purchaseLimit).toMatchObject({ state: 'unavailable', label: '暂无数据' });
    expect(fund.subscriptionStatus).toBe('暂无数据');
  });

  it('keeps an already normalized fund intact when a page applies it again', () => {
    const { normalizeFund } = loadMiniProgramModule(path.resolve('utils/fund-api.js'));
    const meta = { sourceProvider: 'eastmoney', updateTime: '2026-06-27 14:30:00' };
    const first = normalizeFund({
      code: '501200',
      name: '民生加银科技创新混合(LOF)',
      category: 'LOF',
      marketPrice: 1.271,
      lastNav: 1.0943,
      premiumRate: 16.15,
      source: 'eastmoney',
      updateTime: '2026-06-27 14:30:00',
    }, meta);

    const second = normalizeFund(first, meta);

    expect(second).toBe(first);
    expect(second).toMatchObject({
      code: '501200',
      type: 'LOF',
      settlementCycle: 'T+2',
      premiumRate: 16.15,
      source: 'eastmoney',
      updateTime: '2026-06-27 14:30:00',
    });
  });
});
