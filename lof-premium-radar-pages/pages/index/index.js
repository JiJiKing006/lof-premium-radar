const { fetchFundsSnapshot, fetchFundDetail, normalizeFund, mergeStablePurchaseStatuses } = require('../../utils/fund-api');
const { filterAndSortFunds } = require('../../utils/fund-filter');
const { readSnapshot, writeSnapshot } = require('../../utils/cache');
const { recordVisitor, getOrCreateDeviceId } = require('../../utils/analytics');

const PAGE_SIZE = 30;
const SEARCH_DEBOUNCE_MS = 160;
const WATCH_STORAGE_KEY = 'fund-watchlist';
const WATCH_SECTION = 'WATCH';
const DEFAULT_SECTION = 'T+2';
const DEFAULT_MARKET_FILTER = 'T+2';
const PURCHASE_STATUS_RECOVERY_DELAY_MS = 3800;

function getCurrentFunds(page) {
  return page && Array.isArray(page.currentFunds) ? page.currentFunds : [];
}

function setCurrentFunds(page, funds) {
  if (!page) return [];
  page.currentFunds = Array.isArray(funds) ? funds : [];
  return page.currentFunds;
}

Page({
  data: {
    section: DEFAULT_SECTION,
    activeTypeLabel: DEFAULT_SECTION,
    query: '',
    marketFilter: DEFAULT_MARKET_FILTER,
    excludePausedPurchase: false,
    sortKey: 'premiumRate',
    sortDirection: 'desc',
    funds: [],
    visibleFunds: [],
    visibleTotalCount: 0,
    hasMoreFunds: false,
    loadingMoreFunds: false,
    meta: null,
    initialLoading: true,
    pollingError: '',
    lastSuccessAt: '',
    abnormalCount: 0,
    favoriteCodes: [],
    pulseCode: '',
    toastText: '',
    dataVersion: '',
    selectedFund: null,
    tableResetToken: 0,
    manualRefreshing: false,
    showTableBackTop: false,
    showEstimatedNav: true
  },

  onLoad() {
    this.sectionRequestIds = {};
    this.sectionStates = {};
    this.currentFunds = [];
    this.filteredFundsCache = [];
    this.visiblePage = 1;
    this.loadingMoreFunds = false;
    this.refreshFavoriteCodes();
    this.hydrateSectionSnapshot({ allowStale: true });
    this.fetchSectionSnapshot();
    recordVisitor(getOrCreateDeviceId(), '/pages/index/index', 'lof').catch(() => {});
  },

  onShow() {
    const favoriteChanged = this.refreshFavoriteCodes();
    if (favoriteChanged && this.data.section === WATCH_SECTION) {
      this.fetchSectionSnapshot({ force: false });
    } else {
      this.updateVisibleFunds({ keepPage: true });
    }
  },

  onHide() {
  },

  onUnload() {
    this.clearToastTimer();
    this.clearPulseTimer();
    this.clearSearchTimer();
    this.clearPurchaseStatusRecoveryTimer();
    this.clearPostRefreshTimer();
  },

  hydrateSectionSnapshot(options = {}) {
    const section = options.section || this.data.section;
    const snapshot = readSnapshot(this.snapshotCacheKey(section), { allowStale: Boolean(options.allowStale) });
    if (!snapshot) {
      if (section === this.data.section) {
        setCurrentFunds(this, []);
        this.filteredFundsCache = [];
        this.setData({
          visibleFunds: [],
          visibleTotalCount: 0,
          hasMoreFunds: false,
          meta: null,
          initialLoading: true
        });
      }
      return false;
    }
    this.applySectionSnapshot(snapshot, { section, stale: true, keepPage: true });
    return true;
  },

  async fetchSectionSnapshot({
    force = false,
    section = this.data.section,
    background = false,
    requestMode = '',
    timeoutMs,
    timeoutMessage
  } = {}) {
    const targetSection = section || this.data.section;
    const requestId = `${Date.now()}:${Math.random()}`;
    this.sectionRequestIds = this.sectionRequestIds || {};
    this.sectionRequestIds[targetSection] = requestId;
    if (!background && targetSection === this.data.section) {
      this.setData({ pollingError: '', initialLoading: getCurrentFunds(this).length === 0 });
    }
    try {
      const fetchedSnapshot = await this.fetchSnapshotForSection(targetSection, {
        force,
        requestMode,
        timeoutMs,
        timeoutMessage
      });
      if (this.sectionRequestIds[targetSection] !== requestId) return;
      if (!fetchedSnapshot || !Array.isArray(fetchedSnapshot.rows) || (!fetchedSnapshot.rows.length && targetSection !== WATCH_SECTION)) {
        throw new Error('行情接口返回空数据');
      }
      const snapshot = this.stabilizeSnapshotPurchaseStatuses(targetSection, fetchedSnapshot);
      writeSnapshot(this.snapshotCacheKey(targetSection), snapshot);
      this.rememberSectionSnapshot(targetSection, snapshot);
      if (targetSection === this.data.section) {
        this.applySectionSnapshot(snapshot, { section: targetSection, keepPage: Boolean(background) });
      }
    } catch (error) {
      const fallback = readSnapshot(this.snapshotCacheKey(targetSection), { allowStale: true });
      if (fallback && targetSection === this.data.section) {
        this.applySectionSnapshot(fallback, {
          section: targetSection,
          stale: true,
          keepPage: true,
          errorMessage: error && error.message ? error.message : '行情接口加载失败'
        });
        return;
      }
      if (!background && targetSection === this.data.section) {
        this.setData({
          initialLoading: false,
          pollingError: error && error.message ? error.message : '行情接口加载失败'
        });
      }
    }
  },

  stabilizeSnapshotPurchaseStatuses(section, snapshot) {
    const meta = snapshot.meta || {};
    const state = this.sectionStates && this.sectionStates[section] || {};
    const cached = readSnapshot(this.snapshotCacheKey(section), { allowStale: true });
    const previousRows = Array.isArray(state.funds) && state.funds.length
      ? state.funds
      : cached && Array.isArray(cached.rows)
        ? cached.rows.map((row) => normalizeFund(row, cached.meta || {}))
        : [];
    const incomingRows = (snapshot.rows || []).map((row) => normalizeFund(row, meta));
    return Object.assign({}, snapshot, {
      rows: mergeStablePurchaseStatuses(previousRows, incomingRows)
    });
  },

  applySectionSnapshot(snapshot, options = {}) {
    const section = options.section || this.data.section;
    const sourceMeta = snapshot.meta || {};
    const meta = Object.assign({}, sourceMeta, options.stale ? { stale: true } : {});
    const currentState = this.sectionStates && this.sectionStates[section] || {};
    const previousFunds = Array.isArray(currentState.funds)
      ? currentState.funds
      : section === this.data.section ? getCurrentFunds(this) : [];
    const normalizedFunds = (snapshot.rows || []).map((row) => normalizeFund(row, meta));
    const incomingFunds = mergeStablePurchaseStatuses(previousFunds, normalizedFunds);
    const funds = options.append ? appendUniqueFunds(getCurrentFunds(this), incomingFunds) : incomingFunds;
    const abnormalCount = funds.filter((fund) => fund.stale || fund.confidence < 70 || fund.errorMessage).length;
    this.sectionStates[section] = Object.assign({}, currentState, {
      funds,
      meta,
      lastSuccessAt: meta.updateTime || meta.latestQuoteTime || '',
      abnormalCount
    });
    if (section !== this.data.section) return;
    setCurrentFunds(this, funds);
    this.setData({
      meta,
      initialLoading: false,
      lastSuccessAt: meta.updateTime || meta.latestQuoteTime || '',
      pollingError: options.errorMessage || '',
      abnormalCount
    });
    this.updateVisibleFunds({ keepPage: Boolean(options.keepPage), serverPagination: meta.pagination || null });
    this.schedulePurchaseStatusRecovery(funds);
  },

  rememberSectionSnapshot(section, snapshot) {
    const meta = snapshot.meta || {};
    const previous = this.sectionStates && this.sectionStates[section] || {};
    const normalizedFunds = (snapshot.rows || []).map((row) => normalizeFund(row, meta));
    const funds = mergeStablePurchaseStatuses(previous.funds, normalizedFunds);
    this.sectionStates[section] = Object.assign({}, previous, {
      funds,
      meta,
      lastSuccessAt: meta.updateTime || meta.latestQuoteTime || '',
      abnormalCount: funds.filter((fund) => fund.stale || fund.confidence < 70 || fund.errorMessage).length
    });
  },

  rememberCurrentSectionState() {
    const section = this.data.section;
    this.sectionStates = this.sectionStates || {};
    this.sectionStates[section] = Object.assign({}, this.sectionStates[section] || {}, {
      funds: getCurrentFunds(this),
      meta: this.data.meta,
      query: this.data.query,
      marketFilter: this.data.marketFilter,
      excludePausedPurchase: this.data.excludePausedPurchase,
      sortKey: this.data.sortKey,
      sortDirection: this.data.sortDirection,
      visiblePage: this.visiblePage || 1,
      lastSuccessAt: this.data.lastSuccessAt,
      abnormalCount: this.data.abnormalCount,
      filteredFunds: this.filteredFundsCache || []
    });
  },

  restoreSectionState(section) {
    const state = this.sectionStates && this.sectionStates[section];
    if (!state || !Array.isArray(state.funds)) return false;
    setCurrentFunds(this, state.funds);
    this.filteredFundsCache = Array.isArray(state.filteredFunds) ? state.filteredFunds : [];
    this.visiblePage = state.visiblePage || 1;
    this.setData({
      section,
      activeTypeLabel: sectionLabel(section),
      selectedFund: null,
      query: state.query || '',
      marketFilter: marketFilterForSection(section),
      excludePausedPurchase: Boolean(state.excludePausedPurchase),
      sortKey: state.sortKey || 'premiumRate',
      sortDirection: state.sortDirection || 'desc',
      meta: state.meta || null,
      initialLoading: false,
      pollingError: '',
      lastSuccessAt: state.lastSuccessAt || '',
      abnormalCount: state.abnormalCount || 0
    });
    this.updateVisibleFunds({ keepPage: true });
    return true;
  },

  async fetchSnapshotForSection(section, options) {
    if (section === WATCH_SECTION) {
      return this.fetchWatchSnapshot(options || {});
    }
    const marketFilter = marketFilterForSection(section);
    const page = options.page || 1;
    const pageSize = options.pageSize || PAGE_SIZE;
    return fetchFundsSnapshot({
      section: 'ALL',
      force: options.force,
      includeTrends: false,
      fields: 'home',
      page,
      pageSize,
      query: this.data.query,
      marketFilter,
      excludePausedPurchase: this.data.excludePausedPurchase,
      sortKey: this.data.sortKey,
      sortDirection: this.data.sortDirection,
      requestMode: options.requestMode,
      timeoutMs: options.timeoutMs,
      timeoutMessage: options.timeoutMessage
    });
  },

  refreshFavoriteCodes() {
    const favoriteCodes = loadFavoriteCodes();
    const previous = Array.isArray(this.data.favoriteCodes) ? this.data.favoriteCodes.join(',') : '';
    const next = favoriteCodes.join(',');
    this.setData({ favoriteCodes });
    return previous !== next;
  },

  async fetchWatchSnapshot(options = {}) {
    const favoriteCodes = loadFavoriteCodes();
    if (!favoriteCodes.length) {
      return {
        meta: buildWatchMeta({
          rowCount: 0,
          allCount: 0,
          updateTime: localTimestamp()
        }),
        rows: []
      };
    }
    const settled = await Promise.all(favoriteCodes.map((code) => (
      fetchFundDetail(code, { section: 'ALL', force: options.force })
        .then((fund) => fund && fund.raw ? fund.raw : null)
        .catch(() => null)
    )));
    const rows = settled.filter(Boolean);
    const updateTime = rows
      .map((row) => row.updateTime || row.quoteTime || row.navDate || '')
      .filter(Boolean)
      .sort()
      .pop() || localTimestamp();
    return {
      meta: buildWatchMeta({
        rowCount: rows.length,
        allCount: favoriteCodes.length,
        updateTime,
        warn: rows.length < favoriteCodes.length ? '部分自选详情暂不可用，已保留真实可用数据' : ''
      }),
      rows
    };
  },

  updateVisibleFunds(options = {}) {
    const favoriteSet = new Set(this.data.favoriteCodes);
    const currentFunds = getCurrentFunds(this);
    const tabFunds = this.data.section === WATCH_SECTION
      ? currentFunds.filter((fund) => favoriteSet.has(fund.code))
      : currentFunds;
    const marketFilter = marketFilterForSection(this.data.section);
    const filteredFunds = filterAndSortFunds(tabFunds, {
      query: this.data.query,
      marketFilter,
      excludePausedPurchase: this.data.excludePausedPurchase,
      sortKey: this.data.sortKey,
      sortDirection: this.data.sortDirection
    }).map((fund) => Object.assign({}, fund, {
      isFavorite: favoriteSet.has(fund.code),
      purchaseText: purchaseText(fund),
      purchaseState: purchaseState(fund),
      changedPremiumRate: hasChangedField(fund, ['premiumRate', 'realtimePremium']),
      changedMarketPrice: hasChangedField(fund, ['marketPrice', 'price']),
      changedChangeRate: hasChangedField(fund, ['changeRate', 'changePercent', 'changeValue']),
      changedLastNav: hasChangedField(fund, ['lastNav', 'nav']),
      changedEstimatedNav: hasChangedField(fund, ['estimatedNav', 'estimatedValue'])
    }));
    this.filteredFundsCache = filteredFunds;
    const pagination = options.serverPagination || this.data.meta && this.data.meta.pagination || null;
    if (pagination) {
      this.visiblePage = pagination.page || this.visiblePage || 1;
    } else if (!options.keepPage) {
      this.visiblePage = 1;
    } else {
      this.visiblePage = Math.max(1, this.visiblePage || 1);
    }
    this.applyVisibleFundsPage({ pagination });
  },

  applyVisibleFundsPage(options = {}) {
    const filteredFunds = Array.isArray(this.filteredFundsCache) ? this.filteredFundsCache : [];
    const section = this.data.section;
    const pagination = options.pagination || this.data.meta && this.data.meta.pagination || null;
    const visibleFunds = pagination
      ? filteredFunds
      : filteredFunds.slice(0, Math.max(PAGE_SIZE, (this.visiblePage || 1) * PAGE_SIZE));
    const totalCount = pagination && Number(pagination.total) || this.data.meta && (Number(this.data.meta.totalCount) || Number(this.data.meta.filteredCount)) || filteredFunds.length;
    if (this.sectionStates && this.sectionStates[section]) {
      this.sectionStates[section] = Object.assign({}, this.sectionStates[section], {
        filteredFunds,
        visiblePage: this.visiblePage || 1,
        query: this.data.query,
        marketFilter: this.data.marketFilter,
        excludePausedPurchase: this.data.excludePausedPurchase,
        sortKey: this.data.sortKey,
        sortDirection: this.data.sortDirection
      });
    }
    this.setData({
      visibleFunds,
      visibleTotalCount: totalCount,
      hasMoreFunds: pagination ? Boolean(pagination.hasMore) : visibleFunds.length < filteredFunds.length,
      showEstimatedNav: marketFilterForSection(this.data.section) !== 'T+2',
      dataVersion: `${this.data.meta && (this.data.meta.updateTime || this.data.meta.latestQuoteTime) || 'initial'}:${filteredFunds.length}:${visibleFunds.map((fund) => [fund.code, fund.marketPrice, fund.premiumRate, fund.lastNav, fund.estimatedNav].join(':')).join('|')}`
    });
  },

  handleLoadMoreFunds() {
    if (this.loadingMoreFunds || this.data.initialLoading || !this.data.hasMoreFunds) return;
    this.loadingMoreFunds = true;
    this.setData({ loadingMoreFunds: true });
    const requestsApi = this.data.section !== WATCH_SECTION;
    const loader = !requestsApi
      ? Promise.resolve().then(() => {
        this.visiblePage = (this.visiblePage || 1) + 1;
        this.applyVisibleFundsPage();
      })
      : this.fetchNextFundsPage();
    loader.finally(() => {
      this.loadingMoreFunds = false;
      this.setData({ loadingMoreFunds: false });
    });
  },

  async fetchNextFundsPage() {
    const targetPage = (this.visiblePage || 1) + 1;
    try {
      const snapshot = await this.fetchSnapshotForSection(this.data.section, {
        force: false,
        page: targetPage,
        pageSize: PAGE_SIZE,
        requestMode: 'page',
        timeoutMs: 1000,
        timeoutMessage: '分页数据请求超时，请重试'
      });
      this.applySectionSnapshot(snapshot, { section: this.data.section, append: true, keepPage: true });
    } catch (error) {
      this.showToast(error && error.message ? error.message : '加载更多失败', 1200);
    }
  },

  onPullDownRefresh() {
    this.handleManualRefresh();
  },

  async handleManualRefresh() {
    if (this.data.manualRefreshing) {
      stopPullDownRefreshSafely();
      return;
    }
    this.setData({ manualRefreshing: true, pollingError: '' });
    showLoadingSafely('加载数据中');
    try {
      await this.fetchSectionSnapshot({
        force: true,
        requestMode: 'refresh',
        timeoutMs: 1200,
        timeoutMessage: '首页数据刷新超时，已保留上一份真实数据'
      });
      this.schedulePostRefreshSnapshot();
    } finally {
      this.setData({ manualRefreshing: false });
      hideLoadingSafely();
      stopPullDownRefreshSafely();
    }
  },

  handleSearchChange(event) {
    this.setData({ query: event.detail.value || '' });
    this.queueVisibleFundsUpdate();
  },

  queueVisibleFundsUpdate() {
    this.clearSearchTimer();
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      if (this.data.section === WATCH_SECTION) this.updateVisibleFunds();
      else this.fetchInteractiveSnapshot();
    }, SEARCH_DEBOUNCE_MS);
  },

  clearSearchTimer() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
  },

  schedulePurchaseStatusRecovery(funds) {
    const hasMissingPurchaseStatus = (Array.isArray(funds) ? funds : []).some((fund) => !hasUsablePurchaseStatus(fund));
    if (!hasMissingPurchaseStatus || this.purchaseStatusRecoveryTimer) return;
    this.purchaseStatusRecoveryTimer = setTimeout(() => {
      this.purchaseStatusRecoveryTimer = null;
      if (this.data.section !== WATCH_SECTION) this.fetchInteractiveSnapshot();
    }, PURCHASE_STATUS_RECOVERY_DELAY_MS);
  },

  clearPurchaseStatusRecoveryTimer() {
    if (this.purchaseStatusRecoveryTimer) clearTimeout(this.purchaseStatusRecoveryTimer);
    this.purchaseStatusRecoveryTimer = null;
  },

  schedulePostRefreshSnapshot() {
    this.clearPostRefreshTimer();
    this.postRefreshTimer = setTimeout(() => {
      this.postRefreshTimer = null;
      if (this.data.section === WATCH_SECTION) return;
      this.fetchSectionSnapshot({
        background: true,
        requestMode: 'page',
        timeoutMs: 1000,
        timeoutMessage: ''
      });
    }, 1100);
  },

  clearPostRefreshTimer() {
    if (this.postRefreshTimer) clearTimeout(this.postRefreshTimer);
    this.postRefreshTimer = null;
  },

  handleSectionChange(event) {
    this.clearSearchTimer();
    const section = event.detail.value;
    if (!section || section === this.data.section) return;
    this.resetTableScroll();
    this.rememberCurrentSectionState();
    if (this.restoreSectionState(section)) return;
    setCurrentFunds(this, []);
    this.setData({
      section,
      activeTypeLabel: sectionLabel(section),
      selectedFund: null,
      query: '',
      marketFilter: marketFilterForSection(section),
      excludePausedPurchase: false,
      sortKey: 'premiumRate',
      sortDirection: 'desc',
      visibleFunds: [],
      visibleTotalCount: 0,
      hasMoreFunds: false,
      meta: null,
      initialLoading: true
    });
    const hydrated = this.hydrateSectionSnapshot({ section, allowStale: true });
    if (!hydrated) this.fetchSectionSnapshot({ section });
  },

  resetTableScroll() {
    this.setData({ tableResetToken: this.data.tableResetToken + 1 });
  },

  snapshotCacheKey(section) {
    const marketFilter = marketFilterForSection(section);
    const parts = [
      section || DEFAULT_SECTION,
      marketFilter || DEFAULT_MARKET_FILTER,
      this.data.excludePausedPurchase ? 'exclude-paused' : 'all-purchase',
      this.data.sortKey || 'premiumRate',
      this.data.sortDirection || 'desc',
      this.data.query ? `q:${this.data.query}` : 'q:'
    ];
    return parts.join(':');
  },

  handleExcludePausedChange(event) {
    this.clearSearchTimer();
    this.setData({ excludePausedPurchase: Boolean(event.detail.value) });
    this.resetTableScroll();
    if (this.data.section === WATCH_SECTION) this.updateVisibleFunds();
    else this.fetchInteractiveSnapshot();
  },

  handleTableSort(event) {
    this.clearSearchTimer();
    const key = event.detail.key;
    if (!key) return;
    if (this.data.sortKey === key) {
      this.setData({ sortDirection: this.data.sortDirection === 'asc' ? 'desc' : 'asc' });
    } else {
      this.setData({ sortKey: key, sortDirection: 'asc' });
    }
    if (this.data.section === WATCH_SECTION) this.updateVisibleFunds();
    else this.fetchInteractiveSnapshot();
  },

  fetchInteractiveSnapshot() {
    return this.fetchSectionSnapshot({
      force: false,
      requestMode: 'page',
      timeoutMs: 3000,
      timeoutMessage: '表格操作请求超时，请重试'
    });
  },

  handleSelectFund(event) {
    const fund = event.detail.fund;
    if (!fund || !fund.code) return;
    wx.navigateTo({
      url: `/pages/detail/detail?code=${encodeURIComponent(fund.code)}&section=${encodeURIComponent(fund.type || 'ALL')}`
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

  showToast(text, duration = 1200) {
    this.clearToastTimer();
    this.setData({ toastText: text });
    this.toastTimer = setTimeout(() => this.setData({ toastText: '' }), duration);
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

function buildWatchMeta(options = {}) {
  const rowCount = Number(options.rowCount || 0);
  const updateTime = options.updateTime || localTimestamp();
  return {
    sourceId: WATCH_SECTION,
    sourceTitle: '自选',
    sourceProvider: 'fund-detail',
    rowCount,
    allCount: Number(options.allCount || rowCount),
    filteredCount: rowCount,
    totalCount: rowCount,
    warn: options.warn || '',
    latestQuoteTime: updateTime,
    updateTime,
    status: 'ok',
    trendsIncluded: false,
    pagination: null
  };
}

function sectionLabel(section) {
  const map = {
    WATCH: '自选',
    'T+2': 'T+2',
    'T+3': 'T+3'
  };
  return map[section] || DEFAULT_SECTION;
}

function marketFilterForSection(section) {
  if (section === 'T+2' || section === 'T+3') return section;
  return 'ALL';
}

function stopPullDownRefreshSafely() {
  if (wx.stopPullDownRefresh) wx.stopPullDownRefresh();
}

function showLoadingSafely(title) {
  if (wx.showLoading) wx.showLoading({ title, mask: true });
}

function hideLoadingSafely() {
  if (wx.hideLoading) wx.hideLoading();
}

function localTimestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

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

function purchaseText(fund) {
  const limit = fund.purchaseLimit || {};
  const rawLabel = limit.label || limit.limitText || fund.subscriptionStatus || '';
  const label = !rawLabel || /^(未知|--|-|N\/A)$/i.test(rawLabel) ? '暂无数据' : rawLabel;
  const state = limit.state || fund.subscriptionState || 'unavailable';
  if (state === 'limited' || /限|大额/.test(label)) return compactPurchaseText(fund, label);
  if (state === 'open' && (/无限额|不限额/.test(label) || /开放/.test(label))) return '不限额';
  if (/开放申购\s*\/\s*无限额|开放申购.*不限额/.test(label)) return '不限额';
  return label;
}

function hasUsablePurchaseStatus(fund) {
  const limit = fund && fund.purchaseLimit || {};
  const label = String(limit.label || limit.limitText || fund && fund.subscriptionStatus || '').trim();
  const state = String(limit.state || fund && fund.subscriptionState || '').toLowerCase();
  return Boolean(label)
    && !/^(未知|暂无数据|--|-|N\/A)$/i.test(label)
    && !['', 'unknown', 'unavailable'].includes(state);
}

function compactPurchaseText(fund, label) {
  const limit = fund.purchaseLimit || {};
  const hasExplicitAmount = limit.dailyLimit !== null && limit.dailyLimit !== undefined && limit.dailyLimit !== '';
  const explicitAmount = Number(limit.dailyLimit);
  if (/不限额|无限额/.test(label) || (hasExplicitAmount && explicitAmount >= 800_000_000)) return '不限额';
  if (hasExplicitAmount && Number.isFinite(explicitAmount) && explicitAmount >= 0) return `限${formatPurchaseAmount(explicitAmount)}`;
  const match = String(label).match(/(\d+(?:\.\d+)?)\s*(亿|万|元)/);
  if (!match) return '限额';
  const scale = match[2] === '亿' ? 100_000_000 : match[2] === '万' ? 10_000 : 1;
  return `限${formatPurchaseAmount(Number(match[1]) * scale)}`;
}

function formatPurchaseAmount(value) {
  const amount = Number(value);
  if (amount > 10_000) return `${Number((amount / 10_000).toFixed(2))}万`;
  return `${Number(amount.toFixed(2))}元`;
}

function purchaseState(fund) {
  const state = (fund.purchaseLimit && fund.purchaseLimit.state) || fund.subscriptionState;
  return !state || state === 'unknown' ? 'unavailable' : state;
}

function hasChangedField(fund, fields) {
  const changedFields = Array.isArray(fund.changedFields) ? fund.changedFields : [];
  return fields.some((field) => changedFields.includes(field));
}
