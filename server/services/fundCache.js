import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sources } from '../config/sources.js';
import { IntradaySeries } from './intradaySeries.js';

const REQUEST_TIMEOUT_MS = 18_000;

export class FundCache {
  constructor({ cwd, section, source, fetcher, fallbackFile = '' }) {
    this.cwd = cwd;
    this.section = section;
    this.source = source;
    this.fetcher = fetcher;
    this.fallbackFile = fallbackFile;
    this.snapshot = null;
    this.lastError = '';
    this.inFlight = null;
    this.nextRefreshAt = 0;
    this.nextAllowedAttemptAt = 0;
    this.series = new IntradaySeries({ cwd });
  }

  async init() {
    await this.series.load();
    await this.loadFallback().catch(() => {});
    this.start();
    this.refresh().catch(() => {});
  }

  start() {
    setInterval(() => {
      this.refresh().catch(() => {});
    }, this.source.refreshMs);
  }

  async getSnapshot({ force = false } = {}) {
    if (force || Date.now() >= this.nextRefreshAt) {
      await this.refresh({ force });
    }
    return this.decorateSnapshot();
  }

  async refresh({ force = false } = {}) {
    const now = Date.now();
    if (this.inFlight) return this.inFlight;
    if (!force && now < this.nextAllowedAttemptAt) {
      this.nextRefreshAt = Math.min(now + this.source.refreshMs, this.nextAllowedAttemptAt);
      return this.snapshot;
    }

    this.inFlight = this.fetchFresh()
      .catch((error) => {
        this.lastError = error.name === 'AbortError' ? '源站超时，继续使用缓存数据' : error.message || '源站刷新失败';
        if (error.retryAfterMs) {
          this.nextAllowedAttemptAt = Date.now() + error.retryAfterMs;
        }
        if (!this.snapshot) throw error;
        return this.snapshot;
      })
      .finally(() => {
        this.nextRefreshAt = Date.now() + this.source.refreshMs;
        this.inFlight = null;
      });

    return this.inFlight;
  }

  async fetchFresh() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const fresh = await this.fetcher({ section: this.section, signal: controller.signal });
      fresh.rows = this.series.merge(fresh.rows);
      await this.series.save();
      this.snapshot = {
        ...fresh,
        fetchedAt: new Date().toISOString(),
        stale: false,
      };
      this.lastError = '';
      this.nextAllowedAttemptAt = 0;
      return this.snapshot;
    } finally {
      clearTimeout(timeout);
    }
  }

  async loadFallback() {
    if (!this.fallbackFile) return;
    const file = path.join(this.cwd, this.fallbackFile);
    const fallback = JSON.parse(await readFile(file, 'utf8'));
    const normalized = this.source.normalizeFallback
      ? this.source.normalizeFallback(fallback)
      : { ...fallback, sourceId: this.section };
    normalized.rows = this.series.attach(normalized.rows || []);
    this.snapshot = {
      ...normalized,
      fetchedAt: normalized.scrapedAt,
      stale: true,
      fallback: true,
    };
  }

  decorateSnapshot() {
    return {
      meta: {
        sourceId: this.snapshot?.sourceId || this.section,
        sourceTitle: this.snapshot?.sourceTitle || this.source.title,
        sourceProvider: this.snapshot?.sourceProvider || this.source.type,
        rowCount: this.snapshot?.rowCount || 0,
        allCount: this.snapshot?.allCount || this.snapshot?.rowCount || 0,
        warn: this.snapshot?.warn || '',
        scrapedAt: this.snapshot?.scrapedAt,
        fetchedAt: this.snapshot?.fetchedAt,
        nextRefreshAt: new Date(this.nextRefreshAt || Date.now() + this.source.refreshMs).toISOString(),
        nextAllowedAttemptAt: this.nextAllowedAttemptAt ? new Date(this.nextAllowedAttemptAt).toISOString() : null,
        stale: Boolean(this.snapshot?.stale || this.lastError),
        status: this.lastError || 'ok',
      },
      rows: (this.snapshot?.rows || []).map(toPublicRow),
    };
  }
}

function toPublicRow(row) {
  return {
    rank: row.rank,
    code: row.code,
    name: row.name,
    section: row.section,
    market: row.market,
    marketName: row.marketName,
    issuer: row.issuer,
    indexName: row.indexName,
    fundType: row.fundType,
    purchaseLimit: sanitizePurchaseLimit(row.purchaseLimit),
    price: row.price,
    priceValue: row.priceValue,
    change: row.change,
    changeValue: row.changeValue,
    quoteDate: row.quoteDate,
    quoteTime: row.quoteTime,
    officialEst: row.officialEst,
    officialEstValue: row.officialEstValue,
    estDate: row.estDate,
    officialPremium: row.officialPremium,
    officialPremiumValue: row.officialPremiumValue,
    referenceEst: row.referenceEst,
    referenceEstValue: row.referenceEstValue,
    referencePremium: row.referencePremium,
    referencePremiumValue: row.referencePremiumValue,
    realtimeEst: row.realtimeEst,
    realtimeEstValue: row.realtimeEstValue,
    realtimePremium: row.realtimePremium,
    realtimePremiumValue: row.realtimePremiumValue,
    premiumBasis: row.premiumBasis,
    volume: row.volume,
    amount: row.amount,
    amountChange: row.amountChange,
    redeemStatus: row.redeemStatus,
    intraday: row.intraday || [],
  };
}

function sanitizePurchaseLimit(limit) {
  if (!limit) return null;
  return {
    status: limit.status,
    redeemStatus: limit.redeemStatus,
    nextOpenDate: limit.nextOpenDate,
    minBuy: limit.minBuy,
    dailyLimit: limit.dailyLimit,
    accountScope: limit.accountScope,
    limitText: limit.limitText,
    limited: limit.limited,
    state: limit.state,
    source: limit.source,
  };
}
