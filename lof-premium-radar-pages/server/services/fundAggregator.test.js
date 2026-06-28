import { describe, expect, it } from 'vitest';
import { dedupeFundsByCodePriority, filterRenderablePremiumRows, formatFundQuoteResponse, mergeMarketQuoteMaps, mergeStableFinancialFields, mergeStablePurchaseStatuses, toUnifiedFund } from './fundAggregator.js';

describe('fundAggregator', () => {
  it('keeps a verified quote purchase status when the supplemental status is unavailable', () => {
    const row = toUnifiedFund({
      quote: {
        code: '160216',
        name: '国泰大宗商品LOF',
        category: 'LOF',
        marketPrice: 1.1,
        lastNav: 1,
        purchaseLimit: { state: 'limited', label: '限大额 1000元', source: 'haoetf', updateTime: '2026-06-27 15:00:00' },
        source: 'haoetf',
        sourceStatus: 'primary',
        quoteTime: '2026-06-27 15:00:00',
      },
      subscriptionLimit: { state: 'unknown', label: '未知' },
      updateTime: '2026-06-27 15:00:01',
    });

    expect(row.purchaseLimit).toMatchObject({ state: 'limited', label: '限1000元', limitText: '限1000元' });
    expect(row.subscriptionSource).toBe('haoetf');
    expect(row.subscriptionTime).toBe('2026-06-27 15:00:00');
  });

  it('uses an explicit unavailable purchase status instead of unknown', () => {
    const row = toUnifiedFund({
      quote: {
        code: '162719',
        name: '石油LOF',
        category: 'LOF',
        marketPrice: 1.1,
        lastNav: 1,
        purchaseLimit: { state: 'unknown', label: '未知' },
        source: 'sina',
        sourceStatus: 'fallback',
        quoteTime: '2026-06-27 15:00:00',
      },
      updateTime: '2026-06-27 15:00:01',
    });

    expect(row.purchaseLimit).toEqual({
      state: 'unavailable',
      label: '暂无数据',
      limitText: '暂无数据',
      source: '',
      updateTime: '',
    });
    expect(row.subscriptionSource).toBe('');
    expect(row.subscriptionTime).toBe('');
  });

  it('压缩限购文案且超过一万时使用万元单位', () => {
    const row = toUnifiedFund({
      quote: {
        code: '160216', name: '国泰大宗商品LOF', category: 'LOF', marketPrice: 1.1, lastNav: 1,
        purchaseLimit: { state: 'limited', label: '限制大额申购 20000元', dailyLimit: 20_000, source: 'tiantian' },
        source: 'sina', sourceStatus: 'primary', quoteTime: '2026-06-27 15:00:00',
      },
      updateTime: '2026-06-27 15:00:01',
    });

    expect(row.purchaseLimit).toMatchObject({ state: 'limited', label: '限2万', limitText: '限2万' });
  });

  it('将源站的超大限额哨兵值显示为不限额', () => {
    const row = toUnifiedFund({
      quote: {
        code: '501043', name: '沪深300LOF', category: 'LOF', marketPrice: 1.6, lastNav: 1.5,
        purchaseLimit: { state: 'limited', label: '限制大额申购', dailyLimit: 100_000_000_000, source: 'tiantian' },
        source: 'sina', sourceStatus: 'primary', quoteTime: '2026-06-27 15:00:00',
      },
      updateTime: '2026-06-27 15:00:01',
    });

    expect(row.purchaseLimit).toMatchObject({ state: 'open', label: '不限额', limitText: '不限额' });
  });

  it('keeps a verified T+3 purchase status when a duplicate LOF row wins identity priority', () => {
    const rows = dedupeFundsByCodePriority([
      {
        code: '160644', category: 'LOF', settlementCycle: 'T+3', marketPrice: 2.1,
        purchaseLimit: { state: 'unavailable', label: '暂无数据' },
      },
      {
        code: '160644', category: 'QDII', settlementCycle: 'T+3', marketPrice: 2.1,
        purchaseLimit: { state: 'limited', label: '限500元', source: '集思录申购状态', updateTime: '2026-06-27 15:00:00' },
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      code: '160644',
      category: 'LOF',
      purchaseLimit: { state: 'limited', label: '限500元', source: '集思录申购状态' },
      subscriptionTime: '2026-06-27 15:00:00',
    });
  });

  it('carries forward a verified purchase status when a refresh loses that field', () => {
    const [row] = mergeStablePurchaseStatuses([
      {
        code: '513100',
        purchaseLimit: { state: 'open', label: '开放申购', source: '集思录申购状态', updateTime: '2026-06-27 14:59:58' },
        subscriptionSource: '集思录申购状态',
        subscriptionTime: '2026-06-27 14:59:58',
      },
    ], [
      { code: '513100', purchaseLimit: { state: 'unavailable', label: '暂无数据' } },
    ]);

    expect(row.purchaseLimit).toMatchObject({ state: 'open', label: '开放申购', carriedForward: true });
    expect(row.subscriptionSource).toBe('集思录申购状态');
    expect(row.subscriptionTime).toBe('2026-06-27 14:59:58');
    expect(row.purchaseStatusCarriedForward).toBe(true);
  });

  it('刷新丢失净值时保留已验证官方净值并用新价格重算溢价', () => {
    const [row] = mergeStableFinancialFields([
      {
        code: '160216', marketPrice: 1.1, lastNav: 1, premiumRate: 10,
        navDate: '2026-06-27', navSource: 'tiantian', navQuoteTime: '2026-06-27 22:00:00',
      },
    ], [
      { code: '160216', marketPrice: 1.2, lastNav: null, premiumRate: null, quoteTime: '2026-06-28 10:30:00' },
    ]);

    expect(row.lastNav).toBe(1);
    expect(row.premiumRate).toBeCloseTo(20, 8);
    expect(row.navSource).toBe('tiantian');
    expect(row.valuationCarriedForward).toBe(true);
    expect(row.carriedForwardFields).toEqual(['officialNav']);
  });

  it('calculates premium from official NAV while retaining the selected estimate separately', () => {
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
    expect(row.premiumRate).toBeCloseTo(-2.2235, 4);
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
    expect(row.premiumBasis).toBe('lastNav');
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

  it('keeps stable API aliases and market settlement fields on unified rows', () => {
    const row = toUnifiedFund({
      quote: {
        code: '513100',
        name: '纳指ETF',
        category: 'QDII',
        market: '美股',
        marketPrice: 1.543,
        lastNav: 1.49,
        estimatedNav: 1.5,
        turnover: 12_000_000,
        source: 'jisilu',
        sourceStatus: 'primary',
        quoteTime: '2026-05-29 15:00:00',
      },
      updateTime: '2026-05-29 15:01:00',
    });

    expect(row).toMatchObject({
      fundCode: '513100',
      fundName: '纳指ETF',
      fundType: 'QDII',
      price: 1.543,
      nav: 1.49,
      marketRegion: 'overseas',
      settlementCycle: 'T+3',
      showEstimatedNav: true,
      source: 'jisilu',
      updateTime: '2026-05-29 15:01:00',
    });
  });

  it('marks domestic funds as T+2 and not estimated-NAV display rows', () => {
    const row = toUnifiedFund({
      quote: {
        code: '588000',
        name: '科创50ETF',
        category: 'ETF',
        market: 'A股',
        marketPrice: 1.01,
        lastNav: 1.02,
        turnover: 2_000_000,
        source: 'haoetf',
        sourceStatus: 'primary',
        quoteTime: '2026-05-29 15:00:00',
      },
      updateTime: '2026-05-29 15:01:00',
    });

    expect(row.marketRegion).toBe('domestic');
    expect(row.settlementCycle).toBe('T+2');
    expect(row.showEstimatedNav).toBe(false);
  });

  it('classifies verified cross-border LOF redemption as T+3', () => {
    const row = toUnifiedFund({
      quote: {
        code: '160644',
        name: '港美互联网LOF',
        category: 'LOF',
        marketPrice: 2.143,
        lastNav: 2.0887,
        source: 'eastmoney',
        sourceStatus: 'primary',
        quoteTime: '2026-06-25 15:00:00',
      },
      updateTime: '2026-06-25 15:01:00',
    });

    expect(row.marketRegion).toBe('overseas');
    expect(row.settlementCycle).toBe('T+3');
    expect(row.showEstimatedNav).toBe(true);
    expect(row.settlementRuleSource).toContain('QDII');
  });

  it('returns paged lightweight homepage rows without heavy detail-only fields', () => {
    const response = formatFundQuoteResponse({
      meta: { rowCount: 2, allCount: 2, updateTime: '2026-06-25 15:01:00' },
      rows: [
        {
          code: '160644',
          fundCode: '160644',
          name: '港美互联网LOF',
          fundName: '港美互联网LOF',
          category: 'LOF',
          marketPrice: 2.143,
          price: 2.143,
          lastNav: 2.0887,
          nav: 2.0887,
          estimatedNav: 2.0923,
          premiumRate: 2.42,
          purchaseLimit: { state: 'paused', label: '暂停申购' },
          source: 'eastmoney',
          updateTime: '2026-06-25 15:01:00',
          settlementCycle: 'T+3',
          intraday: [{ time: '10:00:00', price: 2.1 }],
          estimateSources: [{ source: 'tiantian', value: 2.09 }],
          shareAmount: '1.2亿份',
        },
        {
          code: '161816',
          fundCode: '161816',
          name: '银华中证等权重90指数(LOF)',
          fundName: '银华中证等权重90指数(LOF)',
          category: 'LOF',
          marketPrice: 1.086,
          price: 1.086,
          lastNav: 0.9962,
          nav: 0.9962,
          premiumRate: 9.01,
          purchaseLimit: { state: 'open', label: '不限额' },
          source: 'eastmoney',
          updateTime: '2026-06-25 15:01:00',
          settlementCycle: 'T+2',
        },
      ],
    }, { fields: 'home', page: 1, pageSize: 1, marketFilter: 'T+3' });

    expect(response.meta.pagination).toMatchObject({ page: 1, pageSize: 1, total: 1, hasMore: false });
    expect(response.rows).toHaveLength(1);
    expect(response.rows[0]).toMatchObject({ code: '160644', settlementCycle: 'T+3' });
    expect(response.rows[0]).not.toHaveProperty('intraday');
    expect(response.rows[0]).not.toHaveProperty('estimateSources');
    expect(response.rows[0]).not.toHaveProperty('shareAmount');
  });

  it('在快照分页层执行排序和暂停申购过滤', () => {
    const response = formatFundQuoteResponse({
      meta: { updateTime: '2026-06-27 15:01:00' },
      rows: [
        { code: '160001', category: 'LOF', marketPrice: 1.2, premiumRate: 2, settlementCycle: 'T+2', purchaseLimit: { state: 'paused', label: '暂停申购' } },
        { code: '160002', category: 'LOF', marketPrice: 0.8, premiumRate: 1, settlementCycle: 'T+2', purchaseLimit: { state: 'open', label: '不限额' } },
      ],
    }, {
      fields: 'home', page: 1, pageSize: 30, marketFilter: 'T+2',
      excludePausedPurchase: '1', sortKey: 'price', sortDirection: 'asc',
    });

    expect(response.rows.map((row) => row.code)).toEqual(['160002']);
    expect(response.meta.pagination).toMatchObject({ total: 1, hasMore: false });
  });

  it('无数据的排序项始终放在真实数值之后', () => {
    const response = formatFundQuoteResponse({
      meta: {},
      rows: [
        { code: '160001', premiumRate: null },
        { code: '160002', premiumRate: 2.1 },
        { code: '160003', premiumRate: -1.2 },
      ],
    }, { sortKey: 'premiumRate', sortDirection: 'desc' });

    expect(response.rows.map((row) => row.code)).toEqual(['160002', '160003', '160001']);
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

  it('keeps QDII rows stable while official NAV is pending', () => {
    const rows = filterRenderablePremiumRows([
      { code: '513100', category: 'QDII', marketPrice: 1.543, premiumRate: null, source: 'sina' },
      { code: '159941', category: 'ETF', marketPrice: 1.12, premiumRate: Number.NaN, source: 'sina' },
      { code: '513500', category: 'QDII', marketPrice: null, premiumRate: null, source: 'quote-missing' },
    ], 'QDII');

    expect(rows.map((row) => row.code)).toEqual(['513100', '513500']);
  });

  it('keeps ETF rows stable while official NAV is pending', () => {
    const rows = filterRenderablePremiumRows([
      { code: '159509', name: '纳斯达克科技ETF', category: 'ETF', marketPrice: 1.23, premiumRate: null, market: '美股' },
      { code: '588000', name: '科创50ETF', category: 'ETF', marketPrice: 1.01, premiumRate: null, market: 'A股' },
      { code: '513100', name: '纳指ETF', category: 'QDII', marketPrice: 1.54, premiumRate: null, market: '美股' },
    ], 'ETF');

    expect(rows.map((row) => row.code)).toEqual(['159509', '588000']);
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
