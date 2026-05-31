import type { FundHistorySnapshot, FundItem, FundSnapshot, FundType, HotArbitrageSnapshot } from '../types/fund';
import { toNumber } from '../utils/format';
import { computeRiskTags, normalizeSubscriptionState } from '../utils/risk';
import { isStale } from '../utils/time';

interface RawSnapshot {
  meta?: Record<string, unknown>;
  rows?: RawFundRow[];
}

type RawFundRow = Record<string, any>;

export async function fetchFundsSnapshot({ force = false, section = 'qdii', includeTrends = true } = {}): Promise<FundSnapshot> {
  const params = new URLSearchParams({ t: String(Date.now()) });
  if (section) params.set('category', section.toUpperCase());
  if (force) params.set('force', '1');
  if (!includeTrends) params.set('trends', '0');

  const response = await fetch(`/api/funds/quotes?${params.toString()}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`行情接口返回 ${response.status}`);
  }

  const raw = (await response.json()) as RawSnapshot;
  const meta = normalizeMeta(raw.meta || {}, section);
  const rows = (raw.rows || []).map((row) => normalizeFund(row, meta));

  return { meta, rows };
}

export async function fetchFundSnapshot(options: { force?: boolean; section?: string } = {}) {
  return fetchFundsSnapshot(options);
}

export async function fetchFundDetail(code: string, { force = false, section = '' } = {}): Promise<FundItem> {
  const params = new URLSearchParams({ t: String(Date.now()) });
  if (section) params.set('category', section.toUpperCase());
  if (force) params.set('force', '1');
  const response = await fetch(`/api/funds/${code}?${params.toString()}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`基金详情接口返回 ${response.status}`);
  const row = await response.json();
  const meta = normalizeMeta({ sourceProvider: row.source, updateTime: row.updateTime }, section);
  return normalizeFund(row, meta);
}

export async function fetchFundHistory(code: string, { force = false, limit = 60 } = {}): Promise<FundHistorySnapshot> {
  const params = new URLSearchParams({ t: String(Date.now()), limit: String(limit) });
  if (force) params.set('force', '1');
  const response = await fetch(`/api/funds/${code}/history?${params.toString()}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`基金历史接口返回 ${response.status}`);
  return (await response.json()) as FundHistorySnapshot;
}

export async function fetchHotArbitrageSnapshot({ force = false, section = 'ALL', limit = 20 } = {}): Promise<HotArbitrageSnapshot> {
  const params = new URLSearchParams({ t: String(Date.now()), limit: String(limit) });
  if (section && section !== 'WATCH') params.set('category', section.toUpperCase());
  if (force) params.set('force', '1');
  const response = await fetch(`/api/funds/hot-arbitrage?${params.toString()}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`热门套利榜接口返回 ${response.status}`);
  return (await response.json()) as HotArbitrageSnapshot;
}

function normalizeMeta(meta: Record<string, unknown>, section: string): FundSnapshot['meta'] {
  return {
    sourceId: String(meta.sourceId || section),
    sourceTitle: String(meta.sourceTitle || section),
    sourceProvider: String(meta.sourceProvider || meta.sourceId || 'internal'),
    rowCount: toNumber(meta.rowCount) || 0,
    allCount: toNumber(meta.allCount) || toNumber(meta.rowCount) || 0,
    warn: String(meta.warn || ''),
    fetchedAt: typeof meta.fetchedAt === 'string' ? meta.fetchedAt : undefined,
    scrapedAt: typeof meta.scrapedAt === 'string' ? meta.scrapedAt : undefined,
    latestQuoteTime: typeof meta.latestQuoteTime === 'string' ? meta.latestQuoteTime : undefined,
    updateTime: typeof meta.updateTime === 'string' ? meta.updateTime : undefined,
    sourceStatus: typeof meta.sourceStatus === 'string' ? meta.sourceStatus : undefined,
    stale: Boolean(meta.stale),
    status: String(meta.status || 'ok'),
    trendsIncluded: Boolean(meta.trendsIncluded),
  };
}

function normalizeFund(row: RawFundRow, meta: FundSnapshot['meta']): FundItem {
  if ('marketPrice' in row || 'lastNav' in row || 'estimatedNav' in row) {
    return normalizeUnifiedFund(row, meta);
  }

  const updatedAt = buildUpdatedAt(row, meta);
  const subscriptionStatus = row.purchaseLimit?.limitText || row.purchaseLimit?.status || row.subscriptionStatus || '';
  const subscriptionState = row.purchaseLimit?.state || normalizeSubscriptionState(subscriptionStatus);
  const stale = Boolean(row.stale || meta.stale || isStale(updatedAt));
  const premiumRate = toNumber(row.realtimePremiumValue ?? row.realtimePremium ?? row.officialPremiumValue ?? row.officialPremium);
  const amount = toNumber(row.amount ?? row.volume);
  const type = normalizeType(row, meta.sourceId);
  const confidence = computeConfidence({ stale, premiumRate, price: row.price, sourceStatus: meta.status });

  const fund: FundItem = {
    code: String(row.code || ''),
    name: String(row.name || ''),
    type,
    price: toNumber(row.priceValue ?? row.price),
    changePercent: toNumber(row.changeValue ?? row.change),
    nav: toNumber(row.officialEstValue ?? row.officialEst),
    navDate: row.estDate || row.navDate || null,
    estimatedValue: toNumber(row.realtimeEstValue ?? row.realtimeEst ?? row.referenceEst),
    premiumRate,
    volume: toNumber(row.volume),
    amount,
    shareAmount: String(row.shareAmount || ''),
    shareChange: String(row.shareChange || ''),
    shareSource: String(row.shareSource || ''),
    shareTime: String(row.shareTime || row.quoteTime || ''),
    subscriptionStatus: subscriptionStatus || '--',
    subscriptionState,
    redemptionStatus: row.redeemStatus || row.purchaseLimit?.redeemStatus || '--',
    market: normalizeExchange(row),
    source: row.source || meta.sourceProvider || 'internal',
    updatedAt,
    stale,
    confidence,
    riskTags: [],
    errorMessage: stale ? meta.status || '数据延迟' : row.errorMessage || '',
    raw: row,
  };

  fund.riskTags = computeRiskTags(fund);
  return fund;
}

function normalizeUnifiedFund(row: RawFundRow, meta: FundSnapshot['meta']): FundItem {
  const type = normalizeUnifiedType(row.category);
  const updatedAt = String(row.updateTime || row.quoteTime || meta.updateTime || '');
  const stale = row.sourceStatus === 'cache' || Boolean(row.isAbnormal);
  const fund: FundItem = {
    code: String(row.code || ''),
    name: String(row.name || ''),
    type,
    price: toNumber(row.marketPrice),
    marketPrice: toNumber(row.marketPrice),
    changePercent: toNumber(row.changeRate),
    changeRate: toNumber(row.changeRate),
    nav: toNumber(row.lastNav),
    lastNav: toNumber(row.lastNav),
    navDate: row.navDate || null,
    estimatedValue: toNumber(row.estimatedNav),
    estimatedNav: toNumber(row.estimatedNav),
    premiumRate: toNumber(row.premiumRate),
    premiumBasis: row.premiumBasis || '',
    premiumNote: row.premiumNote || '',
    estimatedNavSource: row.estimatedNavSource || '',
    estimatedNavTime: row.estimatedNavTime || '',
    navSource: row.navSource || '',
    estimateConfidence: row.estimateConfidence || '',
    estimateDeviationRate: toNumber(row.estimateDeviationRate),
    estimateWarning: row.estimateWarning || '',
    estimateSources: Array.isArray(row.estimateSources) ? row.estimateSources : [],
    volume: toNumber(row.volume),
    amount: toNumber(row.turnover),
    turnover: toNumber(row.turnover),
    shareAmount: String(row.shareAmount || ''),
    shareChange: String(row.shareChange || ''),
    shareSource: String(row.shareSource || ''),
    shareTime: String(row.shareTime || ''),
    subscriptionStatus: '--',
    subscriptionState: 'unknown',
    redemptionStatus: '--',
    market: normalizeExchange(row),
    source: row.source || meta.sourceProvider || 'internal',
    quoteSource: row.quoteSource || '',
    subscriptionSource: row.subscriptionSource || '',
    trendSource: row.trendSource || '',
    sourceStatus: row.sourceStatus,
    purchaseLimit: row.purchaseLimit,
    intraday: Array.isArray(row.intraday) ? row.intraday : [],
    quoteTime: row.quoteTime || '',
    updatedAt,
    updateTime: row.updateTime || '',
    isRealtime: Boolean(row.isRealtime),
    isAbnormal: Boolean(row.isAbnormal),
    abnormalReason: row.abnormalReason || '',
    stale,
    confidence: row.isAbnormal ? 60 : row.sourceStatus === 'cache' ? 70 : 100,
    riskTags: [],
    errorMessage: row.abnormalReason || '',
    raw: row,
  };
  fund.riskTags = computeRiskTags(fund);
  return fund;
}

function normalizeType(row: RawFundRow, section: string): FundType {
  const text = `${row.fundType || ''} ${row.name || ''} ${section}`.toUpperCase();
  if (text.includes('LOF')) return 'LOF';
  if (text.includes('ETF')) return 'ETF';
  return 'QDII';
}

function normalizeUnifiedType(value: unknown): FundType {
  const text = String(value || '').toUpperCase();
  if (text === 'LOF') return 'LOF';
  if (text === 'ETF') return 'ETF';
  return 'QDII';
}

function normalizeExchange(row: RawFundRow): string {
  const explicit = String(row.exchange || row.exchangeMarket || row.marketCode || '').toUpperCase();
  if (explicit.includes('SH') || explicit.includes('SSE') || explicit.includes('沪')) return 'SH';
  if (explicit.includes('SZ') || explicit.includes('SZSE') || explicit.includes('深')) return 'SZ';

  const code = String(row.code || '').replace(/^(SH|SZ)/i, '');
  if (/^(15|16|18)/.test(code)) return 'SZ';
  if (/^(50|51|52|56|58)/.test(code)) return 'SH';
  return '';
}

function buildUpdatedAt(row: RawFundRow, meta: FundSnapshot['meta']): string {
  if (row.updatedAt) return String(row.updatedAt);
  if (row.quoteDate && row.quoteTime) return `${row.quoteDate}T${row.quoteTime}`;
  return meta.fetchedAt || meta.scrapedAt || '';
}

function computeConfidence(input: { stale: boolean; premiumRate: number | null; price: unknown; sourceStatus?: string }): number {
  let confidence = 100;
  if (input.stale) confidence -= 35;
  if (input.premiumRate === null) confidence -= 20;
  if (toNumber(input.price) === null) confidence -= 20;
  if (input.sourceStatus && input.sourceStatus !== 'ok') confidence -= 15;
  return Math.max(0, confidence);
}
