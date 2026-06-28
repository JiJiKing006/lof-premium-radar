import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

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
