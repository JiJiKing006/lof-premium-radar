import { isEstimateCurrentForQuote } from './premiumService.js';

const HOME_LIST_FIELDS = [
  'code',
  'fundCode',
  'name',
  'fundName',
  'category',
  'fundType',
  'marketPrice',
  'price',
  'changeRate',
  'lastNav',
  'nav',
  'navDate',
  'navQuoteTime',
  'estimatedNav',
  'premiumRate',
  'realtimePremiumRate',
  'officialPremiumRate',
  'officialDiscountRate',
  'discountRate',
  'premiumBasis',
  'premiumNote',
  'estimatedNavSource',
  'estimatedNavTime',
  'estimateConfidence',
  'estimateDeviationRate',
  'estimateWarning',
  'volume',
  'turnover',
  'purchaseLimit',
  'source',
  'quoteSource',
  'subscriptionSource',
  'subscriptionTime',
  'navSource',
  'sourceStatus',
  'dataStatus',
  'quoteTime',
  'updateTime',
  'isRealtime',
  'isAbnormal',
  'abnormalReason',
  'market',
  'marketRegion',
  'settlementCycle',
  'settlementRuleSource',
  'showEstimatedNav',
  'snapshotCarriedForward',
  'valuationCarriedForward',
  'carriedForwardFields',
  'purchaseStatusCarriedForward',
];

export function filterRenderablePremiumRows(rows, category = '') {
  const normalizedCategory = String(category || '').toUpperCase();
  return rows.filter((row) => {
    if (['LOF', 'QDII', 'ETF'].includes(normalizedCategory) && row.category !== normalizedCategory) return false;
    if (!normalizedCategory) return Number.isFinite(row.premiumRate);
    return Boolean(normalizeFundCode(row.code || row.fundCode));
  });
}

export function filterDisplayRows(rows, normalizedCategory) {
  return filterRenderablePremiumRows(
    normalizedCategory === 'ALL' ? rows : rows.filter((row) => row.category === normalizedCategory),
    normalizedCategory,
  );
}

export function formatFundQuoteResponse(snapshot, options = {}, rememberPageSnapshot = () => '') {
  const sourceRows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  const filteredRows = applyListQuery(sourceRows, options);
  const sortedRows = sortListRows(filteredRows, options.sortKey, options.sortDirection);
  const pagination = paginateRows(sortedRows, options);
  const rows = shouldUseHomeFields(options)
    ? pagination.rows.map(projectHomeListRow)
    : pagination.rows;
  const snapshotId = shouldUseHomeFields(options) ? rememberPageSnapshot(snapshot) : '';

  return {
    meta: {
      ...(snapshot.meta || {}),
      rowCount: rows.length,
      filteredCount: sortedRows.length,
      totalCount: sortedRows.length,
      allCount: snapshot?.meta?.allCount ?? sourceRows.length,
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: sortedRows.length,
        totalPages: pagination.totalPages,
        hasMore: pagination.hasMore,
        snapshotId,
        snapshotReset: Boolean(options.snapshotReset),
      },
    },
    rows,
  };
}

function applyListQuery(rows, options = {}) {
  const keyword = String(options.query || '').trim().toLowerCase();
  const marketFilter = String(options.marketFilter || '').toUpperCase().replace(/\s/g, '');
  const excludePausedPurchase = options.excludePausedPurchase === true || String(options.excludePausedPurchase || '') === '1';
  const homePremiumList = shouldUseHomeFields(options);
  return rows.filter((row) => {
    if (keyword) {
      const text = [row.code, row.fundCode, row.name, row.fundName, row.market, row.indexName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!text.includes(keyword)) return false;
    }
    if ((marketFilter === 'T+2' || marketFilter === 'T+3') && row.settlementCycle !== marketFilter) return false;
    if (excludePausedPurchase && isPausedPurchase(row)) return false;
    if (homePremiumList && !isHomeLofRow(row)) return false;
    if (homePremiumList && !hasCompletePremiumDisplaySet(row)) return false;
    return true;
  });
}

function sortListRows(rows, sortKey = 'premiumRate', sortDirection = 'desc') {
  const direction = String(sortDirection || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  const key = normalizeSortKey(sortKey);
  return rows.slice().sort((left, right) => {
    const leftValue = sortValue(left, key);
    const rightValue = sortValue(right, key);
    if (leftValue === null && rightValue !== null) return 1;
    if (leftValue !== null && rightValue === null) return -1;
    const delta = leftValue === null ? 0 : leftValue - rightValue;
    if (delta !== 0) return delta * direction;
    return String(left.code || '').localeCompare(String(right.code || ''));
  });
}

function normalizeSortKey(key) {
  const text = String(key || 'premiumRate');
  if (['premiumRate', 'price', 'marketPrice', 'changeRate', 'lastNav', 'nav', 'estimatedNav', 'turnover', 'volume'].includes(text)) return text;
  return 'premiumRate';
}

function sortValue(row, key) {
  const value = key === 'price' ? row.marketPrice
    : key === 'nav' ? row.lastNav
      : row[key];
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isPausedPurchase(row) {
  const limit = row.purchaseLimit || {};
  const text = String([limit.state, limit.label, limit.limitText, row.subscriptionStatus].filter(Boolean).join(' '));
  return /paused|暂停申购|停止申购/.test(text);
}

export function isHomeLofRow(row) {
  const category = String(row.category || row.fundType || '').toUpperCase();
  const limit = row.purchaseLimit || {};
  const text = String([limit.state, limit.label, limit.limitText, row.subscriptionStatus].filter(Boolean).join(' '));
  return category === 'LOF' && !/exchange|场内交易/i.test(text);
}

export function hasCompletePremiumDisplaySet(row) {
  const price = Number(row.marketPrice ?? row.price);
  const nav = Number(row.lastNav ?? row.nav);
  const estimatedNav = Number(row.estimatedNav);
  return Number.isFinite(price) && price > 0
    && Number.isFinite(nav) && nav > 0
    && Number.isFinite(estimatedNav) && estimatedNav > 0
    && hasCurrentEstimate(row)
    && hasFiniteNumericValue(row.premiumRate);
}

function hasFiniteNumericValue(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

export function hasCurrentEstimate(row, now = new Date()) {
  const time = String(row?.estimatedNavTime || row?.iopvTime || '').trim();
  return isEstimateCurrentForQuote(time, { now, quoteTime: row?.quoteTime || '' });
}

function paginateRows(rows, options = {}) {
  const hasPaging = options.page !== undefined || options.pageSize !== undefined || shouldUseHomeFields(options);
  if (!hasPaging) {
    return { rows, page: 1, pageSize: rows.length || 0, totalPages: 1, hasMore: false };
  }
  const pageSize = clampInteger(options.pageSize, 30, 1, 100);
  const page = clampInteger(options.page, 1, 1, 10000);
  const start = (page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  return { rows: pageRows, page, pageSize, totalPages, hasMore: page < totalPages };
}

function shouldUseHomeFields(options = {}) {
  const fields = String(options.fields || '').toLowerCase();
  return fields === 'home' || fields === 'list' || fields === 'slim';
}

function projectHomeListRow(row) {
  return HOME_LIST_FIELDS.reduce((result, key) => {
    if (row[key] !== undefined) result[key] = row[key];
    return result;
  }, {});
}

function clampInteger(value, fallback, min, max) {
  const number = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeFundCode(code) {
  return String(code || '').replace(/^(SH|SZ)/i, '');
}
