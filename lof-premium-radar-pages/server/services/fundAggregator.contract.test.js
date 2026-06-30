import { describe, expect, it } from 'vitest';
import { formatFundQuoteResponse, getFundQuotePage } from './fundAggregator.js';

const COMPLETE_LOF_ROW = {
  code: '160216',
  fundCode: '160216',
  name: '国泰大宗商品LOF',
  fundName: '国泰大宗商品LOF',
  category: 'LOF',
  fundType: 'LOF',
  marketPrice: 1.2,
  price: 1.2,
  lastNav: 1.1,
  nav: 1.1,
  estimatedNav: 1.18,
  estimatedNavSource: 'palmmicro',
  estimatedNavTime: '2026-06-30 10:30:00',
  premiumRate: 1.6949152542,
  realtimePremiumRate: 1.6949152542,
  officialPremiumRate: 9.0909090909,
  source: 'sina',
  quoteSource: 'sina',
  navSource: 'eastmoney',
  sourceStatus: 'primary',
  quoteTime: '2026-06-30 10:30:00',
  updateTime: '2026-06-30 10:30:01',
  purchaseLimit: { state: 'open', label: '不限额' },
};

describe('fund quote response contract', () => {
  it('keeps canonical fields and aliases in the home response', () => {
    const response = formatFundQuoteResponse({
      meta: { sourceId: 'fund-aggregator', allCount: 1, updateTime: '2026-06-30 10:30:01' },
      rows: [COMPLETE_LOF_ROW],
    }, { fields: 'home', page: 1, pageSize: 30 });

    expect(response.rows).toHaveLength(1);
    expect(response.rows[0]).toMatchObject({
      code: '160216',
      fundCode: '160216',
      name: '国泰大宗商品LOF',
      fundName: '国泰大宗商品LOF',
      marketPrice: 1.2,
      price: 1.2,
      lastNav: 1.1,
      nav: 1.1,
      estimatedNav: 1.18,
      premiumRate: 1.6949152542,
      source: 'sina',
      quoteTime: '2026-06-30 10:30:00',
      updateTime: '2026-06-30 10:30:01',
    });
    expect(response.meta).toMatchObject({
      sourceId: 'fund-aggregator',
      rowCount: 1,
      filteredCount: 1,
      totalCount: 1,
      allCount: 1,
      pagination: {
        page: 1,
        pageSize: 30,
        total: 1,
        totalPages: 1,
        hasMore: false,
        snapshotReset: false,
      },
    });
    expect(response.meta.pagination.snapshotId).toMatch(/^[a-z0-9]+-\d+$/);
  });

  it('keeps stable code ordering and reset metadata for a replacement first page', () => {
    const response = formatFundQuoteResponse({
      meta: { updateTime: '2026-06-30 10:30:01' },
      rows: [
        { ...COMPLETE_LOF_ROW, code: '501225', fundCode: '501225' },
        { ...COMPLETE_LOF_ROW, code: '160002', fundCode: '160002' },
        { ...COMPLETE_LOF_ROW, code: '160001', fundCode: '160001' },
      ],
    }, {
      fields: 'home', page: 1, pageSize: 2, sortKey: 'premiumRate', sortDirection: 'desc', snapshotReset: true,
    });

    expect(response.rows.map((row) => row.code)).toEqual(['160001', '160002']);
    expect(response.meta.pagination).toMatchObject({ total: 3, totalPages: 2, hasMore: true, snapshotReset: true });
  });

  it('keeps the page snapshot error code and message', () => {
    expect.assertions(2);
    try {
      getFundQuotePage({ snapshotId: 'missing-contract-snapshot' });
    } catch (error) {
      expect(error.code).toBe('PAGE_SNAPSHOT_EXPIRED');
      expect(error.message).toBe('分页快照已失效，请从第一页继续');
    }
  });
});
