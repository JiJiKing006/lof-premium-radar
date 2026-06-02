import { describe, expect, it } from 'vitest';
import { dedupeFundsByCodePriority, filterRenderablePremiumRows, toUnifiedFund } from './fundAggregator.js';

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
