export type FundType = 'QDII' | 'LOF' | 'ETF';

export type SubscriptionState = 'open' | 'limited' | 'paused' | 'unknown';

export type RiskLevel = 'danger' | 'warning' | 'success' | 'neutral';

export interface RiskTag {
  key: string;
  label: string;
  level: RiskLevel;
}

export interface DataSourceState {
  source: string;
  updatedAt: string;
  stale: boolean;
  confidence: number;
  errorMessage?: string;
}

export interface FundItem {
  code: string;
  name: string;
  type: FundType;
  price: number | null;
  marketPrice?: number | null;
  changePercent: number | null;
  changeRate?: number | null;
  nav: number | null;
  lastNav?: number | null;
  navDate: string | null;
  estimatedValue: number | null;
  estimatedNav?: number | null;
  premiumRate: number | null;
  premiumBasis?: string;
  premiumNote?: string;
  estimatedNavSource?: string;
  estimatedNavTime?: string;
  estimateConfidence?: string;
  estimateDeviationRate?: number | null;
  estimateWarning?: string;
  estimateSources?: Array<{ role?: string; source?: string; value?: number | null; time?: string }>;
  volume: number | null;
  amount: number | null;
  turnover?: number | null;
  subscriptionStatus: string;
  subscriptionState: SubscriptionState;
  redemptionStatus: string;
  source: string;
  quoteSource?: string;
  subscriptionSource?: string;
  trendSource?: string;
  sourceStatus?: 'primary' | 'fallback' | 'cache';
  purchaseLimit?: { state?: string; label?: string; limitText?: string };
  intraday?: Array<{ time?: string; price?: number | null; volume?: number | null; turnover?: number | null }>;
  quoteTime?: string;
  navQuoteTime?: string;
  updatedAt: string;
  updateTime?: string;
  isRealtime?: boolean;
  isAbnormal?: boolean;
  abnormalReason?: string;
  stale: boolean;
  confidence: number;
  riskTags: RiskTag[];
  errorMessage?: string;
  raw?: Record<string, unknown>;
  changedFields?: string[];
}

export interface FundSnapshot {
  meta: {
    sourceId: string;
    sourceTitle: string;
    sourceProvider: string;
    rowCount: number;
    allCount?: number;
    warn?: string;
    fetchedAt?: string;
    scrapedAt?: string;
    latestQuoteTime?: string;
    updateTime?: string;
    sourceStatus?: string;
    stale?: boolean;
    status?: string;
    trendsIncluded?: boolean;
  };
  rows: FundItem[];
}

export interface FundHistoryRow {
  date: string;
  unitNav: number | null;
  accumulatedNav: number | null;
  navGrowthRate: number | null;
  closePrice: number | null;
  openPrice: number | null;
  highPrice: number | null;
  lowPrice: number | null;
  changeRate: number | null;
  volume: number | null;
  turnover: number | null;
  premiumRate: number | null;
  purchaseStatus: string;
  redemptionStatus: string;
  navSource: string;
  priceSource: string;
}

export interface FundHistorySnapshot {
  meta: {
    code: string;
    rowCount: number;
    navCount: number;
    priceCount: number;
    sourceProvider: string;
    status: string;
  };
  rows: FundHistoryRow[];
}

export type FundFilter =
  | 'all'
  | 'highPremium'
  | 'discount'
  | 'qdii'
  | 'lof'
  | 'etf'
  | 'abnormal';

export type FundSortKey = 'premiumRate' | 'turnover' | 'changeRate' | 'price' | 'lastNav' | 'estimatedNav' | 'volume';
