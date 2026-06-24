import { onMounted, ref, watch, type Ref } from 'vue';
import { fetchFundsSnapshot } from '../api/funds';
import type { FundItem, FundSnapshot } from '../types/fund';
import { usePolling } from './usePolling';

const AUTO_REFRESH_INTERVAL = 30_000;
const PREFETCH_LEAD_MS = 5_000;
const LOCAL_SNAPSHOT_MAX_AGE_MS = 2 * 60_000;

interface PreparedSnapshot {
  requestId: number;
  section: string;
  previous: Map<string, FundItem>;
  snapshot: FundSnapshot;
}

export function useFunds(section: Ref<string>) {
  const funds = ref<FundItem[]>([]);
  const meta = ref<FundSnapshot['meta'] | null>(null);
  const initialLoading = ref(true);
  let requestId = 0;
  let forceNextSnapshot = false;

  async function prepareSnapshot({ force = false } = {}): Promise<PreparedSnapshot> {
    const currentRequestId = ++requestId;
    const requestSection = section.value;
    const previous = new Map(funds.value.map((fund) => [fund.code, fund]));
    const shouldForce = shouldForceSnapshotRequest({ force, forceNextSnapshot });
    const snapshot = await fetchSectionSnapshot({ force: shouldForce, section: requestSection, includeTrends: false });
    forceNextSnapshot = false;
    return { requestId: currentRequestId, section: requestSection, previous, snapshot };
  }

  function applySnapshot(prepared: PreparedSnapshot) {
    if (prepared.requestId !== requestId || prepared.section !== section.value) return;
    funds.value = mergeRows(prepared.snapshot.rows, prepared.previous);
    meta.value = prepared.snapshot.meta;
    storeSnapshot(prepared.section, prepared.snapshot);
    initialLoading.value = false;
  }

  const polling = usePolling(() => prepareSnapshot(), {
    interval: AUTO_REFRESH_INTERVAL,
    maxInterval: AUTO_REFRESH_INTERVAL,
    immediate: true,
    prefetchLeadMs: PREFETCH_LEAD_MS,
    onData: applySnapshot,
  });

  function hydrateSectionSnapshot() {
    const cached = hydrateSnapshot(section.value);
    if (cached) {
      funds.value = mergeRows(cached.rows, new Map());
      meta.value = { ...cached.meta, stale: true };
      initialLoading.value = false;
      return;
    }
    funds.value = [];
    meta.value = null;
  }

  onMounted(() => {
    hydrateSectionSnapshot();
    polling.start();
  });

  watch(section, () => {
    initialLoading.value = true;
    forceNextSnapshot = false;
    hydrateSectionSnapshot();
    polling.refreshNow();
  });

  return {
    funds,
    meta,
    initialLoading,
    polling,
    refreshNow: () => {
      forceNextSnapshot = true;
      return polling.refreshNow();
    },
  };
}

export function shouldForceSnapshotRequest({
  force = false,
  forceNextSnapshot = false,
}: {
  force?: boolean;
  forceNextSnapshot?: boolean;
} = {}): boolean {
  return Boolean(force || forceNextSnapshot);
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

export function hydrateSnapshotForSection(section: string): FundSnapshot | null {
  try {
    const key = cacheKey(section);
    const cached = window.localStorage.getItem(key);
    if (!cached) return null;
    const snapshot = JSON.parse(cached) as FundSnapshot;
    if (!Array.isArray(snapshot.rows) || !snapshot.rows.length) return null;
    if (isExpiredLocalSnapshot(snapshot)) {
      window.localStorage.removeItem(key);
      return null;
    }
    return snapshot;
  } catch {
    // Ignore invalid local cache.
    return null;
  }
}

function hydrateSnapshot(section: string): FundSnapshot | null {
  return hydrateSnapshotForSection(section);
}

function storeSnapshot(section: string, snapshot: FundSnapshot) {
  try {
    window.localStorage.setItem(cacheKey(section), JSON.stringify(snapshot));
  } catch {
    // Local storage may be unavailable or full.
  }
}

function isExpiredLocalSnapshot(snapshot: FundSnapshot): boolean {
  const timestamp = snapshotTimestamp(snapshot);
  if (!timestamp) return true;
  return Date.now() - timestamp > LOCAL_SNAPSHOT_MAX_AGE_MS;
}

function snapshotTimestamp(snapshot: FundSnapshot): number | null {
  const candidates = [
    snapshot.meta?.latestQuoteTime,
    snapshot.meta?.updateTime,
    snapshot.meta?.fetchedAt,
    snapshot.meta?.scrapedAt,
    ...snapshot.rows.map((row) => row.updateTime || row.quoteTime || row.updatedAt),
  ];
  for (const value of candidates) {
    const timestamp = parseShanghaiTime(value);
    if (timestamp) return timestamp;
  }
  return null;
}

function parseShanghaiTime(value: unknown): number | null {
  const text = String(value || '').trim();
  if (!text) return null;
  const normalized = text.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
    ? `${text.replace(' ', 'T')}+08:00`
    : text;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
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
  return [
    'price',
    'marketPrice',
    'changeRate',
    'changePercent',
    'changeValue',
    'premiumRate',
    'realtimePremium',
    'lastNav',
    'nav',
    'estimatedNav',
    'estimatedValue',
    'turnover',
    'amount',
  ].filter((key) => previous[key as keyof FundItem] !== next[key as keyof FundItem]);
}
