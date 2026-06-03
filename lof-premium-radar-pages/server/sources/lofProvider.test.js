import { describe, expect, it } from 'vitest';
import { parseLofHtml } from './lofProvider.js';

describe('lofProvider', () => {
  it('parses the estimation table instead of the reference quote table', () => {
    const snapshot = parseLofHtml(`
      <html>
        <head><title>LOF基金</title></head>
        <body>
          <table id="referencetable">
            <tr><th>代码</th><th>价格</th><th>涨幅</th><th>日期</th><th>时间</th><th>名称</th></tr>
            <tr><td>SH501225</td><td>4.545</td><td>4.7%</td><td>2026-06-03</td><td>15:00</td><td>全球芯片LOF</td></tr>
          </table>
          <table id="estimationtable">
            <tr>
              <th>代码</th><th>官方EST</th><th>EST日期</th><th>溢价</th>
              <th>参考EST</th><th>溢价</th><th>实时EST</th><th>溢价</th>
            </tr>
            <tr>
              <td><a href="/woody/res/lofcn.php?code=SH501225">SH501225</a></td>
              <td>3.342</td><td>2026-06-02</td><td>36%</td>
              <td>3.371</td><td>34.81%</td><td></td><td></td>
            </tr>
          </table>
        </body>
      </html>
    `, 'https://palmmicro.com/woody/res/lofcn.php?sort=premium');

    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0]).toMatchObject({
      code: 'SH501225',
      name: '全球芯片LOF',
      officialEstValue: 3.342,
      estDate: '2026-06-02',
      officialPremiumValue: 36,
      referenceEstValue: 3.371,
      referencePremiumValue: 34.81,
      realtimeEstValue: null,
    });
  });
});
