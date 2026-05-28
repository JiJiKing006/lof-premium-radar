import { load } from 'cheerio';
import { normalizeCode, toNumber } from '../services/fundNormalizer.js';
import { formatShanghaiTime } from '../services/sourceHealth.js';

const PALMMICRO_LOF_URL = 'https://palmmicro.com/woody/res/lofcn.php?sort=premium';

export async function fetchPalmmicroLofQuotes({ signal } = {}) {
  const response = await fetch(`${PALMMICRO_LOF_URL}&t=${Date.now()}`, {
    signal: signal || AbortSignal.timeout(12_000),
    headers: {
      accept: 'text/html,application/xhtml+xml',
      referer: PALMMICRO_LOF_URL,
      'user-agent': 'Mozilla/5.0 LOF-Premium-Radar/0.1',
    },
  });
  if (!response.ok) throw new Error(`Palmmicro LOF 返回 ${response.status}`);

  const html = await response.text();
  const $ = load(html);
  const quoteMap = parseReferenceRows($);
  const rows = parseEstRows($, quoteMap, html);
  if (!rows.length) throw new Error('Palmmicro LOF 表格为空或字段变更');
  return rows;
}

function parseReferenceRows($) {
  const map = new Map();
  $('#referencetable tr').slice(1).each((_, tr) => {
    const cells = $(tr).children('td').map((__, td) => clean($(td).text())).get();
    const code = normalizeCode(cells[0]);
    if (!code) return;
    map.set(code, {
      code,
      marketPrice: toNumber(cells[1]),
      changeRate: toNumber(cells[2]),
      quoteTime: cells[3] && cells[4] ? `${cells[3]} ${cells[4].length === 5 ? `${cells[4]}:00` : cells[4]}` : '',
      name: cells[5] || code,
    });
  });
  return map;
}

function parseEstRows($, quoteMap, html) {
  const updateTime = parseUpdateTime(html);
  const table = $('table')
    .filter((_, item) => $(item).attr('id') !== 'referencetable' && clean($(item).find('th').eq(1).text()).includes('官方EST'))
    .last();
  const rows = [];
  table.find('tr').slice(1).each((index, tr) => {
    const cells = $(tr).children('td').map((_, td) => clean($(td).text())).get();
    const code = normalizeCode(cells[0]);
    const quote = quoteMap.get(code);
    if (!code || !quote?.marketPrice) return;
    rows.push({
      rank: index + 1,
      code,
      name: quote.name,
      category: 'LOF',
      marketPrice: quote.marketPrice,
      lastNav: toNumber(cells[1]),
      estimatedNav: toNumber(cells[6] || cells[4] || cells[1]),
      changeRate: quote.changeRate,
      volume: null,
      turnover: null,
      purchaseLimit: { state: 'unknown', label: '未知' },
      source: 'palmmicro',
      sourceStatus: 'primary',
      quoteTime: quote.quoteTime || updateTime,
      updateTime: formatShanghaiTime(),
      navDate: cells[2] || '',
      navQuoteTime: quote.quoteTime || updateTime,
      isRealtime: Boolean(quote.quoteTime),
      market: inferMarket(quote.name),
    });
  });
  return rows;
}

function parseUpdateTime(html) {
  const match = html.match(/new Date\((\d+)\)/);
  return match ? formatShanghaiTime(new Date(Number(match[1]))) : '';
}

function inferMarket(name) {
  if (/恒生|港股|H股|香港/.test(name)) return '港股';
  if (/纳斯达克|纳指|标普|美国|REIT|美元/.test(name)) return '美股';
  if (/印度|全球|海外/.test(name)) return '全球';
  if (/黄金|商品|原油|油气|石油|白银/.test(name)) return '商品';
  return 'A股';
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
