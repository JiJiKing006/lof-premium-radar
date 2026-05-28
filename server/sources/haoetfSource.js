import { load } from 'cheerio';
import { normalizeCode, toNumber } from '../services/fundNormalizer.js';
import { formatShanghaiTime } from '../services/sourceHealth.js';

const HAOETF_URL = 'https://www.haoetf.com/';

export async function fetchHaoetfQuotes(category, { signal } = {}) {
  const response = await fetch(`${HAOETF_URL}?t=${Date.now()}`, {
    signal: signal || AbortSignal.timeout(12_000),
    headers: {
      accept: 'text/html,application/xhtml+xml',
      referer: HAOETF_URL,
      'user-agent': 'Mozilla/5.0 LOF-Premium-Radar/0.1',
    },
  });
  if (!response.ok) throw new Error(`HaoETF 返回 ${response.status}`);

  const html = await response.text();
  const $ = load(html);
  const updateTime = parseUpdateTime($, html);
  const tableIndex = String(category).toUpperCase() === 'ETF' ? 1 : 0;
  const rows = parseTable($, $('table').eq(tableIndex), String(category).toUpperCase(), updateTime);
  if (!rows.length) throw new Error(`HaoETF ${category} 表格为空或字段变更`);
  return rows;
}

function parseTable($, table, category, updateTime) {
  const rows = [];
  table.find('tr').slice(1).each((index, tr) => {
    const cells = $(tr)
      .children('td')
      .map((_, td) => clean($(td).text()))
      .get();
    if (cells.length < 15) return;
    const code = normalizeCode(cells[0]);
    const name = cells[1];
    const marketPrice = toNumber(cells[7]);
    if (!code || !name || marketPrice === null) return;
    rows.push({
      rank: index + 1,
      code,
      name,
      category,
      marketPrice,
      lastNav: toNumber(cells[12]),
      estimatedNav: toNumber(cells[2] || cells[4]),
      changeRate: toNumber(cells[8]),
      volume: null,
      turnover: amountWanToYuan(cells[9]),
      purchaseLimit: normalizePurchaseLimit(category === 'ETF' ? '' : cells[16]),
      source: 'haoetf',
      sourceStatus: 'primary',
      quoteTime: updateTime,
      updateTime: formatShanghaiTime(),
      navDate: normalizeShortDate(cells[14] || cells[6]),
      navQuoteTime: updateTime,
      isRealtime: true,
      market: inferMarket(name),
    });
  });
  return rows;
}

function parseUpdateTime($, html) {
  const text = clean($('body').text());
  const match = text.match(/数据更新时间[:：]\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
  if (match) return match[1];
  const epoch = html.match(/new Date\((\d+)\)/);
  if (epoch) return formatShanghaiTime(new Date(Number(epoch[1])));
  return '';
}

function normalizePurchaseLimit(value) {
  const text = clean(value);
  if (!text || text === '-') return { state: 'unknown', label: '未知' };
  if (/暂停/.test(text)) return { state: 'paused', label: text };
  if (/限|元|万/.test(text)) return { state: 'limited', label: text };
  if (/开放|0$/.test(text)) return { state: 'open', label: text };
  return { state: 'unknown', label: text };
}

function inferMarket(name) {
  if (/恒生|港股|中概|中国互联网|H股/.test(name)) return '港股';
  if (/纳指|纳斯达克|标普|美国|德国|法国/.test(name)) return '美股';
  if (/日经|日本/.test(name)) return '日股';
  if (/黄金|商品|原油|油气|石油/.test(name)) return '商品';
  return '全球';
}

function amountWanToYuan(value) {
  const number = toNumber(value);
  return number === null ? null : number * 10_000;
}

function normalizeShortDate(value) {
  const text = clean(value);
  if (/^\d{2}-\d{2}$/.test(text)) return `${new Date().getFullYear()}-${text}`;
  return text;
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
