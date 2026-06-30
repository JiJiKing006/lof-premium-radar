function appendUniqueFunds(existing, incoming) {
  const rows = Array.isArray(existing) ? existing.slice() : [];
  const seen = new Set(rows.map((fund) => fund.code));
  (Array.isArray(incoming) ? incoming : []).forEach((fund) => {
    if (!fund || !fund.code || seen.has(fund.code)) return;
    rows.push(fund);
    seen.add(fund.code);
  });
  return rows;
}

function visibleFundsForPage(filteredFunds, visiblePage, pageSize) {
  const rows = Array.isArray(filteredFunds) ? filteredFunds : [];
  return rows.slice(0, Math.max(pageSize, (visiblePage || 1) * pageSize));
}

function buildRememberedSectionState({ funds, data, visiblePage, filteredFunds }) {
  return {
    funds,
    meta: data.meta,
    query: data.query,
    marketFilter: data.marketFilter,
    excludePausedPurchase: data.excludePausedPurchase,
    purchaseStatusFilters: data.purchaseStatusFilters,
    redemptionFilter: data.redemptionFilter,
    turnoverMin: data.turnoverMin,
    sortKey: data.sortKey,
    sortDirection: data.sortDirection,
    visiblePage: visiblePage || 1,
    lastSuccessAt: data.lastSuccessAt,
    abnormalCount: data.abnormalCount,
    filteredFunds: filteredFunds || []
  };
}

module.exports = { appendUniqueFunds, visibleFundsForPage, buildRememberedSectionState };
