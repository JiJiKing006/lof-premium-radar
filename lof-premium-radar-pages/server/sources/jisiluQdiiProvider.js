import { sources } from '../config/sources.js';
import { parseNumber } from '../utils/number.js';
import { formatShanghaiTime } from '../services/sourceHealth.js';

const MARKET_NAMES = {
  europe: '欧美市场',
  asia: '亚洲市场',
  commodity: '商品市场',
};

export async function fetchJisiluQdiiSnapshot({ section = 'qdii', signal } = {}) {
  const markets = section === 'nasdaq100' ? ['europe'] : ['europe', 'asia', 'commodity'];
  const payloads = await Promise.all(markets.map((market) => fetchMarket(market, signal)));
  let rows = payloads.flatMap((payload) => payload.rows);

  if (section === 'nasdaq100') {
    rows = rows.filter((row) => /纳斯达克|纳指|NASDAQ|Nasdaq/i.test(`${row.name} ${row.indexName}`));
  }

  const warn = payloads.map((payload) => payload.warn).filter(Boolean).join('；');

  return {
    sourceId: section,
    sourceTitle: section === 'nasdaq100' ? '纳斯达克100' : 'QDII基金',
    sourceProvider: 'jisilu',
    scrapedAt: new Date().toISOString(),
    rowCount: rows.length,
    allCount: payloads.reduce((total, payload) => total + (payload.all || 0), 0),
    warn,
    rows: rows.map((row, index) => ({ ...row, rank: index + 1 })),
  };
}

async function fetchMarket(market, signal) {
  const url = sources.qdii.endpoints[market];
  const response = await fetch(`${url}?___jsl=LST___t=${Date.now()}`, {
    signal,
    headers: {
      accept: 'application/json,text/javascript,*/*;q=0.01',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.7',
      referer: 'https://www.jisilu.cn/data/qdii/',
      'user-agent': 'Mozilla/5.0 LOF-Premium-Radar/0.1',
      'x-requested-with': 'XMLHttpRequest',
    },
  });

  if (!response.ok) {
    const error = new Error(`集思录 ${MARKET_NAMES[market]} 返回 ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const json = await response.json();
  return {
    all: Number(json.all || json.total || 0),
    warn: json.warn || '',
    rows: (json.rows || []).map((item) => normalizeJisiluRow(item.cell || item, market)),
  };
}

function normalizeJisiluRow(cell, market) {
  const premium = pickPremium(cell);
  const quoteDate = cell.price_dt || cell.last_est_dt || '';
  const quoteTime = normalizeQuoteTime(quoteDate, cell.last_time || cell.last_est_time || '');
  const apply = normalizeApplyStatus(cell.apply_status, cell.min_amt, formatShanghaiTime());
  const estimatedNav = parseNumber(cell.estimate_value2 !== '-' ? cell.estimate_value2 : cell.estimate_value);

  return {
    section: 'qdii',
    market,
    marketName: MARKET_NAMES[market],
    code: String(cell.fund_id || ''),
    name: cell.fund_nm || cell.fund_nm_color || '',
    category: 'QDII',
    issuer: cell.issuer_nm || '',
    indexName: cell.index_nm || '',
    fundType: cell.lof_type || '',
    price: safeText(cell.price),
    priceValue: parseNumber(cell.price),
    marketPrice: parseNumber(cell.price),
    change: withPercent(cell.increase_rt),
    changeValue: parseNumber(cell.increase_rt),
    changeRate: parseNumber(cell.increase_rt),
    quoteDate,
    quoteTime,
    realtimeEst: safeText(cell.estimate_value2 !== '-' ? cell.estimate_value2 : cell.estimate_value),
    realtimeEstValue: parseNumber(cell.estimate_value2 !== '-' ? cell.estimate_value2 : cell.estimate_value),
    estimatedNav,
    estimatedNavSource: 'jisilu',
    estimatedNavTime: estimatedNav !== null ? quoteTime : '',
    realtimePremium: premium.text,
    realtimePremiumValue: premium.value,
    premiumRate: premium.value,
    premiumBasis: premium.basis,
    officialEst: safeText(cell.fund_nav),
    officialEstValue: parseNumber(cell.fund_nav),
    lastNav: parseNumber(cell.fund_nav),
    estDate: cell.nav_dt || '',
    navDate: cell.nav_dt || '',
    navSource: 'jisilu',
    navQuoteTime: quoteTime,
    officialPremium: withPercent(cell.nav_discount_rt),
    officialPremiumValue: parseNumber(cell.nav_discount_rt),
    referenceEst: safeText(cell.ref_price),
    referenceEstValue: parseNumber(cell.ref_price),
    referencePremium: withPercent(cell.ref_increase_rt),
    referencePremiumValue: parseNumber(cell.ref_increase_rt),
    volume: safeText(cell.volume),
    amount: safeText(cell.amount),
    turnover: parseNumber(cell.amount),
    amountChange: safeText(cell.amount_incr),
    purchaseLimit: apply,
    redeemStatus: cell.redeem_status || '',
    source: 'jisilu',
    sourceStatus: 'primary',
  };
}

function normalizeQuoteTime(date, time) {
  const safeDate = String(date || '').trim();
  const safeTime = String(time || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(safeDate) && /^\d{2}:\d{2}(:\d{2})?$/.test(safeTime)) {
    return `${safeDate} ${safeTime.length === 5 ? `${safeTime}:00` : safeTime}`;
  }
  return '';
}

function pickPremium(cell) {
  if (cell.discount_rt2 && cell.discount_rt2 !== '-') {
    return { text: withPercent(cell.discount_rt2), value: parseNumber(cell.discount_rt2), basis: '实时估值' };
  }
  if (cell.discount_rt && cell.discount_rt !== '-') {
    return { text: withPercent(cell.discount_rt), value: parseNumber(cell.discount_rt), basis: '估值' };
  }
  return { text: withPercent(cell.nav_discount_rt), value: parseNumber(cell.nav_discount_rt), basis: '净值' };
}

function normalizeApplyStatus(status, minAmount, updateTime) {
  const value = safeText(status);
  let label = value || '-';
  let state = 'unknown';

  if (/暂停/.test(value)) {
    label = '暂停申购';
    state = 'paused';
  } else if (/限/.test(value)) {
    label = value;
    state = 'limited';
  } else if (/开放/.test(value)) {
    label = minAmount ? `开放申购 / ${minAmount}` : '开放申购';
    state = 'open';
  }

  return {
    status: value,
    limitText: label,
    limited: state === 'limited',
    state,
    minBuy: minAmount ? String(minAmount) : '',
    source: '集思录申购状态',
    updateTime,
  };
}

function withPercent(value) {
  const text = safeText(value);
  if (!text || text === '-') return text;
  return text.includes('%') ? text : `${text}%`;
}

function safeText(value) {
  if (value === null || value === undefined || value === '') return '';
  return String(value);
}
