import { cache, cacheTtl } from '../services/cacheService.js';
import { normalizeCategory, normalizeCode, normalizeMarket, normalizeQuoteTime, toNumber } from '../services/fundNormalizer.js';
import { formatShanghaiTime } from '../services/sourceHealth.js';

const EXCHANGE_FUND_CODE = /^(15|16|18|51|52|56|58)\d{4}$/;
const FUND_KEYWORDS = /ETF|LOF|QDII|纳指|标普|恒生|日经|美股|港股|黄金|商品|债/i;

export async function fetchSinaQuotes({ signal } = {}) {
  const directory = await fetchFundDirectory({ signal });
  const rows = (await Promise.all(chunk(directory, 120).map((group) => fetchSinaBatch(group, signal)))).flat();
  if (!rows.length) throw new Error('新浪行情返回空数组');
  return rows;
}

export async function fetchFundDirectory({ signal } = {}) {
  const cached = cache.get('fund-directory');
  if (cached) return cached;

  const response = await fetch(`https://fund.eastmoney.com/js/fundcode_search.js?t=${Date.now()}`, {
    signal,
    headers: {
      accept: 'text/javascript,*/*',
      referer: 'https://fund.eastmoney.com/',
      'user-agent': 'Mozilla/5.0 LOF-Premium-Radar/0.1',
    },
  });
  if (!response.ok) throw new Error(`基金代码目录返回 ${response.status}`);

  const text = await response.text();
  const match = text.replace(/^\uFEFF/, '').match(/var\s+r\s*=\s*(\[.*\]);?\s*$/s);
  if (!match) throw new Error('基金代码目录字段变更');

  const directory = JSON.parse(match[1])
    .map((item) => ({ code: normalizeCode(item[0]), name: item[2] || '', categoryText: item[3] || '' }))
    .filter((fund) => EXCHANGE_FUND_CODE.test(fund.code) && FUND_KEYWORDS.test(`${fund.name} ${fund.categoryText}`));

  return cache.set('fund-directory', directory, cacheTtl.fundList);
}

async function fetchSinaBatch(funds, signal) {
  const symbols = funds.map((fund) => `${exchangePrefix(fund.code)}${fund.code}`).join(',');
  const response = await fetch(`https://hq.sinajs.cn/list=${symbols}`, {
    signal,
    headers: {
      accept: '*/*',
      referer: 'https://finance.sina.com.cn/',
      'user-agent': 'Mozilla/5.0 LOF-Premium-Radar/0.1',
    },
  });
  if (!response.ok) throw new Error(`新浪行情返回 ${response.status}`);

  const text = new TextDecoder('gb18030').decode(Buffer.from(await response.arrayBuffer()));
  const fundBySymbol = new Map(funds.map((fund) => [`${exchangePrefix(fund.code)}${fund.code}`, fund]));
  return text
    .split('\n')
    .map((line) => normalizeSinaLine(line, fundBySymbol))
    .filter(Boolean);
}

function normalizeSinaLine(line, fundBySymbol) {
  const match = line.match(/var hq_str_(s[hz]\d{6})="(.*)";/);
  if (!match) return null;
  const symbol = match[1];
  const values = match[2].split(',');
  const fund = fundBySymbol.get(symbol);
  const marketPrice = toNumber(values[3]);
  if (!fund || !marketPrice) return null;

  const previousClose = toNumber(values[2]);
  const changeRate = previousClose ? ((marketPrice / previousClose) - 1) * 100 : null;
  const quoteTime = normalizeQuoteTime(values[30], values[31]);
  const name = values[0] || fund.name;
  const category = normalizeCategory({ code: fund.code, name, category: fund.categoryText });
  const base = {
    code: fund.code,
    name,
    category,
    marketPrice,
    changeRate,
    volume: toNumber(values[8]),
    turnover: toNumber(values[9]),
    source: 'sina',
    sourceStatus: 'fallback',
    quoteTime,
    updateTime: formatShanghaiTime(),
    isRealtime: Boolean(quoteTime),
  };
  return { ...base, market: normalizeMarket({ ...base, category: fund.categoryText }) };
}

function exchangePrefix(code) {
  return /^(5|6)/.test(code) ? 'sh' : 'sz';
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}
