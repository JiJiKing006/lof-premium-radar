import { describe, expect, it } from 'vitest';
import { completeLofReferenceRows, filterRowsForCategory, sourcePlan } from './quoteService.js';

describe('quoteService', () => {
  it('keeps complete category feeds before broad quote fallbacks', () => {
    expect(sourcePlan('LOF').map((source) => source.name)).toEqual(['eastmoney', 'sina', 'akshare']);
    expect(sourcePlan('ETF').map((source) => source.name)).toEqual(['eastmoney', 'sina', 'haoetf', 'akshare']);
    expect(sourcePlan('QDII').map((source) => source.name)).toEqual(['eastmoney', 'sina', 'haoetf', 'akshare']);
  });

  it('filters source rows by requested category before accepting a fallback source', () => {
    const rows = [
      { code: '513100', name: '纳指ETF', category: 'QDII' },
      { code: '588000', name: '科创ETF', category: 'ETF' },
      { code: '160916', name: '优选LOF', category: 'LOF' },
    ];

    expect(filterRowsForCategory(rows, 'LOF').map((row) => row.code)).toEqual(['160916']);
    expect(filterRowsForCategory(rows, 'ALL')).toHaveLength(3);
  });

  it('keeps 160644 in LOF and out of QDII when broad quote sources classify it as QDII', () => {
    const rows = [
      { code: '160644', name: '互联网QD', category: 'QDII' },
      { code: '513100', name: '纳指ETF', category: 'QDII' },
    ];

    expect(filterRowsForCategory(rows, 'QDII').map((row) => row.code)).toEqual(['513100']);
    expect(filterRowsForCategory(rows, 'LOF').map((row) => row.code)).toEqual(['160644']);
  });

  it('uses Palmmicro only as the LOF code universe, not as displayed quote data', () => {
    const rows = [
      { code: '160620', name: '资源LOF', category: 'LOF', source: 'sina' },
      { code: '161125', name: '标普500', category: 'QDII', source: 'sina' },
      { code: '161000', name: '目录外LOF', category: 'LOF', source: 'sina' },
      { code: '160216', name: 'Palmmicro旧行情', category: 'LOF', source: 'palmmicro' },
    ];

    expect(filterRowsForCategory(rows, 'LOF', { referenceCodes: new Set(['160620', '161125', '160216']) })).toEqual([
      { code: '160620', name: '资源LOF', category: 'LOF', source: 'sina' },
      { code: '161125', name: '标普500', category: 'QDII', source: 'sina' },
    ]);
  });

  it('completes the LOF list from Palmmicro references without copying Palmmicro financial values', () => {
    const sourceRows = [
      {
        code: '161125',
        name: '标普500',
        category: 'QDII',
        marketPrice: 3.21,
        lastNav: 3.2,
        premiumRate: 0.3,
        source: 'sina',
        sourceStatus: 'fallback',
      },
      {
        code: '160620',
        name: '资源',
        category: 'LOF',
        marketPrice: 1.23,
        lastNav: 1.2,
        premiumRate: 2.5,
        source: 'sina',
        sourceStatus: 'fallback',
      },
    ];
    const referenceRows = [
      {
        code: '160620',
        name: '资源LOF参考名',
        category: 'LOF',
        marketPrice: 9.99,
        lastNav: 8.88,
        estimatedNav: 7.77,
        premiumRate: 12.34,
        source: 'palmmicro',
      },
      {
        code: '161125',
        name: '标普500LOF',
        category: 'LOF',
        marketPrice: 6.66,
        lastNav: 5.55,
        estimatedNav: 4.44,
        premiumRate: 33.33,
        source: 'palmmicro',
      },
      {
        code: '162719',
        name: '石油LOF',
        category: 'LOF',
        marketPrice: 2.64,
        lastNav: 2.71,
        estimatedNav: 2.71,
        premiumRate: -2.48,
        source: 'palmmicro',
      },
    ];

    expect(completeLofReferenceRows(sourceRows, referenceRows)).toEqual([
      {
        ...sourceRows[1],
        name: '资源LOF参考名',
        category: 'LOF',
        market: '其他',
        referenceSource: 'palmmicro',
        updateTime: expect.any(String),
      },
      {
        ...sourceRows[0],
        name: '标普500LOF',
        category: 'LOF',
        market: '美股',
        referenceSource: 'palmmicro',
        updateTime: expect.any(String),
      },
      {
        code: '162719',
        name: '石油LOF',
        category: 'LOF',
        marketPrice: null,
        lastNav: null,
        estimatedNav: null,
        changeRate: null,
        volume: null,
        turnover: null,
        purchaseLimit: { state: 'unknown', label: '未知' },
        source: 'quote-missing',
        sourceStatus: 'missing',
        dataStatus: 'missing_quote',
        quoteTime: '',
        updateTime: expect.any(String),
        navDate: '',
        navQuoteTime: '',
        isRealtime: false,
        market: '商品',
        referenceSource: 'palmmicro',
      },
    ]);
  });

  it('removes gold QDII funds from QDII output', () => {
    const rows = [
      { code: '518880', name: '黄金ETF', category: 'QDII' },
      { code: '164701', name: '黄金及贵金属QDII', category: 'QDII' },
      { code: '513100', name: '纳指ETF', category: 'QDII' },
    ];

    expect(filterRowsForCategory(rows, 'QDII').map((row) => row.code)).toEqual(['513100']);
  });
});
