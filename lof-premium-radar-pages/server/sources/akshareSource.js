import { normalizeCode, toNumber } from '../services/fundNormalizer.js';
import { formatShanghaiTime } from '../services/sourceHealth.js';

const AKSHARE_ESTIMATE_URL = 'https://api.fund.eastmoney.com/FundGuZhi/GetFundGZList';

export async function fetchAkshareQuotes({ signal } = {}) {
  if (!process.env.AKSHARE_BASE_URL) {
    throw new Error('AKSHARE_BASE_URL 未配置');
  }

  const response = await fetch(`${process.env.AKSHARE_BASE_URL.replace(/\/$/, '')}/fund/quotes`, {
    signal,
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`AKShare 返回 ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows.length) throw new Error('AKShare 返回空数组');

  // TODO: 根据实际 AKShare HTTP 封装字段补充映射。目前仅支持已统一格式的内部 AKShare 网关。
  return rows.map((row) => ({ ...row, source: 'akshare', sourceStatus: 'fallback' }));
}

// Node.js implementation of AKShare fund_value_estimation_em("LOF").
// AKShare is the adapter contract; Eastmoney is the actual upstream publisher.
export async function fetchAkshareEstimatedNavs({ codes = [], signal, fetchImpl = fetch, now = new Date() } = {}) {
  const requestedCodes = new Set(codes.map(normalizeCode).filter(Boolean));
  const url = new URL(AKSHARE_ESTIMATE_URL);
  Object.entries({
    type: '8',
    sort: '3',
    orderType: 'desc',
    canbuy: '0',
    pageIndex: '1',
    pageSize: '20000',
    _: now.getTime(),
  }).forEach(([key, value]) => url.searchParams.set(key, value));

  const response = await fetchImpl(url, {
    signal: signal || AbortSignal.timeout(6_000),
    headers: {
      accept: 'application/json,text/plain,*/*',
      referer: 'https://fund.eastmoney.com/',
      'user-agent': 'Mozilla/5.0 LOF-Premium-Radar/0.1 (AKShare-compatible Node adapter)',
    },
  });
  if (!response.ok) throw new Error(`AKShare 估值上游返回 ${response.status}`);
  const payload = await response.json();
  const rows = payload?.Data?.list;
  const estimateDate = String(payload?.Data?.gxrq || '').trim();
  const today = shanghaiDate(now);
  if (!Array.isArray(rows)) throw new Error('AKShare 估值上游字段变更');
  if (estimateDate !== today) throw new Error(`AKShare 估值不是今日数据: ${estimateDate || '无日期'}`);

  const retrievedAt = formatShanghaiTime(now);
  return rows.map((row) => normalizeAkshareEstimate(row, {
    requestedCodes,
    estimateDate,
    retrievedAt,
  })).filter(Boolean);
}

export function normalizeAkshareEstimate(row = {}, { requestedCodes = new Set(), estimateDate = '', retrievedAt = '' } = {}) {
  const code = normalizeCode(row.bzdm);
  const estimatedNav = toNumber(row.gsz);
  if (!code || (requestedCodes.size && !requestedCodes.has(code))) return null;
  if (String(row.gxrq || '').trim() !== estimateDate) return null;
  if (estimatedNav === null || estimatedNav <= 0 || !retrievedAt) return null;
  return {
    code,
    estimatedNav,
    estimatedNavSource: 'akshare-eastmoney',
    estimatedNavTime: retrievedAt,
    estimateDate,
    upstreamSource: 'eastmoney-fund-guzhi',
    sourceStatus: 'fallback',
    updateTime: retrievedAt,
  };
}

function shanghaiDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}
