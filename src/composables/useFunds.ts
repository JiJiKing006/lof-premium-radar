import { onMounted, ref, watch, type Ref } from 'vue';
import { fetchFundsSnapshot } from '../api/funds';
import type { FundItem, FundSnapshot } from '../types/fund';
import { usePolling } from './usePolling';

export function useFunds(section: Ref<string>) {
  const funds = ref<FundItem[]>([]);
  const meta = ref<FundSnapshot['meta'] | null>(null);
  const initialLoading = ref(true);
  let requestId = 0;
  let trendRequestId = 0;

async function load({ force = false } = {}) {
    const currentRequestId = ++requestId;
    const requestSection = section.value;
    const previous = new Map(funds.value.map((fund) => [fund.code, fund]));
    const snapshot = await fetchSectionSnapshot({ force, section: requestSection, includeTrends: false });
    if (currentRequestId !== requestId || requestSection !== section.value) return;
    funds.value = mergeRows(snapshot.rows, previous);
    meta.value = snapshot.meta;
    storeSnapshot(requestSection, snapshot);
    initialLoading.value = false;
    void enrichTrends({ force, sectionValue: requestSection });
  }

  async function enrichTrends({ force = false, sectionValue = section.value } = {}) {
    const currentTrendRequestId = ++trendRequestId;
    try {
      const snapshot = await fetchSectionSnapshot({ force, section: sectionValue, includeTrends: true });
      if (currentTrendRequestId !== trendRequestId || sectionValue !== section.value) return;
      const previous = new Map(funds.value.map((fund) => [fund.code, fund]));
      funds.value = mergeRows(snapshot.rows, previous);
      meta.value = snapshot.meta;
      storeSnapshot(sectionValue, snapshot);
    } catch {
      // Keep the fast quote table visible if the heavier trend refresh fails.
    }
  }

  const polling = usePolling(() => load(), { interval: 20_000, maxInterval: 60_000, immediate: true });

  onMounted(() => {
    const cached = hydrateSnapshot(section.value);
    if (cached) {
      funds.value = mergeRows(cached.rows, new Map());
      meta.value = { ...cached.meta, stale: true };
      initialLoading.value = false;
    }
    polling.start();
  });

  watch(section, () => {
    initialLoading.value = true;
    funds.value = [];
    meta.value = null;
    const cached = hydrateSnapshot(section.value);
    if (cached) {
      funds.value = mergeRows(cached.rows, new Map());
      meta.value = { ...cached.meta, stale: true };
      initialLoading.value = false;
    }
    polling.refreshNow();
  });

  return {
    funds,
    meta,
    initialLoading,
    polling,
    refreshNow: () => polling.refreshNow(),
  };
}

async function fetchSectionSnapshot({
  force = false,
  section,
  includeTrends,
}: {
  force?: boolean;
  section: string;
  includeTrends: boolean;
}): Promise<FundSnapshot> {
  if (section !== 'WATCH') {
    return fetchFundsSnapshot({ force, section, includeTrends });
  }

  const snapshots = await Promise.all(
    ['LOF', 'QDII', 'ETF'].map((category) => fetchFundsSnapshot({ force, section: category, includeTrends })),
  );
  const rows = snapshots.flatMap((snapshot) => snapshot.rows);
  const latestQuoteTime = snapshots
    .map((snapshot) => snapshot.meta.latestQuoteTime)
    .filter(Boolean)
    .sort()
    .at(-1);
  const latestUpdateTime = snapshots
    .map((snapshot) => snapshot.meta.updateTime)
    .filter(Boolean)
    .sort()
    .at(-1);

  return {
    meta: {
      sourceId: 'watch',
      sourceTitle: '本地自选基金',
      sourceProvider: snapshots.map((snapshot) => snapshot.meta.sourceProvider).join(' / '),
      sourceStatus: snapshots.some((snapshot) => snapshot.meta.sourceStatus === 'cache') ? 'cache' : 'primary',
      rowCount: rows.length,
      allCount: rows.length,
      warn: snapshots.map((snapshot) => snapshot.meta.warn).filter(Boolean).join('；'),
      latestQuoteTime,
      updateTime: latestUpdateTime,
      status: 'ok',
      stale: snapshots.some((snapshot) => snapshot.meta.stale),
      trendsIncluded: includeTrends,
    },
    rows,
  };
}

function cacheKey(section: string): string {
  return `fund-snapshot:${section}`;
}

function hydrateSnapshot(section: string): FundSnapshot | null {
  try {
    const cached = window.localStorage.getItem(cacheKey(section));
    if (!cached) return null;
    const snapshot = JSON.parse(cached) as FundSnapshot;
    if (!Array.isArray(snapshot.rows) || !snapshot.rows.length) return null;
    return snapshot;
  } catch {
    // Ignore invalid local cache.
    return null;
  }
}

function storeSnapshot(section: string, snapshot: FundSnapshot) {
  try {
    window.localStorage.setItem(cacheKey(section), JSON.stringify(snapshot));
  } catch {
    // Local storage may be unavailable or full.
  }
}

function mergeRows(rows: FundItem[], previous: Map<string, FundItem>): FundItem[] {
  return rows.map((fund) => {
    const old = previous.get(fund.code);
    const intraday = fund.intraday?.length ? fund.intraday : old?.intraday || [];
    const next = { ...fund, intraday };
    return {
      ...next,
      changedFields: changedFields(old, next),
      raw: { ...(next.raw || {}), intraday, __fundItem: next },
    };
  });
}

function changedFields(previous: FundItem | undefined, next: FundItem): string[] {
  if (!previous) return [];
  return ['price', 'changePercent', 'premiumRate'].filter((key) => previous[key as keyof FundItem] !== next[key as keyof FundItem]);
}
