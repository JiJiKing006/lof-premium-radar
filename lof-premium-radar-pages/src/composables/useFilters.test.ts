import { ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { useFilters } from './useFilters';
import type { FundItem, MarketFilter } from '../types/fund';

function fund(overrides: Partial<FundItem>): FundItem {
  return {
    code: '160000',
    name: '测试基金',
    type: 'LOF',
    price: null,
    changePercent: null,
    nav: null,
    navDate: null,
    estimatedValue: null,
    premiumRate: null,
    volume: null,
    amount: null,
    subscriptionStatus: '开放申购',
    subscriptionState: 'open',
    redemptionStatus: '开放赎回',
    source: 'test',
    updatedAt: '2026-05-29 15:00:00',
    stale: false,
    confidence: 100,
    riskTags: [],
    ...overrides,
  };
}

describe('useFilters', () => {
  it('filters by inferred exchange and sorts by selected value', () => {
    const funds = ref([
      fund({ code: '160216', name: '深市高溢价', premiumRate: 8, turnover: 20_000 }),
      fund({ code: '501018', name: '沪市高成交', premiumRate: 3, turnover: 80_000 }),
      fund({ code: '161125', name: '深市低溢价', premiumRate: 1, turnover: 60_000 }),
    ]);
    const excludePausedPurchase = ref(false);
    const sortDirection = ref<'asc' | 'desc'>('desc');
    const marketFilter = ref<MarketFilter>('SZ');
    const { sortKey, visibleFunds } = useFilters(funds, excludePausedPurchase, sortDirection, marketFilter);

    sortKey.value = 'turnover';

    expect(visibleFunds.value.map((item) => item.code)).toEqual(['161125', '160216']);
  });

  it('keeps LOF rows without premium while still removing unavailable non-LOF premiums', () => {
    const funds = ref([
      fund({ code: '160001', name: '可展示溢价率', premiumRate: 0 }),
      fund({ code: '501312', name: '海外科技LOF', type: 'LOF', premiumRate: null }),
      fund({ code: '513100', name: '纳指ETF', type: 'QDII', premiumRate: null }),
      fund({ code: '159001', name: '文本空溢价率ETF', type: 'ETF', premiumRate: Number.NaN }),
      fund({
        code: '160004',
        name: '原始字段可展示',
        premiumRate: null,
        raw: { realtimePremium: '1.23%' },
      }),
    ]);
    const excludePausedPurchase = ref(false);
    const sortDirection = ref<'asc' | 'desc'>('desc');
    const { visibleFunds } = useFilters(funds, excludePausedPurchase, sortDirection);

    expect(visibleFunds.value.map((item) => item.code)).toEqual(['160004', '160001', '501312']);
  });
});
