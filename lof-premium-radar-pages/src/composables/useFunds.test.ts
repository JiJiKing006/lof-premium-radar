import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hydrateSnapshotForSection, shouldForceSnapshotRequest } from './useFunds';
import type { FundSnapshot } from '../types/fund';

describe('useFunds local snapshot hydration', () => {
  const originalWindow = globalThis.window;
  const storage = new Map<string, string>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T10:20:00+08:00'));
    storage.clear();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: vi.fn((key: string) => storage.get(key) || null),
          setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
          removeItem: vi.fn((key: string) => storage.delete(key)),
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  });

  it('rejects multi-day-old fund snapshots instead of showing stale market data', () => {
    storage.set('fund-snapshot:LOF', JSON.stringify(snapshot('2026-06-03 15:00:00')));

    expect(hydrateSnapshotForSection('LOF')).toBeNull();
    expect(window.localStorage.removeItem).toHaveBeenCalledWith('fund-snapshot:LOF');
  });

  it('keeps a short-lived fund snapshot for startup only', () => {
    const cached = snapshot('2026-06-08 10:18:30');
    storage.set('fund-snapshot:LOF', JSON.stringify(cached));

    expect(hydrateSnapshotForSection('LOF')).toEqual(cached);
  });
});

describe('useFunds request force policy', () => {
  it('does not bypass server caches for startup or tab switches', () => {
    expect(shouldForceSnapshotRequest({ force: false, forceNextSnapshot: false })).toBe(false);
  });

  it('only forces when manual refresh asks for a fresh source pull', () => {
    expect(shouldForceSnapshotRequest({ force: true, forceNextSnapshot: false })).toBe(true);
    expect(shouldForceSnapshotRequest({ force: false, forceNextSnapshot: true })).toBe(true);
  });
});

function snapshot(updateTime: string): FundSnapshot {
  return {
    meta: {
      sourceId: 'fund-aggregator',
      sourceTitle: '基金实时行情与溢价聚合',
      sourceProvider: 'sina',
      rowCount: 1,
      allCount: 1,
      warn: '',
      latestQuoteTime: updateTime,
      updateTime,
      status: 'ok',
      stale: false,
      trendsIncluded: false,
    },
    rows: [
      {
        code: '501312',
        name: '海外科技LOF',
        type: 'LOF',
        price: 2.3,
        marketPrice: 2.3,
        changePercent: 0.1,
        changeRate: 0.1,
        nav: 2.2,
        lastNav: 2.2,
        navDate: '2026-06-04',
        estimatedValue: null,
        estimatedNav: null,
        premiumRate: 4.5,
        volume: null,
        amount: null,
        subscriptionStatus: '--',
        subscriptionState: 'unknown',
        redemptionStatus: '--',
        market: 'SH',
        source: 'sina',
        updatedAt: updateTime,
        quoteTime: updateTime,
        updateTime,
        stale: false,
        confidence: 100,
        riskTags: [],
        raw: {},
      },
    ],
  };
}
