const QDII_KEYWORDS = [
  'QDII',
  '纳指',
  '纳斯达克',
  '标普',
  '道琼斯',
  '恒生科技',
  '恒生',
  'H股',
  '日经',
  '美股',
  '美国',
  '港股',
  '港美',
  '香港',
  '海外',
  '全球',
  '国际',
  '德国',
  '法国',
  '亚太',
  '印度',
  '越南',
  '原油',
  '石油',
  '油气',
  '白银',
  '黄金',
  '商品',
];
const ETF_KEYWORDS = ['ETF'];
const LOF_KEYWORDS = ['LOF'];

export function normalizeCategory(row = {}) {
  const fieldText = upper(row.category, row.fundType, row.securityType, row.marketType);
  if (fieldText.includes('QDII')) return 'QDII';
  if (fieldText.includes('ETF')) return 'ETF';
  if (fieldText.includes('LOF')) return 'LOF';

  const nameText = upper(row.name, row.fundName, row.indexName);
  if (includesAny(nameText, QDII_KEYWORDS)) return 'QDII';
  if (includesAny(nameText, LOF_KEYWORDS)) return 'LOF';
  if (includesAny(nameText, ETF_KEYWORDS)) return 'ETF';
  return 'ETF';
}

export function normalizeMarket(row = {}) {
  const text = upper(row.market, row.region, row.marketName, row.name, row.indexName, row.category);
  if (/港股|恒生|H股|香港/.test(text)) return '港股';
  if (/纳指|纳斯达克|标普|道琼斯|美国|美股|NASDAQ|S&P/.test(text)) return '美股';
  if (/日本|日经/.test(text)) return '日股';
  if (/全球|海外|国际/.test(text)) return '全球';
  if (/债|国债|信用债|可转债/.test(text)) return '债券';
  if (/商品|黄金|白银|原油|石油|油气|豆粕|能源/.test(text)) return '商品';
  if (/沪深|中证|创业板|科创|上证|深证|A股/.test(text)) return 'A股';
  return '其他';
}

export function normalizeCode(code) {
  return String(code || '').replace(/^(SZ|SH)/i, '').trim();
}

export function toNumber(value) {
  if (value === null || value === undefined || value === '' || value === '-') return null;
  const number = Number.parseFloat(String(value).replace('%', '').replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

export function normalizeQuoteTime(date, time) {
  const safeDate = String(date || '').trim();
  const safeTime = String(time || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(safeDate) && /^\d{2}:\d{2}(:\d{2})?$/.test(safeTime)) {
    return `${safeDate} ${safeTime.length === 5 ? `${safeTime}:00` : safeTime}`;
  }
  return '';
}

function upper(...parts) {
  return parts
    .filter((part) => part !== null && part !== undefined)
    .map(String)
    .join(' ')
    .toUpperCase();
}

function includesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword.toUpperCase()));
}
