import { load } from 'cheerio';
import { normalizeText, parseNumber, percentValue } from '../utils/number.js';
import { sources } from '../config/sources.js';

const LIST_COLUMNS = [
  'code',
  'purchaseLimit',
  'price',
  'change',
  'quoteDate',
  'quoteTime',
  'name',
  'officialEst',
  'estDate',
  'officialPremium',
  'referenceEst',
  'referencePremium',
  'realtimeEst',
  'realtimePremium',
];

export async function fetchLofSnapshot({ signal } = {}) {
  const source = sources.lof;
  const response = await fetch(source.url, {
    signal,
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.7',
      'user-agent': 'LOF-Premium-Radar/0.1 (+server-side-cache)',
    },
  });

  if (response.status === 429) {
    const retryAfter = Number.parseInt(response.headers.get('retry-after') || '', 10);
    const error = new Error('源站限流，继续使用缓存数据');
    error.retryAfterMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 60 * 60 * 1000;
    error.status = 429;
    throw error;
  }

  if (!response.ok) {
    const error = new Error(`源站返回 ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const html = await response.text();
  return parseLofHtml(html, source.url);
}

export function parseLofHtml(html, sourceUrl) {
  const $ = load(html);
  const title = normalizeText($('title').first().text()) || 'LOF基金';
  const table = findListTable($);
  const referenceMap = parseReferenceMap($);
  const isEstimationTable = isEstimationTableElement($, table);
  const rows = [];

  table.find('tr').each((index, element) => {
    const cells = $(element)
      .children('td')
      .map((_, cell) => normalizeText($(cell).text()))
      .get();

    if (!cells.length || cells[0] === '代码') return;
    const row = isEstimationTable
      ? mapEstimationRow($, element, cells, index, referenceMap)
      : mapListRow($, element, cells, index);
    if (row?.code && row?.name) rows.push(row);
  });

  if (!rows.length) {
    throw new Error('源站页面未解析到 LOF 表格');
  }

  return normalizeSnapshot({
    sourceId: 'lof',
    sourceTitle: title,
    sourceUrl,
    scrapedAt: new Date().toISOString(),
    rowCount: rows.length,
    rows,
  });
}

export function normalizeSnapshot(snapshot) {
  const rows = (snapshot.rows || []).map((row, index) => normalizeRow(row, index));
  return {
    sourceId: snapshot.sourceId || 'lof',
    sourceTitle: snapshot.sourceTitle || 'LOF基金',
    scrapedAt: snapshot.scrapedAt || new Date().toISOString(),
    rowCount: rows.length,
    rows,
  };
}

function findListTable($) {
  const estimationTable = $('#estimationtable').first();
  if (estimationTable.length) return estimationTable;

  const headerMatched = $('table')
    .filter((_, table) => {
      if ($(table).attr('id') === 'referencetable') return false;
      const headers = $(table).find('th').map((__, th) => normalizeText($(th).text())).get();
      return headers.includes('官方EST') && headers.includes('参考EST');
    })
    .last();
  if (headerMatched.length) return headerMatched;

  let best = $('table').first();
  let bestScore = -1;

  $('table').each((_, table) => {
    if ($(table).attr('id') === 'referencetable') return;
    const text = normalizeText($(table).text());
    const score = ['代码', '价格', '日期', '实时', '溢价'].reduce(
      (total, keyword) => total + (text.includes(keyword) ? 1 : 0),
      0,
    );
    if (score > bestScore) {
      best = $(table);
      bestScore = score;
    }
  });

  return best;
}

function isEstimationTableElement($, table) {
  const headers = table.find('th').map((_, th) => normalizeText($(th).text())).get();
  return table.attr('id') === 'estimationtable'
    || (headers.includes('官方EST') && headers.includes('参考EST'));
}

function parseReferenceMap($) {
  const rows = new Map();
  $('#referencetable tr').slice(1).each((_, tr) => {
    const cells = $(tr).children('td').map((__, td) => normalizeText($(td).text())).get();
    const code = normalizeCode(cells[0]);
    if (!code) return;
    rows.set(code, {
      code,
      price: cells[1] || '',
      change: cells[2] || '',
      quoteDate: cells[3] || '',
      quoteTime: cells[4] || '',
      name: cells[5] || code,
    });
  });
  return rows;
}

function mapListRow($, rowElement, cells, rank) {
  const data = {};
  LIST_COLUMNS.forEach((key, index) => {
    data[key] = cells[index] || '';
  });

  const firstLink = $(rowElement).find('a[href]').first();
  const href = firstLink.attr('href');
  const normalizedCode = normalizeCode(data.code);

  return {
    rank,
    code: normalizedCode,
    name: data.name || firstLink.text() || normalizedCode,
    href: href ? new URL(href, sources.lof.url).toString() : '',
    purchaseLimit: parsePurchaseLimit(data.purchaseLimit),
    price: data.price,
    priceValue: parseNumber(data.price),
    change: data.change,
    changeValue: percentValue(data.change),
    quoteDate: data.quoteDate,
    quoteTime: data.quoteTime,
    officialEst: data.officialEst,
    officialEstValue: parseNumber(data.officialEst),
    estDate: data.estDate,
    officialPremium: data.officialPremium,
    officialPremiumValue: percentValue(data.officialPremium),
    referenceEst: data.referenceEst,
    referenceEstValue: parseNumber(data.referenceEst),
    referencePremium: data.referencePremium,
    referencePremiumValue: percentValue(data.referencePremium),
    realtimeEst: data.realtimeEst,
    realtimeEstValue: parseNumber(data.realtimeEst),
    realtimePremium: data.realtimePremium,
    realtimePremiumValue: percentValue(data.realtimePremium),
  };
}

function mapEstimationRow($, rowElement, cells, rank, referenceMap) {
  const firstLink = $(rowElement).find('a[href]').first();
  const href = firstLink.attr('href');
  const normalizedCode = normalizeCode(cells[0]);
  const reference = referenceMap.get(normalizedCode) || {};
  const name = reference.name || firstLink.text() || normalizedCode;
  if (!normalizedCode || !name) return null;

  return {
    rank,
    code: normalizedCode,
    name,
    href: href ? new URL(href, sources.lof.url).toString() : '',
    purchaseLimit: null,
    price: reference.price || '',
    priceValue: parseNumber(reference.price),
    change: reference.change || '',
    changeValue: percentValue(reference.change),
    quoteDate: reference.quoteDate || '',
    quoteTime: reference.quoteTime || '',
    officialEst: cells[1] || '',
    officialEstValue: parseNumber(cells[1]),
    estDate: cells[2] || '',
    officialPremium: cells[3] || '',
    officialPremiumValue: percentValue(cells[3]),
    referenceEst: cells[4] || '',
    referenceEstValue: parseNumber(cells[4]),
    referencePremium: cells[5] || '',
    referencePremiumValue: percentValue(cells[5]),
    realtimeEst: cells[6] || '',
    realtimeEstValue: parseNumber(cells[6]),
    realtimePremium: cells[7] || '',
    realtimePremiumValue: percentValue(cells[7]),
  };
}

function normalizeRow(row, index) {
  return {
    ...row,
    rank: row.rank || index + 1,
    code: normalizeCode(row.code),
    purchaseLimit: normalizePurchaseLimit(row.purchaseLimit),
    priceValue: row.priceValue ?? parseNumber(row.price),
    changeValue: row.changeValue ?? percentValue(row.change),
    officialEstValue: row.officialEstValue ?? parseNumber(row.officialEst),
    officialPremiumValue: row.officialPremiumValue ?? percentValue(row.officialPremium),
    referenceEstValue: row.referenceEstValue ?? parseNumber(row.referenceEst),
    referencePremiumValue: row.referencePremiumValue ?? percentValue(row.referencePremium),
    realtimeEstValue: row.realtimeEstValue ?? parseNumber(row.realtimeEst),
    realtimePremiumValue: row.realtimePremiumValue ?? percentValue(row.realtimePremium),
  };
}

function normalizeCode(code) {
  const value = normalizeText(code).toUpperCase();
  if (/^(SZ|SH)\d{6}$/.test(value)) return value;
  if (/^\d{6}$/.test(value)) return `SZ${value}`;
  return value;
}

function parsePurchaseLimit(text) {
  const value = normalizeText(text);
  if (!value) return null;
  return {
    status: value,
    limitText: value,
    limited: /限|停|暂停/.test(value),
    source: '源站列表',
  };
}

function normalizePurchaseLimit(value) {
  if (!value) return null;
  if (typeof value === 'string') return parsePurchaseLimit(value);
  return value;
}
