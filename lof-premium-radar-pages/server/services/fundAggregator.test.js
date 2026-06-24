import { describe, expect, it } from 'vitest';
import { dedupeFundsByCodePriority, filterRenderablePremiumRows, mergeMarketQuoteMaps, toUnifiedFund } from './fundAggregator.js';

describe('fundAggregator', () => {
  it('calculates realtime premium from the selected cross-checked estimate', () => {
    const row = toUnifiedFund({
      quote: {
        code: '168401',
        name: '红土创新精选LOF',
        category: 'LOF',
        marketPrice: 6.816,
        estimatedNav: 6.971,
        lastNav: 6.971,
        source: 'palmmicro',
        sourceStatus: 'primary',
        quoteTime: '2026-05-29 15:00:00',
        navQuoteTime: '2026-05-29 15:00:00',
      },
      nav: {
        code: '168401',
        estimatedNav: 6.7975,
        lastNav: 6.99,
        navSource: 'tiantian',
        navQuoteTime: '2026-05-29 15:00:00',
      },
      updateTime: '2026-05-29 15:01:00',
    });

    expect(row.estimatedNav).toBe(6.7975);
    expect(row.estimatedNavSource).toBe('tiantian');
    expect(row.estimateConfidence).toBe('low');
    expect(row.premiumRate).toBeCloseTo(0.2722, 4);
    expect(row.abnormalReason).toContain('估算净值多源偏差过大');
  });

  it('keeps estimated NAV source separate from official NAV source', () => {
    const row = toUnifiedFund({
      quote: {
        code: '501225',
        name: '全球芯片LOF',
        category: 'LOF',
        marketPrice: 4.545,
        source: 'sina',
        sourceStatus: 'fallback',
        quoteTime: '2026-06-03 15:00:00',
      },
      nav: {
        code: '501225',
        lastNav: 3.3418,
        estimatedNav: 3.371,
        navSource: 'eastmoney',
        estimatedNavSource: 'lof',
        navQuoteTime: '2026-06-03 15:00:00',
      },
      updateTime: '2026-06-03 15:01:00',
    });

    expect(row.estimatedNav).toBe(3.371);
    expect(row.estimatedNavSource).toBe('lof');
    expect(row.navSource).toBe('eastmoney');
    expect(row.premiumBasis).toBe('estimatedNav');
  });

  it('does not display rejected outlier estimated NAV values', () => {
    const row = toUnifiedFund({
      quote: {
        code: '159128',
        name: '港科技TH',
        category: 'ETF',
        marketPrice: 0.711,
        source: 'sina',
        sourceStatus: 'fallback',
        quoteTime: '2026-06-08 15:00:00',
      },
      nav: {
        code: '159128',
        lastNav: 0.7436,
        estimatedNav: 2465.65,
        navSource: 'jisilu',
        estimatedNavSource: 'jisilu',
        navQuoteTime: '2026-06-08 15:00:00',
      },
      updateTime: '2026-06-08 15:01:00',
    });

    expect(row.premiumBasis).toBe('lastNav');
    expect(row.premiumRate).toBeCloseTo(-4.3841, 4);
    expect(row.estimatedNav).toBeNull();
    expect(row.estimateWarning).toContain('估算净值量级异常');
  });


  it('carries verified exchange share amount and previous-day share change into unified rows', () => {
    const row = toUnifiedFund({
      quote: {
        code: '513100',
        name: '纳指ETF',
        category: 'QDII',
        marketPrice: 1.543,
        estimatedNav: 1.5,
        source: 'haoetf',
        sourceStatus: 'primary',
        quoteTime: '2026-05-29 15:00:00',
      },
      nav: {
        code: '513100',
        lastNav: 1.49,
        estimatedNav: 1.5,
        navSource: 'jisilu',
        navQuoteTime: '2026-05-29 15:00:00',
        shareAmount: '23.45亿份',
        shareChange: '-0.32亿份',
        shareSource: 'jisilu',
        shareTime: '2026-05-29 15:00:00',
      },
      exchangeShare: {
        code: '513100',
        shareAmount: '23.45亿份',
        shareChange: '-0.32亿份',
        shareSource: 'sse',
        shareTime: '2026-05-29',
      },
      updateTime: '2026-05-29 15:01:00',
    });

    expect(row.shareAmount).toBe('23.45亿份');
    expect(row.shareChange).toBe('-0.32亿份');
    expect(row.shareSource).toBe('sse');
    expect(row.shareTime).toBe('2026-05-29');
  });

  it('does not display third-party share amount as exchange share data', () => {
    const row = toUnifiedFund({
      quote: {
        code: '513100',
        name: '纳指ETF',
        category: 'QDII',
        marketPrice: 1.543,
        estimatedNav: 1.5,
        source: 'haoetf',
        sourceStatus: 'primary',
        quoteTime: '2026-05-29 15:00:00',
      },
      nav: {
        code: '513100',
        lastNav: 1.49,
        estimatedNav: 1.5,
        navSource: 'jisilu',
        navQuoteTime: '2026-05-29 15:00:00',
        shareAmount: '23.45亿份',
        shareChange: '-0.32亿份',
        shareSource: 'jisilu',
        shareTime: '2026-05-29 15:00:00',
      },
      updateTime: '2026-05-29 15:01:00',
    });

    expect(row.shareAmount).toBe('');
    expect(row.shareChange).toBe('');
    expect(row.shareSource).toBe('');
  });

  it('filters rows without a calculable premium rate from list output', () => {
    const rows = filterRenderablePremiumRows([
      { code: '160916', premiumRate: -0.69 },
      { code: '167302', premiumRate: null },
      { code: '159001', premiumRate: Number.NaN },
    ]);

    expect(rows.map((row) => row.code)).toEqual(['160916']);
  });

  it('keeps LOF rows even when premium is unavailable', () => {
    const rows = filterRenderablePremiumRows([
      { code: '160916', category: 'LOF', premiumRate: -0.69 },
      { code: '162719', category: 'LOF', premiumRate: null, source: 'sina' },
      { code: '161125', category: 'LOF', premiumRate: null, dataStatus: 'missing_quote' },
      { code: '513100', category: 'QDII', premiumRate: null, dataStatus: 'missing_quote' },
    ], 'LOF');

    expect(rows.map((row) => row.code)).toEqual(['160916', '162719', '161125']);
  });

  it('removes QDII rows without a calculable premium rate from table output', () => {
    const rows = filterRenderablePremiumRows([
      { code: '513100', category: 'QDII', marketPrice: 1.543, premiumRate: null, source: 'sina' },
      { code: '159941', category: 'ETF', marketPrice: 1.12, premiumRate: Number.NaN, source: 'sina' },
      { code: '513500', category: 'QDII', marketPrice: null, premiumRate: null, source: 'quote-missing' },
    ], 'QDII');

    expect(rows.map((row) => row.code)).toEqual([]);
  });

  it('removes ETF rows without a calculable premium rate from table output', () => {
    const rows = filterRenderablePremiumRows([
      { code: '159509', name: '纳斯达克科技ETF', category: 'ETF', marketPrice: 1.23, premiumRate: null, market: '美股' },
      { code: '588000', name: '科创50ETF', category: 'ETF', marketPrice: 1.01, premiumRate: null, market: 'A股' },
      { code: '513100', name: '纳指ETF', category: 'QDII', marketPrice: 1.54, premiumRate: null, market: '美股' },
    ], 'ETF');

    expect(rows.map((row) => row.code)).toEqual([]);
  });


  it('carries missing quote status through unified LOF rows', () => {
    const row = toUnifiedFund({
      quote: {
        code: '161125',
        name: '标普500LOF',
        category: 'LOF',
        marketPrice: null,
        lastNav: null,
        estimatedNav: null,
        source: 'quote-missing',
        sourceStatus: 'missing',
        dataStatus: 'missing_quote',
        referenceSource: 'palmmicro',
      },
      updateTime: '2026-05-29 15:01:00',
    });

    expect(row.dataStatus).toBe('missing_quote');
    expect(row.referenceSource).toBe('palmmicro');
  });

  it('shows the real supplemental quote source when a row gets market data later', () => {
    const row = toUnifiedFund({
      quote: {
        code: '501300',
        name: '美元债LOF',
        category: 'LOF',
        marketPrice: null,
        lastNav: null,
        estimatedNav: null,
        source: 'quote-missing',
        sourceStatus: 'missing',
        dataStatus: 'missing_quote',
        referenceSource: 'palmmicro',
      },
      marketQuote: {
        code: '501300',
        marketPrice: 0.942,
        changeRate: -0.21,
        source: 'eastmoney',
        quoteTime: '2026-06-03 10:12:00',
      },
      nav: {
        code: '501300',
        lastNav: 0.9437,
        navSource: 'jisilu',
        navQuoteTime: '2026-06-03 10:12:00',
      },
      updateTime: '2026-06-03 10:13:00',
    });

    expect(row.source).toBe('eastmoney');
    expect(row.quoteSource).toBe('eastmoney');
    expect(row.dataStatus).toBe('missing_quote');
    expect(row.referenceSource).toBe('palmmicro');
  });

  it('does not turn missing supplemental market quotes into a displayed zero price', () => {
    const row = toUnifiedFund({
      quote: {
        code: '161233',
        name: '国投瑞银瑞泰多策略混合(LOF)A',
        category: 'LOF',
        marketPrice: null,
        lastNav: null,
        estimatedNav: null,
        source: 'quote-missing',
        sourceStatus: 'missing',
        dataStatus: 'missing_quote',
        referenceSource: 'xiaobeiyangji-get-arbitrage-list',
      },
      marketQuote: {
        code: '161233',
        marketPrice: 0,
        source: 'eastmoney',
      },
      nav: {
        code: '161233',
        lastNav: 1.8396,
        navSource: 'eastmoney',
      },
      updateTime: '2026-06-24 15:05:45',
    });

    expect(row.marketPrice).toBeNull();
    expect(row.premiumRate).toBeNull();
    expect(row.dataStatus).toBe('missing_quote');
  });

  it('uses fallback quote maps when the primary quote is missing or zero', () => {
    const primary = new Map([
      ['501225', { code: '501225', marketPrice: 0, source: 'eastmoney' }],
      ['161125', { code: '161125', marketPrice: 3.24, source: 'eastmoney' }],
    ]);
    const fallback = new Map([
      ['501225', { code: '501225', marketPrice: 4.546, source: 'sina' }],
      ['501312', { code: '501312', marketPrice: 2.419, source: 'sina' }],
      ['161125', { code: '161125', marketPrice: 3.23, source: 'sina' }],
    ]);

    const merged = mergeMarketQuoteMaps(primary, fallback);

    expect(merged.get('501225')?.source).toBe('sina');
    expect(merged.get('501225')?.marketPrice).toBe(4.546);
    expect(merged.get('501312')?.marketPrice).toBe(2.419);
    expect(merged.get('161125')?.source).toBe('eastmoney');
  });

  it('deduplicates funds by code and prefers LOF before QDII before ETF', () => {
    const rows = dedupeFundsByCodePriority([
      { code: '159001', name: 'ETF版本', category: 'ETF' },
      { code: 'SZ159001', name: 'QDII版本', category: 'QDII' },
      { code: '159001', name: 'LOF版本', category: 'LOF' },
      { code: '513100', name: '纳指ETF', category: 'ETF' },
    ]);

    expect(rows).toEqual([
      { code: '159001', name: 'LOF版本', category: 'LOF' },
      { code: '513100', name: '纳指ETF', category: 'ETF' },
    ]);
  });
});
