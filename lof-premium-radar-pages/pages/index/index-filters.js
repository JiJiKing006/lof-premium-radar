const DEFAULT_PURCHASE_STATUS_FILTERS = ['OPEN', 'LIMITED'];
const DEFAULT_REDEMPTION_FILTER = 'ALL';
const DEFAULT_TURNOVER_MIN_WAN = '500';
const WATCH_SECTION = 'WATCH';
const PAGE_SIZE = 30;
const FULL_FILTER_PAGE_SIZE = 500;

function buildDraftState(state, overrides = {}) {
  const purchaseStatusFilters = normalizePurchaseStatusFilters(state.purchaseStatusFilters);
  return Object.assign({
    draftPurchaseStatusFilters: purchaseStatusFilters,
    draftPurchaseStatusMap: purchaseStatusMap(purchaseStatusFilters),
    draftRedemptionFilter: state.redemptionFilter || DEFAULT_REDEMPTION_FILTER,
    draftTurnoverMin: state.turnoverMin === undefined ? DEFAULT_TURNOVER_MIN_WAN : state.turnoverMin
  }, overrides);
}

function buildAppliedFilterPatch(state) {
  return {
    excludePausedPurchase: false,
    purchaseStatusFilters: normalizePurchaseStatusFilters(state.draftPurchaseStatusFilters),
    redemptionFilter: state.draftRedemptionFilter || DEFAULT_REDEMPTION_FILTER,
    turnoverMin: String(state.draftTurnoverMin || '').trim()
  };
}

function validateDraftFilters(state) {
  const turnoverMin = normalizeRangeText(state.draftTurnoverMin);
  if (turnoverMin !== null && turnoverMin < 0) return '成交额不能小于0万元';
  return '';
}

function normalizeRangeText(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function hasAdvancedFilters(state) {
  return countActiveFilters(state) > 0;
}

function countActiveFilters(state) {
  let count = 0;
  if (normalizePurchaseStatusFilters(state.purchaseStatusFilters).length) count += 1;
  if ((state.redemptionFilter || DEFAULT_REDEMPTION_FILTER) !== DEFAULT_REDEMPTION_FILTER) count += 1;
  if (String(state.turnoverMin || '').trim()) count += 1;
  return count;
}

function filterStateForSection(section, rememberedState) {
  const defaults = section === WATCH_SECTION
    ? {
        purchaseStatusFilters: [],
        redemptionFilter: DEFAULT_REDEMPTION_FILTER,
        turnoverMin: ''
      }
    : {
        purchaseStatusFilters: DEFAULT_PURCHASE_STATUS_FILTERS.slice(),
        redemptionFilter: DEFAULT_REDEMPTION_FILTER,
        turnoverMin: DEFAULT_TURNOVER_MIN_WAN
      };
  if (!rememberedState) return defaults;
  return {
    purchaseStatusFilters: Array.isArray(rememberedState.purchaseStatusFilters)
      ? normalizePurchaseStatusFilters(rememberedState.purchaseStatusFilters)
      : defaults.purchaseStatusFilters,
    redemptionFilter: rememberedState.redemptionFilter || defaults.redemptionFilter,
    turnoverMin: rememberedState.turnoverMin === undefined
      ? defaults.turnoverMin
      : rememberedState.turnoverMin
  };
}

function normalizePurchaseStatusFilters(filters) {
  if (!Array.isArray(filters)) return DEFAULT_PURCHASE_STATUS_FILTERS.slice();
  return filters.filter((key, index, list) =>
    key !== 'ALL' && ['PAUSED', 'OPEN', 'LIMITED'].includes(key) && list.indexOf(key) === index
  );
}

function purchaseStatusMap(filters) {
  return normalizePurchaseStatusFilters(filters).reduce((result, key) => {
    result[key] = true;
    return result;
  }, {});
}

function effectivePageSize(state, section) {
  if (section === WATCH_SECTION) return PAGE_SIZE;
  return hasAdvancedFilters(state) ? FULL_FILTER_PAGE_SIZE : PAGE_SIZE;
}

module.exports = {
  DEFAULT_PURCHASE_STATUS_FILTERS,
  DEFAULT_REDEMPTION_FILTER,
  DEFAULT_TURNOVER_MIN_WAN,
  buildDraftState,
  buildAppliedFilterPatch,
  validateDraftFilters,
  hasAdvancedFilters,
  countActiveFilters,
  filterStateForSection,
  normalizePurchaseStatusFilters,
  purchaseStatusMap,
  effectivePageSize
};
