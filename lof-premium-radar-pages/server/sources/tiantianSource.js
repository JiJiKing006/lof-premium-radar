import { normalizeCode, toNumber } from '../services/fundNormalizer.js';
import { formatShanghaiTime } from '../services/sourceHealth.js';

export async function fetchTiantianNav(code, { signal } = {}) {
  const fundCode = normalizeCode(code);
  const response = await fetch(`https://fundgz.1234567.com.cn/js/${fundCode}.js?rt=${Date.now()}`, {
    signal: signal || AbortSignal.timeout(5_000),
    headers: {
      accept: '*/*',
      referer: 'https://fund.eastmoney.com/',
      'user-agent': 'Mozilla/5.0 LOF-Premium-Radar/0.1',
    },
  });

  if (!response.ok) throw new Error(`天天基金 ${fundCode} 返回 ${response.status}`);
  const text = await response.text();
  const match = text.match(/jsonpgz\((.*)\);?/);
  if (!match) throw new Error(`天天基金 ${fundCode} 字段变更`);
  const json = JSON.parse(match[1]);

  return {
    code: fundCode,
    name: json.name || '',
    lastNav: toNumber(json.dwjz),
    estimatedNav: toNumber(json.gsz),
    navDate: json.jzrq || '',
    navQuoteTime: normalizeGzTime(json.gztime),
    navSource: 'tiantian',
    updateTime: formatShanghaiTime(),
  };
}

function normalizeGzTime(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)) return `${text}:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) return text;
  return '';
}
