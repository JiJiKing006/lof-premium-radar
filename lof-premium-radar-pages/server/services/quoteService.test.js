import { describe, expect, it } from 'vitest';
import {
  completeLofReferenceRows,
  fetchSourceRows,
  filterRowsForCategory,
  mergeLofReferenceRows,
  normalizeLocalLofReferenceRows,
  sourcePlan,
} from './quoteService.js';

describe('quoteService', () => {
  it('keeps complete category feeds before broad quote fallbacks', () => {
    expect(sourcePlan('LOF').map((source) => source.name)).toEqual(['sina', 'eastmoney', 'akshare']);
    expect(sourcePlan('ETF').map((source) => source.name)).toEqual(['haoetf', 'eastmoney', 'sina', 'akshare']);
    expect(sourcePlan('QDII').map((source) => source.name)).toEqual(['jisilu', 'haoetf', 'eastmoney', 'sina', 'akshare']);
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

  it('keeps cross-border 160644 in QDII when source category identifies it as QDII', () => {
    const rows = [
      { code: '160644', name: '港美互联网LOF', category: 'QDII' },
      { code: '513100', name: '纳指ETF', category: 'QDII' },
    ];

    expect(filterRowsForCategory(rows, 'QDII').map((row) => row.code)).toEqual(['160644', '513100']);
    expect(filterRowsForCategory(rows, 'LOF').map((row) => row.code)).toEqual([]);
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
        purchaseLimit: { state: 'unavailable', label: '暂无数据', limitText: '暂无数据' },
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

  it('aborts a slow source fetcher so fallback sources can run quickly', async () => {
    const source = {
      name: 'slow-source',
      fetcher: ({ signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('source timeout')));
        setTimeout(() => resolve([{ code: '501300' }]), 50);
      }),
    };

    await expect(fetchSourceRows(source, 5)).rejects.toThrow('source timeout');
  });

  it('uses local LOF reference fallback without copying stale financial values', () => {
    const rows = normalizeLocalLofReferenceRows({
      rows: [
        {
          code: 'SH501300',
          name: '美元债LOF',
          priceValue: 0.942,
          officialEstValue: 0.94,
          realtimePremiumValue: 1.23,
        },
      ],
    });

    expect(rows).toEqual([
      {
        code: '501300',
        name: '美元债LOF',
        category: 'LOF',
        market: '债券',
        source: 'palmmicro-reference-local',
        sourceStatus: 'reference',
      },
    ]);
  });

  it('supplements Palmmicro LOF references with local stock/index entries without overriding primary rows', () => {
    const primaryRows = [
      { code: '160632', name: '鹏华酒LOF', category: 'LOF', source: 'palmmicro' },
      { code: '161725', name: '招商白酒LOF', category: 'LOF', source: 'palmmicro' },
    ];
    const supplementalRows = normalizeLocalLofReferenceRows({
      rows: [
        { code: 'SZ160632', name: '小倍酒指数', priceValue: 9.99 },
        {
          code: 'SZ160105',
          name: '南方积极配置混合(LOF)',
          priceValue: 1.23,
          referenceSource: 'xiaobeiyangji-get-arbitrage-list',
        },
      ],
    });

    expect(mergeLofReferenceRows(primaryRows, supplementalRows)).toEqual([
      { code: '160632', name: '鹏华酒LOF', category: 'LOF', source: 'palmmicro' },
      { code: '161725', name: '招商白酒LOF', category: 'LOF', source: 'palmmicro' },
      {
        code: '160105',
        name: '南方积极配置混合(LOF)',
        category: 'LOF',
        market: '其他',
        source: 'xiaobeiyangji-get-arbitrage-list',
        sourceStatus: 'reference',
      },
    ]);
  });
});
