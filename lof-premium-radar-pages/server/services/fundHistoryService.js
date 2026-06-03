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

  const sourceProvider = priceSnapshot.sourceProvider || historySourceProvider(priceSnapshot.source);
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

function historySourceProvider(priceSource) {
  if (priceSource === 'sohu-kline') return 'eastmoney,sohu';
  if (priceSource === 'sina-kline') return 'eastmoney,sina';
  return 'eastmoney';
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
  if (eastmoneyRows.length) {
    const sohuRows = needsPriceFieldSupplement(eastmoneyRows) ? await fetchSohuPriceHistory(code, { limit }) : [];
    if (sohuRows.length) {
      return {
        source: 'eastmoney-kline',
        sourceProvider: 'eastmoney,sohu',
        rows: mergePriceHistoryRows(eastmoneyRows, sohuRows),
      };
    }
    return { source: 'eastmoney-kline', rows: eastmoneyRows };
  }

  const sohuRows = await fetchSohuPriceHistory(code, { limit });
  if (sohuRows.length) return { source: 'sohu-kline', sourceProvider: 'eastmoney,sohu', rows: sohuRows };

  const sinaRows = await fetchSinaPriceHistory(code, { limit });
  if (sinaRows.length) return { source: 'sina-kline', sourceProvider: 'eastmoney,sina', rows: sinaRows };

  return { source: '', rows: [] };
}

function needsPriceFieldSupplement(rows) {
  return rows.some((row) => row.changeRate === null || row.changeRate === undefined || row.turnover === null || row.turnover === undefined);
}

function mergePriceHistoryRows(primaryRows, supplementRows) {
  const supplementByDate = new Map(supplementRows.map((row) => [row.date, row]));
  return primaryRows.map((row) => {
    const supplement = supplementByDate.get(row.date);
    if (!supplement) return row;
    return {
      ...row,
      changeRate: row.changeRate ?? supplement.changeRate ?? null,
      turnover: row.turnover ?? supplement.turnover ?? null,
      volume: row.volume ?? supplement.volume ?? null,
      open: row.open ?? supplement.open ?? null,
      close: row.close ?? supplement.close ?? null,
      high: row.high ?? supplement.high ?? null,
      low: row.low ?? supplement.low ?? null,
    };
  });
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
    attachCloseChangeRates(rows);
    if (!rows.length) throw new Error('新浪历史价格为空或字段变更');
    recordSourceSuccess('sina-history-price', Date.now() - startedAt);
    return rows;
  } catch (error) {
    recordSourceFailure('sina-history-price', error, Date.now() - startedAt);
    return [];
  }
}

async function fetchSohuPriceHistory(code, { limit }) {
  const startedAt = Date.now();
  try {
    const url = new URL('https://q.stock.sohu.com/hisHq');
    url.searchParams.set('code', `cn_${normalizeCode(code)}`);
    url.searchParams.set('start', '19900101');
    url.searchParams.set('end', '20500101');
    url.searchParams.set('stat', '1');
    url.searchParams.set('order', 'D');
    url.searchParams.set('period', 'd');
    url.searchParams.set('callback', 'historySearchHandler');
    url.searchParams.set('rt', 'jsonp');
    const response = await fetchWithRetry(url, {
      signal: AbortSignal.timeout(12_000),
      headers: {
        accept: 'application/javascript,text/javascript,*/*',
        referer: 'https://q.stock.sohu.com/',
        'user-agent': 'Mozilla/5.0 LOF-Premium-Radar/0.1',
      },
    }, 4);
    if (!response.ok) throw new Error(`搜狐历史价格返回 ${response.status}`);
    const rows = parseSohuHistoryResponse(await response.text())
      .slice(0, Math.min(Math.max(limit, 20), 120));
    if (!rows.length) throw new Error('搜狐历史价格为空或字段变更');
    recordSourceSuccess('sohu-history-price', Date.now() - startedAt);
    return rows;
  } catch (error) {
    recordSourceFailure('sohu-history-price', error, Date.now() - startedAt);
    return [];
  }
}

export function parseSohuHistoryResponse(text) {
  const match = String(text || '').match(/historySearchHandler\(([\s\S]*)\)\s*;?$/);
  if (!match) return [];
  const payload = JSON.parse(match[1]);
  const item = Array.isArray(payload) ? payload[0] : null;
  return (item?.hq || [])
    .map((cells) => ({
      date: clean(cells[0]),
      open: toNumber(cells[1]),
      close: toNumber(cells[2]),
      high: toNumber(cells[6]),
      low: toNumber(cells[5]),
      volume: toNumber(cells[7]),
      turnover: toNumber(cells[8]) !== null ? toNumber(cells[8]) * 10_000 : null,
      changeRate: toNumber(cells[4]),
    }))
    .filter((row) => row.date)
    .sort((left, right) => String(right.date).localeCompare(String(left.date)));
}

function attachCloseChangeRates(rows) {
  rows.sort((left, right) => String(left.date).localeCompare(String(right.date)));
  for (let index = 1; index < rows.length; index += 1) {
    const previousClose = rows[index - 1].close;
    const close = rows[index].close;
    if (!Number.isFinite(previousClose) || previousClose <= 0 || !Number.isFinite(close)) continue;
    rows[index].changeRate = ((close / previousClose) - 1) * 100;
  }
}

async function fetchWithRetry(url, options, attempts) {
  let lastResponse = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, options);
    if (response.ok || !isRetryableStatus(response.status) || attempt === attempts) return response;
    lastResponse = response;
    await delay(150 * attempt);
  }
  return lastResponse;
}

function isRetryableStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
