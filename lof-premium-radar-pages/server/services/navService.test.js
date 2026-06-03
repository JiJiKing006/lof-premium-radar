import { describe, expect, it } from 'vitest';
import { isNasdaqTechnologyQuote, selectEastmoneyNavCodes, selectTiantianCodes } from './navService.js';

describe('navService', () => {
  it('includes Nasdaq technology ETFs in Tiantian NAV supplementation', () => {
    const codes = selectTiantianCodes([
      { code: '513100', name: '纳指ETF', category: 'ETF', turnover: 100 },
      { code: '159941', name: '纳指ETF广发', category: 'ETF', turnover: 90 },
      { code: '588000', name: '科创ETF', category: 'ETF', turnover: 1_000 },
      { code: '161128', name: '标普科技', category: 'QDII', turnover: 10 },
    ]);

    expect(codes).toContain('513100');
    expect(codes).toContain('159941');
    expect(codes).toContain('161128');
    expect(codes).not.toContain('588000');
  });

  it('recognizes Nasdaq technology candidates without matching unrelated Hong Kong technology funds', () => {
    expect(isNasdaqTechnologyQuote({ code: '513100', name: '纳指ETF' })).toBe(true);
    expect(isNasdaqTechnologyQuote({ code: '159509', name: '纳斯达克科技ETF' })).toBe(true);
    expect(isNasdaqTechnologyQuote({ code: '161128', name: '标普科技' })).toBe(true);
    expect(isNasdaqTechnologyQuote({ code: '513180', name: '恒生科技ETF华夏' })).toBe(false);
  });

  it('selects LOF rows with missing or Palmmicro-derived NAV for Eastmoney NAV cross-check', () => {
    const navMap = new Map([
      ['160723', { code: '160723', lastNav: 3.28, navSource: 'lof' }],
      ['161125', { code: '161125', lastNav: 3.13, navSource: 'tiantian' }],
      ['501300', { code: '501300', lastNav: null, navSource: '' }],
    ]);

    expect(selectEastmoneyNavCodes([
      { code: '160723', category: 'LOF' },
      { code: '161125', category: 'LOF' },
      { code: '501300', category: 'LOF' },
      { code: '513100', category: 'QDII' },
    ], navMap)).toEqual(['160723', '501300']);
  });
});
