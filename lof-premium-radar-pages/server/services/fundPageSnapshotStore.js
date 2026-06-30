const PAGE_SNAPSHOT_MAX_AGE_MS = 30 * 60_000;
const pageSnapshots = new Map();
const pageSnapshotIds = new WeakMap();
let pageSnapshotSequence = 0;

export function rememberPageSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return '';
  cleanupPageSnapshots();
  const existingId = pageSnapshotIds.get(snapshot);
  if (existingId && pageSnapshots.has(existingId)) return existingId;
  pageSnapshotSequence = (pageSnapshotSequence + 1) % 1_000_000;
  const snapshotId = `${Date.now().toString(36)}-${pageSnapshotSequence.toString(36)}`;
  pageSnapshotIds.set(snapshot, snapshotId);
  pageSnapshots.set(snapshotId, { snapshot, storedAt: Date.now() });
  return snapshotId;
}

export function getPinnedPageSnapshot(snapshotId) {
  const id = String(snapshotId || '').trim();
  if (!id) return null;
  cleanupPageSnapshots();
  return pageSnapshots.get(id)?.snapshot || null;
}

function cleanupPageSnapshots() {
  const cutoff = Date.now() - PAGE_SNAPSHOT_MAX_AGE_MS;
  for (const [id, entry] of pageSnapshots.entries()) {
    if (entry.storedAt < cutoff) pageSnapshots.delete(id);
  }
}
