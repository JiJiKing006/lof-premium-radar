const { fetchFundsSnapshot, normalizeFund, mergeStablePurchaseStatuses } = require('../../utils/fund-api');
const { filterAndSortFunds } = require('../../utils/fund-filter');
const { readSnapshot, writeSnapshot } = require('../../utils/cache');

const PAGE_SIZE = 30;
const SEARCH_DEBOUNCE_MS = 160;
const WATCH_STORAGE_KEY = 'fund-watchlist';
const HOME_SECTION = 'HOME';

Page({
  data: {
    query: '',
    marketFilter: 'ALL',
    excludePausedPurchase: false,
    sortKey: 'premiumRate',
    sortDirection: 'desc',
    funds: [],
    visibleFunds: [],
    visibleTotalCount: 0,
    hasMoreFunds: false,
    meta: null,
    initialLoading: true,
    pollingError: '',
    lastSuccessAt: '',
    abnormalCount: 0,
    favoriteCodes: [],
    pulseCode: '',
    toastText: '',
    dataVersion: '',
    tableResetToken: 0,
    showTableBackTop: false,
    showEstimatedNav: true
  },

  onLoad() {
    this.filteredFundsCache = [];
    this.visiblePage = 1;
    this.loadingMoreFunds = false;
    this.refreshFavoriteCodes();
    this.hydrateSnapshot();
    this.fetchSnapshot();
  },

  onShow() {
    this.refreshFavoriteCodes();
    this.updateVisibleFunds({ keepPage: true });
  },

  onUnload() {
    this.clearSearchTimer();
    this.clearToastTimer();
    this.clearPulseTimer();
  },

  onReachBottom() {
    this.handleLoadMoreFunds();
  },

  onPageScroll(event) {
    const showTableBackTop = Number(event.scrollTop || 0) > 240;
    if (showTableBackTop !== this.data.showTableBackTop) {
      this.setData({ showTableBackTop });
    }
  },

  hydrateSnapshot() {
    const snapshot = readSnapshot(HOME_SECTION, { allowStale: true });
    if (!snapshot) return false;
    this.applySnapshot(snapshot, { stale: true });
    return true;
  },

  async fetchSnapshot({ force = false } = {}) {
    this.setData({ pollingError: '', initialLoading: this.data.funds.length === 0 });
    try {
      const snapshot = await fetchFundsSnapshot({ section: 'ALL', force, includeTrends: false, showLoading: false });
      if (!snapshot || !Array.isArray(snapshot.rows)) throw new Error('行情接口返回空数据');
      writeSnapshot(HOME_SECTION, snapshot);
      this.applySnapshot(snapshot);
    } catch (error) {
      const fallback = readSnapshot(HOME_SECTION, { allowStale: true });
      if (fallback) {
        this.applySnapshot(fallback, {
          stale: true,
          errorMessage: error && error.message ? error.message : '行情接口加载失败'
        });
        return;
      }
      this.setData({
        initialLoading: false,
        pollingError: error && error.message ? error.message : '行情接口加载失败'
      });
    }
  },

  applySnapshot(snapshot, options = {}) {
    const sourceMeta = snapshot.meta || {};
    const meta = Object.assign({}, sourceMeta, options.stale ? { stale: true } : {});
    const normalizedFunds = (snapshot.rows || []).map((row) => normalizeFund(row, meta));
    const funds = mergeStablePurchaseStatuses(this.data.funds, normalizedFunds);
    this.setData({
      funds,
      meta,
      initialLoading: false,
      lastSuccessAt: meta.updateTime || meta.latestQuoteTime || '',
      pollingError: options.errorMessage || '',
      abnormalCount: funds.filter((fund) => fund.stale || fund.confidence < 70 || fund.errorMessage).length
    });
    this.updateVisibleFunds({ keepPage: Boolean(options.keepPage) });
  },

  refreshFavoriteCodes() {
    const favoriteCodes = loadFavoriteCodes();
    this.setData({ favoriteCodes });
  },

  updateVisibleFunds(options = {}) {
    const previousVisibleCount = this.data.visibleFunds.length || PAGE_SIZE;
    const favoriteSet = new Set(this.data.favoriteCodes);
    const favoriteFunds = this.data.funds.filter((fund) => favoriteSet.has(fund.code));
    const filteredFunds = filterAndSortFunds(favoriteFunds, {
      query: this.data.query,
      marketFilter: this.data.marketFilter,
      excludePausedPurchase: this.data.excludePausedPurchase,
      sortKey: this.data.sortKey,
      sortDirection: this.data.sortDirection
    }).map((fund) => Object.assign({}, fund, {
      isFavorite: favoriteSet.has(fund.code),
      purchaseText: purchaseText(fund),
      purchaseState: purchaseState(fund)
    }));
    this.filteredFundsCache = filteredFunds;
    this.visiblePage = options.keepPage
      ? Math.max(1, this.visiblePage || Math.ceil(previousVisibleCount / PAGE_SIZE))
      : 1;
    this.applyVisibleFundsPage();
  },

  applyVisibleFundsPage() {
    const filteredFunds = Array.isArray(this.filteredFundsCache) ? this.filteredFundsCache : [];
    const end = Math.max(PAGE_SIZE, (this.visiblePage || 1) * PAGE_SIZE);
    const visibleFunds = filteredFunds.slice(0, end);
    this.setData({
      visibleFunds,
      visibleTotalCount: filteredFunds.length,
      hasMoreFunds: visibleFunds.length < filteredFunds.length,
      showEstimatedNav: this.data.marketFilter !== 'T+2',
      dataVersion: `${this.data.meta && (this.data.meta.updateTime || this.data.meta.latestQuoteTime) || 'initial'}:${filteredFunds.length}:${visibleFunds.map((fund) => [fund.code, fund.marketPrice, fund.premiumRate, fund.lastNav, fund.estimatedNav].join(':')).join('|')}`
    });
  },

  handleLoadMoreFunds() {
    const filteredFunds = Array.isArray(this.filteredFundsCache) ? this.filteredFundsCache : [];
    if (this.loadingMoreFunds || this.data.initialLoading || this.data.visibleFunds.length >= filteredFunds.length) return;
    this.loadingMoreFunds = true;
    setTimeout(() => {
      this.visiblePage = (this.visiblePage || 1) + 1;
      this.applyVisibleFundsPage();
      this.loadingMoreFunds = false;
    }, 120);
  },

  handleSearchChange(event) {
    this.setData({ query: event.detail.value || '' });
    this.queueVisibleFundsUpdate();
  },

  queueVisibleFundsUpdate() {
    this.clearSearchTimer();
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.updateVisibleFunds();
    }, SEARCH_DEBOUNCE_MS);
  },

  clearSearchTimer() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
  },

  handleExcludePausedChange(event) {
    this.clearSearchTimer();
    this.setData({ excludePausedPurchase: Boolean(event.detail.value) });
    this.updateVisibleFunds({ keepPage: true });
  },

  handleMarketFilterChange(event) {
    this.clearSearchTimer();
    const nextMarketFilter = event.detail.value || 'ALL';
    this.setData({
      marketFilter: nextMarketFilter,
      sortKey: nextMarketFilter === 'T+2' && this.data.sortKey === 'estimatedNav' ? 'premiumRate' : this.data.sortKey
    });
    this.resetTableScroll();
    this.updateVisibleFunds();
  },

  handleTableSort(event) {
    const key = event.detail.key;
    if (!key) return;
    if (this.data.sortKey === key) {
      this.setData({ sortDirection: this.data.sortDirection === 'asc' ? 'desc' : 'asc' });
    } else {
      this.setData({ sortKey: key, sortDirection: 'asc' });
    }
    this.updateVisibleFunds();
  },

  handleSelectFund(event) {
    const fund = event.detail.fund;
    if (!fund || !fund.code) return;
    wx.navigateTo({
      url: `/pages/detail/detail?code=${encodeURIComponent(fund.code)}&section=ALL`
    });
  },

  toggleFavorite(event) {
    const fund = event.detail.fund;
    if (!fund || !fund.code) return;
    const next = new Set(this.data.favoriteCodes);
    const willAdd = !next.has(fund.code);
    if (willAdd) next.add(fund.code);
    else next.delete(fund.code);
    const favoriteCodes = Array.from(next);
    storeFavoriteCodes(favoriteCodes);
    this.setData({
      favoriteCodes,
      pulseCode: fund.code,
      toastText: willAdd ? `已加入自选：${fund.name}` : `已移出自选：${fund.name}`
    });
    this.updateVisibleFunds();
    this.clearPulseTimer();
    this.pulseTimer = setTimeout(() => this.setData({ pulseCode: '' }), 650);
    this.clearToastTimer();
    this.toastTimer = setTimeout(() => this.setData({ toastText: '' }), 1800);
  },

  resetTableScroll() {
    this.setData({ tableResetToken: this.data.tableResetToken + 1 });
  },

  scrollPageToTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 220 });
    this.setData({ showTableBackTop: false, tableResetToken: this.data.tableResetToken + 1 });
  },

  clearToastTimer() {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = null;
  },

  clearPulseTimer() {
    if (this.pulseTimer) clearTimeout(this.pulseTimer);
    this.pulseTimer = null;
  }
});

function loadFavoriteCodes() {
  try {
    const parsed = JSON.parse(wx.getStorageSync(WATCH_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch (error) {
    return [];
  }
}

function storeFavoriteCodes(codes) {
  wx.setStorageSync(WATCH_STORAGE_KEY, JSON.stringify(codes));
}

function purchaseText(fund) {
  const limit = fund.purchaseLimit || {};
  const rawLabel = limit.label || limit.limitText || fund.subscriptionStatus || '';
  const label = !rawLabel || /^(未知|--|-|N\/A)$/i.test(rawLabel) ? '暂无数据' : rawLabel;
  const state = limit.state || fund.subscriptionState || 'unavailable';
  if (state === 'open' && (/无限额|不限额/.test(label) || /开放/.test(label))) return '不限额';
  if (/开放申购\s*\/\s*无限额|开放申购.*不限额/.test(label)) return '不限额';
  return label;
}

function purchaseState(fund) {
  const state = (fund.purchaseLimit && fund.purchaseLimit.state) || fund.subscriptionState;
  return !state || state === 'unknown' ? 'unavailable' : state;
}
