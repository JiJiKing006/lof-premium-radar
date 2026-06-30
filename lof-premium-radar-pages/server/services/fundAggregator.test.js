import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dedupeFundsByCodePriority, filterRenderablePremiumRows, formatFundQuoteResponse, getFundQuotePage, mergeMarketQuoteMaps, mergeStableExchangeShareFields, mergeStableFinancialFields, mergeStablePurchaseStatuses, recalculatePremiumFields, toUnifiedFund } from './fundAggregator.js';
import { filterRenderablePremiumRows as projectedFilterRenderablePremiumRows } from './fundListProjector.js';
import { mergeStableFinancialFields as policyMergeStableFinancialFields } from './fundSnapshotPolicy.js';
import { recalculatePremiumFields as storedRecalculatePremiumFields } from './fundSnapshotStore.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-30T10:30:00+08:00'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('fundAggregator', () => {
  it('keeps the list filter available through the aggregator facade', () => {
    expect(filterRenderablePremiumRows).toBe(projectedFilterRenderablePremiumRows);
    expect(mergeStableFinancialFields).toBe(policyMergeStableFinancialFields);
    expect(recalculatePremiumFields).toBe(storedRecalculatePremiumFields);
  });

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

  it('刷新丢失净值时保留已验证官方净值但不冒充实时溢价', () => {
    const [row] = mergeStableFinancialFields([
      {
        code: '160216', marketPrice: 1.1, lastNav: 1, premiumRate: 10,
        navDate: '2026-06-27', navSource: 'tiantian', navQuoteTime: '2026-06-27 22:00:00',
      },
    ], [
      { code: '160216', marketPrice: 1.2, lastNav: null, premiumRate: null, quoteTime: '2026-06-28 10:30:00' },
    ]);

    expect(row.lastNav).toBe(1);
    expect(row.premiumRate).toBeNull();
    expect(row.officialPremiumRate).toBeCloseTo(20, 8);
    expect(row.navSource).toBe('tiantian');
    expect(row.abnormalReason).not.toContain('nav 缺失');
    expect(row.valuationCarriedForward).toBe(true);
    expect(row.carriedForwardFields).toEqual(['officialNav']);
  });

  it('刷新返回更旧净值时保留较新的官方净值并分离官方口径溢价', () => {
    const [row] = mergeStableFinancialFields([
      {
        code: '160216', marketPrice: 1.1, lastNav: 1, premiumRate: 10,
        navDate: '2026-06-27', navSource: 'tiantian', navQuoteTime: '2026-06-27 22:00:00',
      },
    ], [
      {
        code: '160216', marketPrice: 1.2, lastNav: 0.98, premiumRate: 22.4489,
        navDate: '2026-06-26', navSource: 'jisilu', navQuoteTime: '2026-06-28 10:30:00',
        quoteTime: '2026-06-28 10:30:00',
      },
    ]);

    expect(row.lastNav).toBe(1);
    expect(row.navDate).toBe('2026-06-27');
    expect(row.navSource).toBe('tiantian');
    expect(row.premiumRate).toBeNull();
    expect(row.officialPremiumRate).toBeCloseTo(20, 8);
    expect(row.abnormalReason).not.toContain('nav 缺失');
    expect(row.valuationCarriedForward).toBe(true);
    expect(row.carriedForwardFields).toEqual(['officialNav']);
  });

  it('keeps a fresh target-estimate premium while carrying forward only the official NAV fields', () => {
    const [row] = mergeStableFinancialFields([
      {
        code: '501225', marketPrice: 4.52, lastNav: 3.6406, premiumRate: 24.15,
        navDate: '2026-06-25', navSource: 'eastmoney', navQuoteTime: '2026-06-25 00:00:00',
      },
    ], [
      {
        code: '501225', marketPrice: 4.517, lastNav: null, estimatedNav: 3.487,
        premiumRate: 29.5382850588, premiumBasis: 'estimatedNav',
        premiumNote: '基于目标网站估值（非官方净值）', estimatedNavSource: 'lof',
        estimatedNavTime: '2026-06-30 10:52:00', quoteTime: '2026-06-30 10:53:03',
      },
    ]);

    expect(row.lastNav).toBe(3.6406);
    expect(row.navDate).toBe('2026-06-25');
    expect(row.premiumRate).toBeCloseTo(29.5382850588, 8);
    expect(row.premiumBasis).toBe('estimatedNav');
    expect(row.premiumNote).toBe('基于目标网站估值（非官方净值）');
  });

  it('uses the newest dated official NAV atomically when calculating premium', () => {
    const row = toUnifiedFund({
      quote: {
        code: '501225', name: '全球芯片LOF', category: 'LOF', marketPrice: 4.6,
        lastNav: 3.4, navDate: '2026-06-24', navSource: 'jisilu',
        source: 'jisilu', sourceStatus: 'primary', quoteTime: '2026-06-26 10:00:00',
      },
      nav: {
        code: '501225', lastNav: 3.5, navDate: '2026-06-25', navSource: 'eastmoney',
        navQuoteTime: '2026-06-25 22:00:00',
      },
      updateTime: '2026-06-26 10:00:01',
    });

    expect(row.lastNav).toBe(3.5);
    expect(row.navDate).toBe('2026-06-25');
    expect(row.navSource).toBe('eastmoney');
    expect(row.navQuoteTime).toBe('2026-06-25 22:00:00');
    expect(row.premiumRate).toBeNull();
    expect(row.officialPremiumRate).toBeCloseTo(31.428571, 6);
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
    expect(row.premiumRate).toBeCloseTo(0.2722, 4);
    expect(row.officialPremiumRate).toBeCloseTo(-2.4893, 4);
    expect(row.abnormalReason).toContain('估算净值多源偏差过大');
  });

  it('calculates realtime premium from the freshly fetched target reference without replacing official NAV', () => {
    const row = toUnifiedFund({
      quote: {
        code: '501225', name: '全球芯片LOF', category: 'LOF', marketPrice: 4.536,
        source: 'sina', sourceStatus: 'fallback', quoteTime: '2026-06-29 10:38:00',
      },
      nav: {
        code: '501225', lastNav: 3.6406, navDate: '2026-06-25', navSource: 'eastmoney',
        navQuoteTime: '2026-06-25 00:00:00',
      },
      premiumReference: {
        value: 3.487, source: 'lof', kind: 'official-estimate', estimateDate: '2026-06-26',
        quoteTime: '2026-06-29 10:38:00', stale: false,
      },
      updateTime: '2026-06-29 10:38:01',
    });

    expect(row.lastNav).toBe(3.6406);
    expect(row.navDate).toBe('2026-06-25');
    expect(row.navSource).toBe('eastmoney');
    expect(row.estimatedNav).toBe(3.487);
    expect(row.estimatedNavSource).toBe('lof');
    expect(row.premiumRate).toBeCloseTo(30.0832, 4);
    expect(row.premiumBasis).toBe('estimatedNav');
    expect(row.premiumNote).toBe('基于目标网站估值（非官方净值）');
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
    expect(row.premiumRate).toBeCloseTo(34.8265, 4);
    expect(row.officialPremiumRate).toBeCloseTo(36.0045, 4);
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

    expect(row.premiumBasis).toBe('none');
    expect(row.premiumRate).toBeNull();
    expect(row.officialPremiumRate).toBeCloseTo(-4.3841, 4);
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
        shareValueWan: 234500,
        shareChange: '-0.32亿份',
        shareSource: 'sse',
        shareTime: '2026-05-29',
      },
      updateTime: '2026-05-29 15:01:00',
    });

    expect(row.shareAmount).toBe('23.45亿份');
    expect(row.shareValueWan).toBe(234500);
    expect(row.shareChange).toBe('-0.32亿份');
    expect(row.shareSource).toBe('sse');
    expect(row.shareTime).toBe('2026-05-29');
    expect(row.marketValue).toBeCloseTo(3_618_335_000, 4);
    expect(row.marketValueSource).toBe('haoetf+sse');
    expect(row.marketValueTime).toBe('2026-05-29 15:00:00');
    expect(row.marketValueBasis).toBe('marketPrice*exchangeShare');
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
    expect(row.marketValue).toBeNull();
  });

  it('keeps verified exchange shares and recalculates market value with the new price', () => {
    const [row] = mergeStableExchangeShareFields([{
      code: '501225', marketPrice: 4.6, shareAmount: '1.84亿份', shareValueWan: 18400,
      shareSource: 'sse', shareTime: '2026-06-29', marketValue: 84_640_000,
    }], [{
      code: '501225', marketPrice: 4.7, quoteSource: 'sina', quoteTime: '2026-06-30 15:00:00',
      shareAmount: '', shareValueWan: null, shareSource: '', shareTime: '', marketValue: null,
    }]);

    expect(row).toMatchObject({
      shareAmount: '1.84亿份', shareValueWan: 18400, shareSource: 'sse',
      shareTime: '2026-06-29', shareDataCarriedForward: true,
      marketValueSource: 'sina+sse', marketValueTime: '2026-06-30 15:00:00',
    });
    expect(row.marketValue).toBe(864_800_000);
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

  it('recalculates persisted premium fields from the original verified price and estimate after midnight', () => {
    const row = recalculatePremiumFields({
      code: '160216', marketPrice: 1.2, lastNav: 1.1,
      estimatedNav: 1.18, estimatedNavSource: 'tiantian', estimatedNavTime: '2026-06-30 15:00:00',
      quoteTime: '2026-06-30 15:00:00', premiumRate: null,
    }, new Date('2026-06-30T16:30:00Z'));

    expect(row.premiumRate).toBeCloseTo((1.2 / 1.18 - 1) * 100, 8);
    expect(row.officialPremiumRate).toBeCloseTo((1.2 / 1.1 - 1) * 100, 8);
    expect(row.premiumBasis).toBe('estimatedNav');
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
      meta: { rowCount: 2, allCount: 2, updateTime: '2026-06-30 15:01:00' },
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
          estimatedNavTime: '2026-06-30 15:00:00',
          premiumRate: 2.42,
          purchaseLimit: { state: 'paused', label: '暂停申购' },
          source: 'eastmoney',
          updateTime: '2026-06-30 15:01:00',
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
          updateTime: '2026-06-30 15:01:00',
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
      meta: { updateTime: '2026-06-30 15:01:00' },
      rows: [
        { code: '160001', category: 'LOF', marketPrice: 1.2, lastNav: 1.1, estimatedNav: 1.176, estimatedNavTime: '2026-06-30 15:00:00', premiumRate: 2, settlementCycle: 'T+2', purchaseLimit: { state: 'paused', label: '暂停申购' } },
        { code: '160002', category: 'LOF', marketPrice: 0.8, lastNav: 0.79, estimatedNav: 0.792, estimatedNavTime: '2026-06-30 15:00:00', premiumRate: 1, settlementCycle: 'T+2', purchaseLimit: { state: 'open', label: '不限额' } },
      ],
    }, {
      fields: 'home', page: 1, pageSize: 30, marketFilter: 'T+2',
      excludePausedPurchase: '1', sortKey: 'price', sortDirection: 'asc',
    });

    expect(response.rows.map((row) => row.code)).toEqual(['160002']);
    expect(response.meta.pagination).toMatchObject({ total: 1, hasMore: false });
  });

  it('首页列表只保留关键数据完整的 LOF 并隐藏纳指 ETF 等纯场内基金', () => {
    const snapshot = {
      meta: { updateTime: '2026-06-30 10:00:00' },
      rows: [
        { code: '501225', category: 'LOF', marketPrice: 4.6, lastNav: 3.5, estimatedNav: 3.538, estimatedNavTime: '2026-06-30 10:00:00', premiumRate: 30, purchaseLimit: { state: 'open', label: '开放申购' } },
        { code: '513100', category: 'ETF', marketPrice: 2.1, lastNav: 2, premiumRate: 5, purchaseLimit: { state: 'paused', label: '暂停申购' } },
        { code: '159941', category: 'ETF', marketPrice: 1.6, lastNav: 1.5, premiumRate: 4, purchaseLimit: { state: 'exchange', label: '场内交易' } },
        { code: '161130', category: 'LOF', marketPrice: 4.6, lastNav: null, premiumRate: null, purchaseLimit: { state: 'paused', label: '暂停申购' } },
        { code: '160999', category: 'LOF', marketPrice: 1.2, lastNav: 1.1, estimatedNav: 1.18, estimatedNavTime: '2026-06-30 10:00:00', premiumRate: null, purchaseLimit: { state: 'open', label: '开放申购' } },
      ],
    };

    const home = formatFundQuoteResponse(snapshot, { fields: 'home', page: 1, pageSize: 30 });
    const full = formatFundQuoteResponse(snapshot, {});

    expect(home.rows.map((row) => row.code)).toEqual(['501225']);
    expect(home.meta.pagination.total).toBe(1);
    expect(full.rows.map((row) => row.code)).toEqual(['501225', '513100', '159941', '160999', '161130']);
  });

  it('后续分页固定使用第一页快照且不受新快照排序变化影响', () => {
    const firstSnapshot = {
      meta: { updateTime: '2026-06-30 10:00:00' },
      rows: [
        { code: '501225', category: 'LOF', marketPrice: 1.3, lastNav: 1, estimatedNav: 1, estimatedNavTime: '2026-06-30 10:00:00', premiumRate: 30 },
        { code: '160001', category: 'LOF', marketPrice: 1.2, lastNav: 1, estimatedNav: 1, estimatedNavTime: '2026-06-30 10:00:00', premiumRate: 20 },
        { code: '160002', category: 'LOF', marketPrice: 1.1, lastNav: 1, estimatedNav: 1, estimatedNavTime: '2026-06-30 10:00:00', premiumRate: 10 },
      ],
    };
    const firstPage = formatFundQuoteResponse(firstSnapshot, {
      fields: 'home', page: 1, pageSize: 2, sortKey: 'premiumRate', sortDirection: 'desc',
    });
    const snapshotId = firstPage.meta.pagination.snapshotId;

    formatFundQuoteResponse({
      meta: { updateTime: '2026-06-30 10:00:01' },
      rows: [
        { code: '160002', category: 'LOF', marketPrice: 1.99, lastNav: 1, estimatedNav: 1, estimatedNavTime: '2026-06-30 10:00:01', premiumRate: 99 },
        { code: '501225', category: 'LOF', marketPrice: 1.3, lastNav: 1, estimatedNav: 1, estimatedNavTime: '2026-06-30 10:00:01', premiumRate: 30 },
        { code: '160001', category: 'LOF', marketPrice: 1.2, lastNav: 1, estimatedNav: 1, estimatedNavTime: '2026-06-30 10:00:01', premiumRate: 20 },
      ],
    }, { fields: 'home', page: 1, pageSize: 2, sortKey: 'premiumRate', sortDirection: 'desc' });

    const pinned = getFundQuotePage({ snapshotId });
    const secondPage = formatFundQuoteResponse(pinned, {
      fields: 'home', page: 2, pageSize: 2, sortKey: 'premiumRate', sortDirection: 'desc', snapshotId,
    });

    expect(firstPage.rows.map((row) => row.code)).toEqual(['501225', '160001']);
    expect(secondPage.rows.map((row) => row.code)).toEqual(['160002']);
    expect(secondPage.meta.pagination.snapshotId).toBe(snapshotId);
  });

  it('分页快照失效时明确要求重新从第一页加载', () => {
    expect(() => getFundQuotePage({ snapshotId: 'expired-snapshot' })).toThrow('分页快照已失效');
  });

  it('排序值相同时始终使用基金代码稳定排序', () => {
    const response = formatFundQuoteResponse({
      meta: {},
      rows: [
        { code: '501225', category: 'LOF', marketPrice: 1.3, lastNav: 1, estimatedNav: 1, estimatedNavTime: '2026-06-30 10:00:00', premiumRate: 30 },
        { code: '160002', category: 'LOF', marketPrice: 1.3, lastNav: 1, estimatedNav: 1, estimatedNavTime: '2026-06-30 10:00:00', premiumRate: 30 },
        { code: '160001', category: 'LOF', marketPrice: 1.3, lastNav: 1, estimatedNav: 1, estimatedNavTime: '2026-06-30 10:00:00', premiumRate: 30 },
      ],
    }, { fields: 'home', sortKey: 'premiumRate', sortDirection: 'desc' });

    expect(response.rows.map((row) => row.code)).toEqual(['160001', '160002', '501225']);
  });

  it('保留首页响应中的价格与净值字段别名', () => {
    const response = formatFundQuoteResponse({
      meta: { updateTime: '2026-06-30 10:00:00' },
      rows: [{
        code: '160216', fundCode: '160216', name: '国泰大宗商品LOF', fundName: '国泰大宗商品LOF', category: 'LOF',
        marketPrice: 1.2, price: 1.2, lastNav: 1.1, nav: 1.1, estimatedNav: 1.18,
        estimatedNavSource: 'palmmicro', estimatedNavTime: '2026-06-30 10:00:00', premiumRate: 1.69,
        source: 'sina', quoteTime: '2026-06-30 10:00:00', updateTime: '2026-06-30 10:00:00',
      }],
    }, { fields: 'home' });

    expect(response.rows[0]).toMatchObject({ marketPrice: 1.2, price: 1.2, lastNav: 1.1, nav: 1.1 });
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
