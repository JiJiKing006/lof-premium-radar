const { requestJson, postJson } = require('./request');
const { normalizeFund, normalizeMeta, mergeStablePurchaseStatuses } = require('./fund-normalizer');

async function fetchFundsSnapshot(options = {}) {
  const params = {
    t: String(Date.now())
  };
  const section = String(options.section || '').toUpperCase();
  if (section && section !== 'HOME' && section !== 'ALL') params.category = section;
  if (options.force) params.force = '1';
  if (options.includeTrends === false) params.trends = '0';
  if (options.fields) params.fields = String(options.fields);
  if (options.page) params.page = String(options.page);
  if (options.pageSize) params.pageSize = String(options.pageSize);
  if (options.query) params.query = String(options.query);
  if (options.marketFilter && options.marketFilter !== 'ALL') params.marketFilter = String(options.marketFilter);
  if (options.excludePausedPurchase) params.excludePausedPurchase = '1';
  if (options.sortKey) params.sortKey = String(options.sortKey);
  if (options.sortDirection) params.sortDirection = String(options.sortDirection);
  if (options.snapshotId) params.snapshotId = String(options.snapshotId);
  const endpoint = options.requestMode === 'page'
    ? '/api/funds/quotes/page'
    : options.requestMode === 'refresh'
      ? '/api/funds/quotes/refresh'
      : '/api/funds/quotes';
  const raw = await postJson(endpoint, params, {
    timeoutMs: options.timeoutMs,
    timeoutMessage: options.timeoutMessage,
    showLoading: options.showLoading
  });
  const meta = normalizeMeta(raw.meta || {}, section || 'HOME');
  const rows = (raw.rows || []).map((row) => normalizeFund(row, meta));
  return { meta, rows };
}

async function fetchFundDetail(code, options = {}) {
  const params = { t: String(Date.now()) };
  if (options.force) params.force = '1';
  const section = String(options.section || '').toUpperCase();
  if (['LOF', 'QDII', 'ETF'].includes(section)) params.category = section;
  const row = await requestJson(`/api/funds/${code}`, params, {
    timeoutMs: 60000,
    timeoutMessage: '详情数据源暂时无响应',
    showLoading: options.showLoading
  });
  const meta = normalizeMeta({ sourceProvider: row.source, updateTime: row.updateTime }, row.category || options.section || '');
  return normalizeFund(row, meta);
}

async function fetchFundHistory(code, options = {}) {
  const params = { t: String(Date.now()), limit: String(options.limit || 60) };
  if (options.force) params.force = '1';
  return requestJson(`/api/funds/${code}/history`, params, { showLoading: options.showLoading });
}

module.exports = {
  fetchFundsSnapshot,
  fetchFundDetail,
  fetchFundHistory,
  normalizeFund,
  normalizeMeta,
  mergeStablePurchaseStatuses
};
