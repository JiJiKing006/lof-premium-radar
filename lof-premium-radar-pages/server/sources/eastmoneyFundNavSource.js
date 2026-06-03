import { normalizeCode, toNumber } from '../services/fundNormalizer.js';
import { formatShanghaiTime } from '../services/sourceHealth.js';

export async function fetchEastmoneyFundNav(code, { signal } = {}) {
  const fundCode = normalizeCode(code);
  const response = await fetch(`https://fund.eastmoney.com/pingzhongdata/${fundCode}.js?t=${Date.now()}`, {
    signal: signal || AbortSignal.timeout(8_000),
    headers: {
      accept: 'application/javascript,text/javascript,*/*',
      referer: `https://fund.eastmoney.com/${fundCode}.html`,
      'user-agent': 'Mozilla/5.0 LOF-Premium-Radar/0.1',
    },
  });
  if (!response.ok) throw new Error(`东方财富基金净值 ${fundCode} 返回 ${response.status}`);
  return parseEastmoneyFundNavFromScript(fundCode, await response.text());
}

export function parseEastmoneyFundNavFromScript(code, script) {
  const fundCode = normalizeCode(code);
  const name = parseVarString(script, 'fS_name');
  const trend = parseVarJson(script, 'Data_netWorthTrend');
  const latest = Array.isArray(trend) ? trend.filter((item) => toNumber(item?.y) !== null).at(-1) : null;
  if (!latest) throw new Error(`东方财富基金净值 ${fundCode} 缺少净值走势`);
  const navDate = timestampToShanghaiDate(latest.x);
  return {
    code: fundCode,
    name,
    lastNav: toNumber(latest.y),
    estimatedNav: null,
    navDate,
    navQuoteTime: navDate ? `${navDate} 00:00:00` : '',
    navSource: 'eastmoney',
    updateTime: formatShanghaiTime(),
  };
}

function parseVarString(script, name) {
  const match = String(script || '').match(new RegExp(`var\\s+${name}\\s*=\\s*\"([^\"]*)\"`));
  return match ? match[1] : '';
}

function parseVarJson(script, name) {
  const pattern = new RegExp(`var\\s+${name}\\s*=\\s*([\\s\\S]*?);\\s*(?:/\\*|var\\s+|$)`);
  const match = String(script || '').match(pattern);
  if (!match) return null;
  return JSON.parse(match[1]);
}

function timestampToShanghaiDate(value) {
  const time = Number(value);
  if (!Number.isFinite(time) || time <= 0) return '';
  return formatShanghaiTime(new Date(time)).slice(0, 10);
}
