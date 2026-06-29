import { describe, expect, it } from 'vitest';
import { buildLofPremiumReferenceMap, mergeHaoetfNavRow, mergeLofNavRow, isNasdaqTechnologyQuote, selectEastmoneyNavCodes, selectTiantianCodes } from './navService.js';

describe('navService', () => {
  it('maps the target website realtime estimate first and keeps its provenance', () => {
    const map = buildLofPremiumReferenceMap({
      scrapedAt: '2026-06-29T02:38:27.000Z',
      rows: [{
        code: 'SH501225', quoteDate: '2026-06-29', quoteTime: '10:38',
        officialEstValue: 3.487, estDate: '2026-06-26',
        realtimeEstValue: 3.5, realtimePremiumValue: 29.6,
      }],
    });

    expect(map.get('501225')).toMatchObject({
      value: 3.5,
      source: 'lof',
      kind: 'realtime',
      estimateDate: '2026-06-26',
      quoteTime: '2026-06-29 10:38:00',
      stale: false,
    });
  });

  it('falls back to the target website official estimate without treating it as official NAV', () => {
    const map = buildLofPremiumReferenceMap({
      scrapedAt: '2026-06-29T02:38:27.000Z',
      rows: [{
        code: 'SH501225', quoteDate: '2026-06-29', quoteTime: '10:38',
        officialEstValue: 3.487, officialPremiumValue: 30.07, estDate: '2026-06-26',
        referenceEstValue: 3.478,
      }],
    });

    expect(map.get('501225')).toMatchObject({
      value: 3.487,
      source: 'lof',
      kind: 'official-estimate',
      sourcePremiumRate: 30.07,
    });
  });

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
      ['161125', { code: '161125', lastNav: 3.13, navSource: 'tiantian', eastmoneyCheckedAt: '2026-06-29 09:25:00' }],
      ['501300', { code: '501300', lastNav: null, navSource: '' }],
    ]);

    expect(selectEastmoneyNavCodes([
      { code: '160723', category: 'LOF' },
      { code: '161125', category: 'LOF' },
      { code: '501300', category: 'LOF' },
      { code: '513100', category: 'QDII' },
    ], navMap, { now: new Date('2026-06-29T01:30:00Z').getTime() })).toEqual(['160723', '501300']);
  });

  it('rechecks a previously verified LOF NAV after the official NAV refresh interval', () => {
    const navMap = new Map([
      ['161125', {
        code: '161125', lastNav: 3.13, navSource: 'eastmoney', eastmoneyCheckedAt: '2026-06-29 09:00:00',
      }],
    ]);

    expect(selectEastmoneyNavCodes([
      { code: '161125', category: 'LOF' },
    ], navMap, { now: new Date('2026-06-29T01:30:01Z').getTime() })).toEqual(['161125']);
  });

  it('keeps Palmmicro EST separate from official NAV when no verified official NAV exists', () => {
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
      lastNav: null,
      estimatedNav: 3.312,
      navDate: '',
      navQuoteTime: '',
      navSource: '',
      estimatedNavSource: 'lof',
    });
  });

  it('does not let a newer dated Palmmicro EST replace a verified official NAV', () => {
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
      navQuoteTime: '',
    });
  });

  it('does not let an older incoming LOF official NAV replace a newer cached NAV', () => {
    const row = mergeLofNavRow({
      code: '501225',
      lastNav: 3.407,
      navSource: 'eastmoney',
      navDate: '2026-06-03',
      navQuoteTime: '2026-06-03 22:00:00',
    }, {
      code: 'SH501225',
      officialEstValue: 3.3418,
      estDate: '2026-06-02',
      quoteDate: '2026-06-04',
      quoteTime: '15:00',
    });

    expect(row).toMatchObject({
      lastNav: 3.407,
      navSource: 'eastmoney',
      navDate: '2026-06-03',
      navQuoteTime: '2026-06-03 22:00:00',
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
      navQuoteTime: '',
    });
  });
});
