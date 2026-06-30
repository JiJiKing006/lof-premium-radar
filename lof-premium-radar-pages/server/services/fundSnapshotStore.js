import fs from 'node:fs';
import path from 'node:path';
import { calculatePremium } from './premiumService.js';
import { cache } from './cacheService.js';
import { formatShanghaiTime } from './sourceHealth.js';
import { isDisplayStableSnapshot } from './fundSnapshotPolicy.js';

export const COMPLETE_SNAPSHOT_MAX_STALE_MS = 24 * 60 * 60_000;
const VERIFIED_SNAPSHOT_PREFIX = 'fund-quotes:verified';
const persistentSnapshotFile = String(process.env.FUND_SNAPSHOT_FILE || '').trim();
let persistentSnapshotPayload = { version: 1, snapshots: {} };
let persistentWriteChain = Promise.resolve();

export function hydratePersistentFundSnapshots() {
  if (!persistentSnapshotFile) return 0;
  try {
    const payload = JSON.parse(fs.readFileSync(persistentSnapshotFile, 'utf8'));
    const snapshots = payload?.snapshots && typeof payload.snapshots === 'object' ? payload.snapshots : {};
    let count = 0;
    persistentSnapshotPayload = { version: 1, savedAt: payload.savedAt || '', snapshots: {} };
    for (const [key, snapshot] of Object.entries(snapshots)) {
      if (!snapshot?.rows?.length) continue;
      const carried = markPersistentSnapshot(snapshot);
      persistentSnapshotPayload.snapshots[key] = snapshot;
      cache.set(key, carried, 1);
      count += 1;
    }
    return count;
  } catch {
    return 0;
  }
}

function markPersistentSnapshot(snapshot) {
  const now = new Date();
  return {
    ...snapshot,
    meta: {
      ...(snapshot.meta || {}),
      stale: true,
      status: 'persistent-cache',
      sourceStatus: 'cache',
      warn: [snapshot.meta?.warn, '服务重启后先返回上一份已验证快照，后台刷新中'].filter(Boolean).join('；'),
    },
    rows: snapshot.rows.map((row) => ({
      ...recalculatePremiumFields(row, now),
      sourceStatus: 'cache',
      isRealtime: false,
      snapshotCarriedForward: true,
    })),
  };
}

export function recalculatePremiumFields(row, now = new Date()) {
  const premium = calculatePremium({
    marketPrice: row.marketPrice ?? row.price,
    quoteTime: row.quoteTime || '',
    iopv: row.iopv,
    iopvSource: row.iopvSource,
    iopvTime: row.iopvTime,
    iopvStale: row.iopvStale,
    estimatedNav: row.estimatedNav,
    estimatedNavSource: row.estimatedNavSource,
    estimatedNavTime: row.estimatedNavTime,
    estimateCandidates: row.estimateSources,
    lastNav: row.lastNav ?? row.nav,
    navDate: row.navDate,
    now,
  });
  return {
    ...row,
    estimatedNav: premium.estimatedNav ?? row.estimatedNav ?? null,
    premiumRate: premium.premiumRate,
    realtimePremiumRate: premium.realtimePremiumRate,
    officialPremiumRate: premium.officialPremiumRate,
    officialDiscountRate: hasFiniteNumericValue(premium.officialPremiumRate) && Number(premium.officialPremiumRate) < 0
      ? Math.abs(Number(premium.officialPremiumRate))
      : null,
    discountRate: hasFiniteNumericValue(premium.premiumRate) && Number(premium.premiumRate) < 0
      ? Math.abs(Number(premium.premiumRate))
      : null,
    premiumBasis: premium.basis,
    premiumNote: premium.note,
    estimatedNavSource: premium.selectedNavSource || row.estimatedNavSource || '',
    estimatedNavTime: premium.selectedNavTime || row.estimatedNavTime || '',
    estimateConfidence: premium.estimateConfidence,
    estimateDeviationRate: premium.estimateDeviationRate,
    estimateWarning: premium.estimateWarning,
    estimateSources: premium.estimateSources,
  };
}

function persistFundSnapshot(key, snapshot) {
  if (!persistentSnapshotFile || !snapshot?.rows?.length) return;
  persistentSnapshotPayload = {
    version: 1,
    savedAt: formatShanghaiTime(),
    snapshots: {
      ...(persistentSnapshotPayload.snapshots || {}),
      [key]: snapshot,
    },
  };
  persistentWriteChain = persistentWriteChain.then(async () => {
    const directory = path.dirname(persistentSnapshotFile);
    const temporary = `${persistentSnapshotFile}.${process.pid}.tmp`;
    await fs.promises.mkdir(directory, { recursive: true });
    await fs.promises.writeFile(temporary, JSON.stringify(persistentSnapshotPayload), 'utf8');
    await fs.promises.rename(temporary, persistentSnapshotFile);
  }).catch(() => {});
}

function verifiedSnapshotKey(category) {
  return `${VERIFIED_SNAPSHOT_PREFIX}:${normalizeSnapshotCategory(category)}`;
}

export function getVerifiedSnapshot(category) {
  const key = verifiedSnapshotKey(category);
  const snapshot = cache.get(key)
    || cache.getStale(key, { maxAgeMs: COMPLETE_SNAPSHOT_MAX_STALE_MS });
  return isDisplayStableSnapshot(snapshot, normalizeSnapshotCategory(category)) ? snapshot : null;
}

export function getServingSnapshot(category, snapshotCacheKey) {
  const exact = cache.get(snapshotCacheKey);
  if (isDisplayStableSnapshot(exact, category)) return exact;
  const canonical = cache.get(verifiedSnapshotKey(category));
  return isDisplayStableSnapshot(canonical, category) ? canonical : null;
}

export function commitVerifiedSnapshot(snapshotCacheKey, category, snapshot, ttlMs) {
  const normalizedCategory = normalizeSnapshotCategory(category);
  const canonicalKey = verifiedSnapshotKey(normalizedCategory);
  const verified = snapshot.meta?.status === 'refreshing'
    ? {
        ...snapshot,
        meta: {
          ...(snapshot.meta || {}),
          status: 'ok',
          stale: ['cache', 'error'].includes(String(snapshot.meta?.sourceStatus || '')),
        },
      }
    : snapshot;
  cache.set(snapshotCacheKey, verified, ttlMs);
  cache.set(canonicalKey, verified, ttlMs);
  persistFundSnapshot(snapshotCacheKey, verified);
  persistFundSnapshot(canonicalKey, verified);
  return verified;
}

function normalizeSnapshotCategory(category) {
  const text = String(category || 'ALL').toUpperCase();
  if (text === 'LOF' || text === 'QDII' || text === 'ETF' || text === 'ALL') return text;
  return 'ALL';
}

function hasFiniteNumericValue(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}
