class MemoryCache {
  constructor() {
    this.items = new Map();
    this.lastValid = new Map();
  }

  get(key) {
    const item = this.items.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) return null;
    return item.value;
  }

  getStale(key) {
    return this.lastValid.get(key) || null;
  }

  set(key, value, ttlMs) {
    this.items.set(key, { value, expiresAt: Date.now() + ttlMs });
    this.lastValid.set(key, value);
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
  history: 5 * 60_000,
  fundList: 10 * 60_000,
};

// TODO: If REDIS_URL is present, replace MemoryCache with a Redis-backed adapter.
