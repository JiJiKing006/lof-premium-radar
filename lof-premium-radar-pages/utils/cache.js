const LOCAL_SNAPSHOT_MAX_AGE_MS = 2 * 60 * 1000;
const LOCAL_STALE_SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000;

function cacheKey(section) {
  return `fund-snapshot:${section}`;
}

function readSnapshot(section, options = {}) {
  try {
    const cached = wx.getStorageSync(cacheKey(section));
    if (!cached) return null;
    const snapshot = JSON.parse(cached);
    if (!Array.isArray(snapshot.rows) || !snapshot.rows.length) return null;
    const expired = isExpired(snapshot, options.maxAgeMs || LOCAL_SNAPSHOT_MAX_AGE_MS);
    if (expired && !options.allowStale) {
      wx.removeStorageSync(cacheKey(section));
      return null;
    }
    if (!expired) return snapshot;
    if (isExpired(snapshot, options.staleMaxAgeMs || LOCAL_STALE_SNAPSHOT_MAX_AGE_MS)) return null;
    return markStale(snapshot, '本地缓存已过期，先展示上一份真实快照并后台刷新');
  } catch (error) {
    return null;
  }
}

function writeSnapshot(section, snapshot) {
  try {
    wx.setStorageSync(cacheKey(section), JSON.stringify(Object.assign({}, snapshot, { cachedAt: Date.now() })));
  } catch (error) {
    // Ignore storage quota errors.
  }
}

function isExpired(snapshot, maxAgeMs) {
  const timestamp = snapshotTimestamp(snapshot);
  if (!timestamp) return true;
  return Date.now() - timestamp > maxAgeMs;
}

function snapshotTimestamp(snapshot) {
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
  const candidates = [
    snapshot.cachedAt,
    snapshot.meta && snapshot.meta.latestQuoteTime,
    snapshot.meta && snapshot.meta.updateTime,
    snapshot.meta && snapshot.meta.fetchedAt,
    snapshot.meta && snapshot.meta.scrapedAt
  ].concat(rows.map((row) => row.updateTime || row.quoteTime || row.updatedAt));
  for (const value of candidates) {
    const timestamp = parseShanghaiTime(value);
    if (timestamp) return timestamp;
  }
  return null;
}

function parseShanghaiTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value || '').trim();
  if (!text) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text)
    ? `${text.replace(' ', 'T')}+08:00`
    : text;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function markStale(snapshot, warning) {
  const meta = Object.assign({}, snapshot.meta || {});
  return Object.assign({}, snapshot, {
    meta: Object.assign(meta, {
      stale: true,
      sourceStatus: meta.sourceStatus || 'cache',
      status: meta.status === 'ok' ? 'cache' : meta.status,
      warn: [meta.warn, warning].filter(Boolean).join('；')
    })
  });
}

module.exports = { readSnapshot, writeSnapshot };
