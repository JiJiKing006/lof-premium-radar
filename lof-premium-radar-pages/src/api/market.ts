export interface MarketIndexItem {
  key: string;
  code: string;
  name: string;
  value: number | null;
  change: number | null;
  changeRate: number | null;
  quoteTime: string;
  source: string;
}

export interface MarketIndexSnapshot {
  meta: {
    source: string;
    sourceStatus: string;
    updateTime?: string;
    latestQuoteTime?: string;
    rowCount?: number;
    stale?: boolean;
    error?: string;
  };
  rows: MarketIndexItem[];
}

export async function fetchMarketIndices({ force = false } = {}): Promise<MarketIndexSnapshot> {
  const params = new URLSearchParams({ t: String(Date.now()) });
  if (force) params.set('force', '1');
  const response = await fetch(`/api/market/indices?${params.toString()}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`指数行情接口返回 ${response.status}`);
  return (await response.json()) as MarketIndexSnapshot;
}
