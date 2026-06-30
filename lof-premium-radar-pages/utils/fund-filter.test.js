import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const filename = path.resolve('utils/fund-filter.js');
const module = { exports: {} };
new vm.Script(`(function (module, exports) { ${fs.readFileSync(filename, 'utf8')}\n})`, { filename })
  .runInThisContext()(module, module.exports);

const { filterAndSortFunds } = module.exports;

describe('首页基金过滤与搜索', () => {
  const completeLof = {
    code: '501225', name: '全球芯片LOF', type: 'LOF', marketPrice: 4.6, lastNav: 3.5, premiumRate: 31.43,
  };
  const pausedFund = {
    code: '161130', name: '纳指LOF', type: 'LOF', marketPrice: 1.23, lastNav: 1.1, premiumRate: 8.4,
    purchaseLimit: { state: 'paused', label: '暂停申购' }, turnover: 25_000_000, settlementCycle: 'T+3'
  };
  const openFund = {
    code: '160216', name: '国企LOF', type: 'LOF', marketPrice: 1.42, lastNav: 1.3, premiumRate: 9.23,
    purchaseLimit: { state: 'open', label: '开放申购' }, turnover: 8_000_000, settlementCycle: 'T+2'
  };
  const limitedFund = {
    code: '162207', name: '泰达LOF', type: 'LOF', marketPrice: 1.85, lastNav: 1.7, premiumRate: 12.8,
    purchaseLimit: { state: 'limited', label: '单日限100元', dailyLimit: 100 }, turnover: 62_800, settlementCycle: 'T+2'
  };

  it('只展示现价、官方净值和实时溢价率完整的 LOF', () => {
    const rows = filterAndSortFunds([
      completeLof,
      { code: '513100', name: '纳指ETF', type: 'ETF', marketPrice: 2.1, lastNav: 2, premiumRate: 5 },
      { code: '161130', name: '纳斯达克100LOF', type: 'LOF', marketPrice: 4.6, lastNav: null, premiumRate: null },
    ], state());

    expect(rows.map((row) => row.code)).toEqual(['501225']);
  });

  it('按名称或代码搜索并允许没有匹配结果', () => {
    expect(filterAndSortFunds([completeLof], state({ query: '芯片' })).map((row) => row.code)).toEqual(['501225']);
    expect(filterAndSortFunds([completeLof], state({ query: '501225' })).map((row) => row.code)).toEqual(['501225']);
    expect(filterAndSortFunds([completeLof], state({ query: '国联' }))).toEqual([]);
  });

  it('支持申购状态多选，全部为空选择', () => {
    const rows = [pausedFund, openFund, limitedFund];

    expect(filterAndSortFunds(rows, state({ purchaseStatusFilters: ['PAUSED'] })).map((row) => row.code)).toEqual(['161130']);
    expect(filterAndSortFunds(rows, state({ purchaseStatusFilters: ['OPEN', 'LIMITED'] })).map((row) => row.code)).toEqual(['162207', '160216']);
    expect(filterAndSortFunds(rows, state({ purchaseStatusFilters: [] })).map((row) => row.code)).toEqual(['162207', '160216', '161130']);
  });

  it('支持按赎回时间、差值区间和成交额大于多少万元联合筛选', () => {
    const rows = [pausedFund, openFund, limitedFund];

    expect(filterAndSortFunds(rows, state({
      redemptionFilter: 'T+2',
      premiumMin: '9',
      premiumMax: '13',
      turnoverMin: '500'
    })).map((row) => row.code)).toEqual(['160216']);
  });

  it('成交额万元阈值使用真实元值比较，且为严格大于', () => {
    const exactlyFiveMillion = { ...openFund, code: '160217', turnover: 5_000_000 };
    expect(filterAndSortFunds([openFund, exactlyFiveMillion], state({ turnoverMin: '500' })).map((row) => row.code)).toEqual(['160216']);
  });

  it('隐藏暂停只在开启时生效，不会误伤其他完整数据', () => {
    const rows = [pausedFund, openFund, limitedFund];

    expect(filterAndSortFunds(rows, state({ excludePausedPurchase: true })).map((row) => row.code)).toEqual(['162207', '160216']);
    expect(filterAndSortFunds(rows, state({ excludePausedPurchase: false })).map((row) => row.code)).toEqual(['162207', '160216', '161130']);
  });
});

function state(overrides = {}) {
  return {
    query: '', marketFilter: 'ALL', excludePausedPurchase: false,
    purchaseStatusFilters: [], redemptionFilter: 'ALL',
    premiumMin: '', premiumMax: '', turnoverMin: '',
    sortKey: 'premiumRate', sortDirection: 'desc', ...overrides,
  };
}
