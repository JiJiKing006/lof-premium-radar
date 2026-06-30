import { describe, expect, it } from 'vitest';
import { formatFundQuoteResponse, getFundQuotePage } from './fundAggregator.js';
import { formatFundQuoteResponse as projectFundQuoteResponse } from './fundListProjector.js';
import { getPinnedPageSnapshot, rememberPageSnapshot } from './fundPageSnapshotStore.js';
import { createFundsRouter } from '../routes/funds.js';
import { createMarketRouter } from '../routes/market.js';

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
  it('keeps frozen fund and market route methods after router extraction', () => {
    const routes = [...createFundsRouter().stack, ...createMarketRouter().stack]
      .filter((layer) => layer.route)
      .map((layer) => ({ path: layer.route.path, methods: Object.keys(layer.route.methods).sort() }));

    expect(routes).toEqual(expect.arrayContaining([
      { path: '/funds/quotes', methods: ['get'] },
      { path: '/funds/quotes', methods: ['post'] },
      { path: '/funds/quotes/refresh', methods: ['get'] },
      { path: '/funds/quotes/refresh', methods: ['post'] },
      { path: '/funds/quotes/page', methods: ['get'] },
      { path: '/funds/quotes/page', methods: ['post'] },
      { path: '/funds/:code/history', methods: ['get'] },
      { path: '/funds/:code', methods: ['get'] },
      { path: '/market/indices', methods: ['get'] },
      { path: '/health', methods: ['get'] },
    ]));
  });

  it('keeps page snapshot ids pinned to the same snapshot object', () => {
    const snapshot = { meta: {}, rows: [COMPLETE_LOF_ROW] };
    const snapshotId = rememberPageSnapshot(snapshot);

    expect(rememberPageSnapshot(snapshot)).toBe(snapshotId);
    expect(getPinnedPageSnapshot(snapshotId)).toBe(snapshot);
  });

  it('keeps the aggregator response equal to the extracted projector response', () => {
    const snapshot = { meta: { allCount: 1 }, rows: [COMPLETE_LOF_ROW] };
    const options = { fields: 'home', page: 1, pageSize: 30 };
    const direct = projectFundQuoteResponse(snapshot, options, () => 'contract-snapshot');
    const facade = formatFundQuoteResponse(snapshot, options);

    expect({ ...facade, meta: { ...facade.meta, pagination: { ...facade.meta.pagination, snapshotId: 'contract-snapshot' } } }).toEqual(direct);
  });

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
