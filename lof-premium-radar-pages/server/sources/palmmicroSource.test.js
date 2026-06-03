import { describe, expect, it } from 'vitest';
import { parsePalmmicroLofReferenceRowsFromHtml } from './palmmicroSource.js';

describe('palmmicroSource', () => {
  it('parses the 参考数据 table as the LOF reference list in table order', () => {
    const html = `
      <table id="referencetable">
        <tr><th>代码</th><th>价格</th><th>涨幅</th><th>日期</th><th>时间</th><th>名称</th></tr>
        <tr><td>SH501300</td><td>0.942</td><td>-0.21%</td><td>2026-06-02</td><td>15:00</td><td>美元债LOF</td></tr>
        <tr><td>SZ160140</td><td>1.392</td><td>-1.76%</td><td>2026-06-02</td><td>15:00</td><td>美国REIT精选LOF</td></tr>
        <tr><td>SZ161126</td><td>1.853</td><td>-0.7%</td><td>2026-06-02</td><td>15:00</td><td>标普医疗保健LOF</td></tr>
      </table>
      <table>
        <tr><th>代码</th><th>官方EST</th></tr>
        <tr><td>SZ162719</td><td>2.716</td></tr>
      </table>
    `;

    expect(parsePalmmicroLofReferenceRowsFromHtml(html).map((row) => ({
      code: row.code,
      name: row.name,
      marketPrice: row.marketPrice,
      changeRate: row.changeRate,
      quoteTime: row.quoteTime,
      market: row.market,
    }))).toEqual([
      {
        code: '501300',
        name: '美元债LOF',
        marketPrice: 0.942,
        changeRate: -0.21,
        quoteTime: '2026-06-02 15:00:00',
        market: '债券',
      },
      {
        code: '160140',
        name: '美国REIT精选LOF',
        marketPrice: 1.392,
        changeRate: -1.76,
        quoteTime: '2026-06-02 15:00:00',
        market: '美股',
      },
      {
        code: '161126',
        name: '标普医疗保健LOF',
        marketPrice: 1.853,
        changeRate: -0.7,
        quoteTime: '2026-06-02 15:00:00',
        market: '美股',
      },
    ]);
  });
});
