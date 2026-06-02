import { load } from 'cheerio';
import { cache, cacheTtl } from './cacheService.js';
import { normalizeCode, toNumber } from './fundNormalizer.js';
import { recordSourceFailure, recordSourceSuccess } from './sourceHealth.js';

export async function getFundHistory(code, { limit = 60, force = false } = {}) {
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) return { meta: { status: '基金代码为空' }, rows: [] };
  const cacheKey = `fund-history:${normalizedCode}:${limit}`;
  if (!force) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  const [navRows, priceSnapshot] = await Promise.all([
    fetchNavHistory(normalizedCode, { limit, force }),
    fetchPriceHistory(normalizedCode, { limit, force }),
  ]);
  const priceRows = priceSnapshot.rows;
  const priceMap = new Map(priceRows.map((row) => [row.date, row]));
  const rows = navRows.map((nav) => {
    const price = priceMap.get(nav.date);
    const close = price?.close ?? null;
    const premiumRate = calculateHistoricalPremium({ close, unitNav: nav.unitNav });
    return {
      date: nav.date,
      unitNav: nav.unitNav,
      accumulatedNav: nav.accumulatedNav,
      navGrowthRate: nav.navGrowthRate,
      closePrice: price?.close ?? null,
      openPrice: price?.open ?? null,
      highPrice: price?.high ?? null,
      lowPrice: price?.low ?? null,
      changeRate: price?.changeRate ?? null,
      volume: price?.volume ?? null,
      turnover: price?.turnover ?? null,
      premiumRate,
      purchaseStatus: nav.purchaseStatus,
      redemptionStatus: nav.redemptionStatus,
      navSource: 'eastmoney-f10',
      priceSource: price ? priceSnapshot.source : '',
    };
  });

  const sourceProvider = priceSnapshot.source === 'sina-kline' ? 'eastmoney,sina' : 'eastmoney';
  const payload = {
    meta: {
      code: normalizedCode,
      rowCount: rows.length,
      navCount: navRows.length,
      priceCount: priceRows.length,
      sourceProvider,
      priceSource: priceSnapshot.source,
      status: 'ok',
    },
    rows,
  };
  return cache.set(cacheKey, payload, cacheTtl.history);
}

export function calculateHistoricalPremium({ close, unitNav }) {
  if (!Number.isFinite(close) || !Number.isFinite(unitNav) || unitNav <= 0) return null;
  const ratio = close / unitNav;
  if (ratio < 0.2 || ratio > 5) return null;
  return (ratio - 1) * 100;
}

async function fetchNavHistory(code, { limit }) {
  const startedAt = Date.now();
  try {
    const url = new URL('https://fundf10.eastmoney.com/F10DataApi.aspx');
    url.searchParams.set('type', 'lsjz');
    url.searchParams.set('code', code);
    url.searchParams.set('page', '1');
    url.searchParams.set('per', String(Math.min(Math.max(limit, 20), 120)));
    url.searchParams.set('sdate', '');
    url.searchParams.set('edate', '');
    url.searchParams.set('rt', String(Date.now()));
    const response = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      headers: {
        accept: 'text/html,application/javascript,*/*',
        referer: `https://fundf10.eastmoney.com/jjjz_${code}.html`,
        'user-agent': 'Mozilla/5.0 LOF-Premium-Radar/0.1',
      },
    });
    if (!response.ok) throw new Error(`历史净值返回 ${response.status}`);
    const text = await response.text();
    const apiData = Function(`${text}; return apidata;`)();
    const $ = load(apiData.content || '');
    const rows = [];
    $('tbody tr').each((_, tr) => {
      const cells = $(tr).children('td').map((__, td) => clean($(td).text())).get();
      if (!cells[0]) return;
      rows.push({
        date: cells[0],
        unitNav: toNumber(cells[1]),
        accumulatedNav: toNumber(cells[2]),
        navGrowthRate: toNumber(cells[3]),
        purchaseStatus: cells[4] || '',
        redemptionStatus: cells[5] || '',
      });
    });
    if (!rows.length) throw new Error('历史净值为空或字段变更');
    recordSourceSuccess('eastmoney-history-nav', Date.now() - startedAt);
    return rows;
  } catch (error) {
    recordSourceFailure('eastmoney-history-nav', error, Date.now() - startedAt);
    return [];
  }
}

async function fetchPriceHistory(code, { limit }) {
  const eastmoneyRows = await fetchEastmoneyPriceHistory(code, { limit });
  if (eastmoneyRows.length) return { source: 'eastmoney-kline', rows: eastmoneyRows };

  const sinaRows = await fetchSinaPriceHistory(code, { limit });
  if (sinaRows.length) return { source: 'sina-kline', rows: sinaRows };

  return { source: '', rows: [] };
}

async function fetchEastmoneyPriceHistory(code, { limit }) {
  const startedAt = Date.now();
  try {
    const url = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get');
    url.searchParams.set('secid', secid(code));
    url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6');
    url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61');
    url.searchParams.set('klt', '101');
    url.searchParams.set('fqt', '1');
    url.searchParams.set('end', '20500101');
    url.searchParams.set('lmt', String(Math.min(Math.max(limit, 20), 120)));
    url.searchParams.set('t', String(Date.now()));
    const response = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      headers: {
        accept: 'application/json,text/plain,*/*',
        referer: 'https://quote.eastmoney.com/',
        'user-agent': 'Mozilla/5.0 LOF-Premium-Radar/0.1',
      },
    });
    if (!response.ok) throw new Error(`历史价格返回 ${response.status}`);
    const json = await response.json();
    const rows = (json.data?.klines || []).map((line) => {
      const cells = String(line).split(',');
      return {
        date: cells[0],
        open: toNumber(cells[1]),
        close: toNumber(cells[2]),
        high: toNumber(cells[3]),
        low: toNumber(cells[4]),
        volume: toNumber(cells[5]),
        turnover: toNumber(cells[6]),
        changeRate: toNumber(cells[8]),
      };
    }).filter((row) => row.date);
    if (!rows.length) throw new Error('历史价格为空或字段变更');
    recordSourceSuccess('eastmoney-history-price', Date.now() - startedAt);
    return rows;
  } catch (error) {
    recordSourceFailure('eastmoney-history-price', error, Date.now() - startedAt);
    return [];
  }
}

async function fetchSinaPriceHistory(code, { limit }) {
  const startedAt = Date.now();
  try {
    const url = new URL('https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData');
    url.searchParams.set('symbol', `${exchangePrefix(code)}${code}`);
    url.searchParams.set('scale', '240');
    url.searchParams.set('ma', 'no');
    url.searchParams.set('datalen', String(Math.min(Math.max(limit, 20), 120)));
    const response = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      headers: {
        accept: 'application/json,text/plain,*/*',
        referer: 'https://finance.sina.com.cn/',
        'user-agent': 'Mozilla/5.0 LOF-Premium-Radar/0.1',
      },
    });
    if (!response.ok) throw new Error(`新浪历史价格返回 ${response.status}`);
    const json = await response.json();
    const rows = (Array.isArray(json) ? json : []).map((row) => ({
      date: clean(row.day),
      open: toNumber(row.open),
      close: toNumber(row.close),
      high: toNumber(row.high),
      low: toNumber(row.low),
      volume: toNumber(row.volume) !== null ? toNumber(row.volume) / 100 : null,
      turnover: null,
      changeRate: null,
    })).filter((row) => row.date);
    if (!rows.length) throw new Error('新浪历史价格为空或字段变更');
    recordSourceSuccess('sina-history-price', Date.now() - startedAt);
    return rows;
  } catch (error) {
    recordSourceFailure('sina-history-price', error, Date.now() - startedAt);
    return [];
  }
}

function secid(code) {
  const normalized = normalizeCode(code);
  return `${normalized.startsWith('5') ? '1' : '0'}.${normalized}`;
}

function exchangePrefix(code) {
  return /^(5|6)/.test(normalizeCode(code)) ? 'sh' : 'sz';
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
