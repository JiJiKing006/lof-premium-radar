import { describe, expect, it } from 'vitest';
import { parseEastmoneyFundNavFromScript } from './eastmoneyFundNavSource.js';

describe('eastmoneyFundNavSource', () => {
  it('parses the latest official NAV from Eastmoney pingzhongdata script', () => {
    const script = `
      var fS_name = "嘉实原油(QDII-LOF)";
      var fS_code = "160723";
      var Data_netWorthTrend = [
        {"x":1779984000000,"y":2.0258,"equityReturn":1.2,"unitMoney":""},
        {"x":1780243200000,"y":2.1044,"equityReturn":3.98,"unitMoney":""}
      ];
    `;

    expect(parseEastmoneyFundNavFromScript('160723', script)).toEqual({
      code: '160723',
      name: '嘉实原油(QDII-LOF)',
      lastNav: 2.1044,
      estimatedNav: null,
      navDate: '2026-06-01',
      navQuoteTime: '2026-06-01 00:00:00',
      navSource: 'eastmoney',
      updateTime: expect.any(String),
    });
  });
});
