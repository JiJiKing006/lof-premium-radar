import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function loadCommonJs(filename) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.resolve(filename), 'utf8');
  const factory = new vm.Script(`(function (module, exports) { ${source}\n})`).runInThisContext();
  factory(module, module.exports);
  return module.exports;
}

const filters = loadCommonJs('pages/index/index-filters.js');
const pagination = loadCommonJs('pages/index/index-pagination.js');

describe('index state helpers', () => {
  it('keeps default and watch filter states unchanged', () => {
    expect(filters.filterStateForSection('ALL')).toEqual({
      purchaseStatusFilters: ['OPEN', 'LIMITED'], redemptionFilter: 'ALL', turnoverMin: '500',
    });
    expect(filters.filterStateForSection('WATCH')).toEqual({
      purchaseStatusFilters: [], redemptionFilter: 'ALL', turnoverMin: '',
    });
    expect(filters.effectivePageSize({ purchaseStatusFilters: ['OPEN'] }, 'ALL')).toBe(500);
    expect(filters.effectivePageSize({}, 'WATCH')).toBe(30);
  });

  it('keeps draft validation and active filter counting unchanged', () => {
    expect(filters.validateDraftFilters({ draftTurnoverMin: '-1' })).toBe('成交额不能小于0万元');
    expect(filters.validateDraftFilters({ draftTurnoverMin: '500' })).toBe('');
    expect(filters.countActiveFilters({ purchaseStatusFilters: ['OPEN', 'OPEN'], redemptionFilter: 'T+3', turnoverMin: '500' })).toBe(3);
  });

  it('keeps pagination append order and visible slicing unchanged', () => {
    const rows = pagination.appendUniqueFunds([{ code: '160001' }], [{ code: '160001' }, { code: '160002' }]);
    expect(rows.map((row) => row.code)).toEqual(['160001', '160002']);
    expect(pagination.visibleFundsForPage(Array.from({ length: 70 }, (_, index) => ({ code: String(index) })), 2, 30)).toHaveLength(60);
  });

  it('keeps remembered section state fields unchanged', () => {
    const data = {
      meta: { updateTime: '2026-06-30 10:00:00' }, query: '', marketFilter: 'ALL', excludePausedPurchase: false,
      purchaseStatusFilters: ['OPEN'], redemptionFilter: 'ALL', turnoverMin: '500', sortKey: 'premiumRate',
      sortDirection: 'desc', lastSuccessAt: '2026-06-30 10:00:00', abnormalCount: 0,
    };
    expect(pagination.buildRememberedSectionState({ funds: [{ code: '160001' }], data, visiblePage: 2, filteredFunds: [] })).toMatchObject({
      funds: [{ code: '160001' }], visiblePage: 2, purchaseStatusFilters: ['OPEN'], sortKey: 'premiumRate',
    });
  });
});
