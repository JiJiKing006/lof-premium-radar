import { normalizeCategory, normalizeCode, normalizeMarket, normalizeQuoteTime, toNumber } from '../services/fundNormalizer.js';
import { formatShanghaiTime } from '../services/sourceHealth.js';

const FIELDS = ['f12', 'f13', 'f14', 'f2', 'f3', 'f5', 'f6', 'f124'];

export async function fetchEastmoneyQuotes({ signal } = {}) {
  const first = await fetchPage(1, signal);
  const pageSize = first.rows.length || 100;
  const totalPages = Math.max(1, Math.ceil((first.total || 0) / pageSize));
  const pages = [first];

  for (let page = 2; page <= totalPages; page += 1) {
    pages.push(await fetchPage(page, signal));
  }

  return pages.flatMap((page) => page.rows);
}

async function fetchPage(page, signal) {
  const url = new URL('https://push2.eastmoney.com/api/qt/clist/get');
  url.searchParams.set('pn', String(page));
  url.searchParams.set('pz', '100');
  url.searchParams.set('po', '1');
  url.searchParams.set('np', '1');
  url.searchParams.set('fltt', '2');
  url.searchParams.set('invt', '2');
  url.searchParams.set('fid', 'f3');
  url.searchParams.set('fs', 'b:MK0021,b:MK0022,b:MK0023');
  url.searchParams.set('fields', FIELDS.join(','));
  url.searchParams.set('t', String(Date.now()));

  const response = await fetch(url, {
    signal,
    headers: {
      accept: 'application/json,text/plain,*/*',
      referer: 'https://quote.eastmoney.com/center/gridlist.html',
      'user-agent': 'Mozilla/5.0 LOF-Premium-Radar/0.1',
    },
  });

  if (!response.ok) throw new Error(`东方财富行情返回 ${response.status}`);
  const json = await response.json();
  const rows = (json.data?.diff || []).map(normalizeRow).filter(Boolean);
  if (!rows.length) throw new Error('东方财富行情返回空数组');

  return { total: Number(json.data?.total || rows.length), rows };
}

function normalizeRow(cell) {
  const code = normalizeCode(cell.f12);
  const marketPrice = toNumber(cell.f2);
  if (!code || !cell.f14) return null;
  const quoteTime = epochToShanghaiTime(cell.f124);
  const base = {
    code,
    name: cell.f14,
    category: normalizeCategory({ code, name: cell.f14 }),
    marketPrice,
    changeRate: toNumber(cell.f3),
    volume: toNumber(cell.f5),
    volumeUnit: 'lot',
    turnover: toNumber(cell.f6),
    source: 'eastmoney',
    sourceStatus: 'primary',
    quoteTime,
    updateTime: formatShanghaiTime(),
    isRealtime: Boolean(quoteTime),
  };
  return { ...base, market: normalizeMarket(base) };
}

function epochToShanghaiTime(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  return formatShanghaiTime(new Date(seconds * 1000));
}
