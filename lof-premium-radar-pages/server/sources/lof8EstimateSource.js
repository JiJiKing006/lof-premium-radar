import { normalizeCode, toNumber } from '../services/fundNormalizer.js';
import { formatShanghaiTime } from '../services/sourceHealth.js';

const LOF8_ESTIMATE_URL = 'https://lof8.cn/lof-monitor/api/lof';

export async function fetchLof8Estimates({ signal, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${LOF8_ESTIMATE_URL}?t=${Date.now()}`, {
    signal: signal || AbortSignal.timeout(4_000),
    headers: {
      accept: 'application/json',
      referer: 'https://lof8.cn/lof-monitor/',
      'user-agent': 'Mozilla/5.0 LOF-Premium-Radar/0.1',
    },
  });
  if (!response.ok) throw new Error(`LOF8 估值返回 ${response.status}`);
  const payload = await response.json();
  if (!payload?.ok || !Array.isArray(payload.data)) throw new Error('LOF8 估值字段变更');
  return payload.data.map(normalizeLof8Estimate).filter(Boolean);
}

export function normalizeLof8Estimate(row = {}) {
  const code = normalizeCode(row.code);
  const estimatedNav = toNumber(row.estNav);
  const estimatedNavTime = normalizeEstimateTime(row.estTime);
  if (!code || row.hasEstNav !== true || estimatedNav === null || estimatedNav <= 0 || !estimatedNavTime) return null;
  return {
    code,
    estimatedNav,
    estimatedNavSource: 'lof8-tiantian',
    estimatedNavTime,
    sourceStatus: 'primary',
    updateTime: formatShanghaiTime(),
  };
}

function normalizeEstimateTime(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)) return `${text}:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) return text;
  return '';
}
