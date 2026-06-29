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
});

function state(overrides = {}) {
  return {
    query: '', marketFilter: 'ALL', excludePausedPurchase: false,
    sortKey: 'premiumRate', sortDirection: 'desc', ...overrides,
  };
}
