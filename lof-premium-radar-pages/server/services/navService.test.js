import { describe, expect, it } from 'vitest';
import { mergeHaoetfNavRow, mergeLofNavRow, isNasdaqTechnologyQuote, selectEastmoneyNavCodes, selectTiantianCodes } from './navService.js';

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

  it('uses Palmmicro reference EST as an estimated NAV fallback for LOF rows without realtime EST', () => {
    const row = mergeLofNavRow({}, {
      code: 'SH501225',
      officialEstValue: 3.323,
      referenceEstValue: 3.312,
      realtimeEstValue: null,
      realtimeEst: '',
      estDate: '2026-05-26',
      quoteDate: '2026-05-27',
      quoteTime: '15:00',
      purchaseLimit: { limitText: '暂停申购' },
    });

    expect(row).toMatchObject({
      code: '501225',
      lastNav: 3.323,
      estimatedNav: 3.312,
      navDate: '2026-05-26',
      navQuoteTime: '2026-05-27 15:00',
      navSource: 'lof',
      estimatedNavSource: 'lof',
    });
  });

  it('uses Palmmicro official EST as the last LOF estimated NAV fallback', () => {
    const row = mergeLofNavRow({
      code: '501225',
      lastNav: 3.3418,
      navSource: 'eastmoney',
      navDate: '2026-06-02',
    }, {
      code: 'SH501225',
      officialEstValue: 3.407,
      referenceEstValue: null,
      referenceEst: '',
      realtimeEstValue: null,
      realtimeEst: '',
      estDate: '2026-06-03',
      quoteDate: '2026-06-03',
      quoteTime: '15:00',
    });

    expect(row).toMatchObject({
      code: '501225',
      lastNav: 3.3418,
      estimatedNav: 3.407,
      navSource: 'eastmoney',
      estimatedNavSource: 'lof',
      navDate: '2026-06-02',
      navQuoteTime: '2026-06-03 15:00',
    });
  });

  it('uses HaoETF estimated NAV without overwriting a stronger official NAV source', () => {
    const row = mergeHaoetfNavRow({
      code: '513100',
      lastNav: 2.087,
      navSource: 'eastmoney',
      navDate: '2026-06-02',
    }, {
      code: '513100',
      lastNav: 2.08,
      estimatedNav: 2.0855,
      navQuoteTime: '2026-06-03 15:00:00',
      navDate: '2026-06-02',
    });

    expect(row).toMatchObject({
      code: '513100',
      lastNav: 2.087,
      estimatedNav: 2.0855,
      navSource: 'eastmoney',
      estimatedNavSource: 'haoetf',
      navDate: '2026-06-02',
      navQuoteTime: '2026-06-03 15:00:00',
    });
  });
});
