export class MemoryCache {
  constructor() {
    this.items = new Map();
    this.lastValid = new Map();
    this.lastObserved = new Map();
  }

  get(key) {
    const item = this.items.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) return null;
    return item.value;
  }

  getStale(key, { maxAgeMs } = {}) {
    const item = this.lastValid.get(key);
    if (!item) return null;
    if (Number.isFinite(maxAgeMs) && Date.now() - item.storedAt > maxAgeMs) return null;
    return item.value;
  }

  getObserved(key, { maxAgeMs } = {}) {
    const item = this.lastObserved.get(key);
    if (!item) return null;
    if (Number.isFinite(maxAgeMs) && Date.now() - item.storedAt > maxAgeMs) return null;
    return item.value;
  }

  set(key, value, ttlMs) {
    const now = Date.now();
    this.items.set(key, { value, expiresAt: now + ttlMs });
    this.lastValid.set(key, { value, storedAt: now });
    this.lastObserved.set(key, { value, storedAt: now });
    return value;
  }

  setTransient(key, value, ttlMs) {
    const now = Date.now();
    this.lastObserved.set(key, { value, storedAt: now });
    return value;
  }
}

export const cache = new MemoryCache();

export const cacheTtl = {
  quotes: 30_000,
  indices: 3_000,
  trends: 15_000,
  nav: 60_000,
  exchangeShares: 10 * 60_000,
  fundScale: 6 * 60 * 60_000,
  history: 5 * 60_000,
  fundList: 10 * 60_000,
};

// TODO: If REDIS_URL is present, replace MemoryCache with a Redis-backed adapter.
