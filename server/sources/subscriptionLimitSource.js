import { cache, cacheTtl } from '../services/cacheService.js';
import { normalizeCode, toNumber } from '../services/fundNormalizer.js';
import { recordSourceFailure, recordSourceSuccess } from '../services/sourceHealth.js';

const SOURCE_URL = 'https://fund.eastmoney.com/Data/Fund_JJJZ_Data.aspx';

export async function fetchSubscriptionLimitMap(codes, { force = false } = {}) {
  const normalizedCodes = new Set((codes || []).map(normalizeCode).filter(Boolean));
  if (!normalizedCodes.size) return new Map();

  const all = await fetchAllSubscriptionLimits({ force });
  return new Map([...all].filter(([code]) => normalizedCodes.has(code)));
}

async function fetchAllSubscriptionLimits({ force = false } = {}) {
  const cacheKey = 'subscription-limits:all';
  if (!force) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  const startedAt = Date.now();
  try {
    const url = new URL(SOURCE_URL);
    url.searchParams.set('t', '8');
    url.searchParams.set('page', '1,30000');
    url.searchParams.set('js', 'reData');
    url.searchParams.set('sort', 'fcode,asc');
    url.searchParams.set('_', String(Date.now()));

    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        accept: 'application/javascript,text/plain,*/*',
        referer: 'https://fund.eastmoney.com/Fund_sgzt.html',
        'user-agent': 'Mozilla/5.0 LOF-Premium-Radar/0.1',
      },
    });
    if (!response.ok) throw new Error(`天天基金申购状态返回 ${response.status}`);
    const text = await response.text();
    const data = parseReData(text);
    const map = new Map((data.datas || []).map(normalizeLimit).filter(Boolean).map((item) => [item.code, item]));
    if (!map.size) throw new Error('天天基金申购状态返回空数组');
    recordSourceSuccess('tiantian-subscription', Date.now() - startedAt);
    return cache.set(cacheKey, map, cacheTtl.fundList);
  } catch (error) {
    recordSourceFailure('tiantian-subscription', error, Date.now() - startedAt);
    return cache.getStale(cacheKey) || new Map();
  }
}

function parseReData(text) {
  return Function(`${text}; return reData;`)();
}

function normalizeLimit(row) {
  const code = normalizeCode(row[0]);
  if (!code) return null;
  const status = clean(row[5]);
  const redemptionStatus = clean(row[6]);
  const minPurchase = toNumber(row[8]);
  const dailyLimit = toNumber(row[9]);
  const state = normalizeState(status);
  const limitText = buildLimitText(status, dailyLimit);
  return {
    code,
    state,
    label: limitText,
    limitText,
    purchaseStatus: status || '未知',
    redemptionStatus: redemptionStatus || '未知',
    minPurchase,
    dailyLimit,
    fee: clean(row[12]),
    navDate: normalizeShortDate(row[4]),
    source: 'tiantian',
  };
}

function normalizeState(status) {
  if (/暂停|停止|封闭|终止|失败/.test(status)) return 'paused';
  if (/限|大额/.test(status)) return 'limited';
  if (/开放/.test(status)) return 'open';
  return 'unknown';
}

function buildLimitText(status, dailyLimit) {
  if (!status) return '未知';
  if (/场内交易/.test(status)) return '场内交易';
  if (/暂停|停止|封闭|终止|失败/.test(status)) return status;
  if (/限|大额/.test(status)) return dailyLimit !== null ? `${status} ${moneyText(dailyLimit)}` : status;
  if (/开放/.test(status)) return dailyLimit !== null ? `${status} / ${moneyText(dailyLimit)}` : status;
  return status;
}

function moneyText(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return '---';
  if (number >= 800_000_000) return '无限额';
  if (number < 10_000) return `${trimNumber(number)}元`;
  if (number < 100_000_000) return `${trimNumber(number / 10_000)}万`;
  return `${trimNumber(number / 100_000_000)}亿`;
}

function trimNumber(value) {
  return Number(value.toFixed(2)).toString();
}

function normalizeShortDate(value) {
  const text = clean(value);
  if (/^\d{2}-\d{2}$/.test(text)) return `${new Date().getFullYear()}-${text}`;
  return text;
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
