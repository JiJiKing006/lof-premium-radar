const { fetchFundsSnapshot, fetchFundDetail, normalizeFund, mergeStablePurchaseStatuses } = require('../../utils/fund-api');
const { filterAndSortFunds, settlementCycle } = require('../../utils/fund-filter');
const { readSnapshot, writeSnapshot } = require('../../utils/cache');
const { recordVisitor, getOrCreateDeviceId } = require('../../utils/analytics');
const { allowAction } = require('../../utils/action-guard');

const PAGE_SIZE = 30;
const SEARCH_DEBOUNCE_MS = 160;
const WATCH_STORAGE_KEY = 'fund-watchlist';
const WATCH_SECTION = 'WATCH';
const DEFAULT_SECTION = 'ALL';
const DEFAULT_MARKET_FILTER = 'ALL';
const PURCHASE_STATUS_RECOVERY_DELAY_MS = 3800;
const PURCHASE_STATUS_RECOVERY_MAX_ATTEMPTS = 1;
const MIN_REFRESH_LOADING_MS = 650;

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
    excludePausedPurchase: true,
    sortKey: 'premiumRate',
    sortDirection: 'desc',
    activeSortKey: 'premiumRate',
    sortMode: 'desc',
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
    showEstimatedNav: false,
    operationLoading: false,
    loadingTitle: '',
    loadingNote: ''
  },

  onLoad() {
    this.sectionRequestIds = {};
    this.sectionStates = {};
    this.currentFunds = [];
    this.filteredFundsCache = [];
    this.visiblePage = 1;
    this.loadingMoreFunds = false;
    this.purchaseStatusRecoveryAttempts = 0;
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
    timeoutMessage,
    skipRecovery = false
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
      const allowsEmptyResult = targetSection === WATCH_SECTION || Boolean(String(this.data.query || '').trim());
      if (!fetchedSnapshot || !Array.isArray(fetchedSnapshot.rows) || (!fetchedSnapshot.rows.length && !allowsEmptyResult)) {
        throw new Error('信息接口返回空数据');
      }
      const snapshot = this.stabilizeSnapshotPurchaseStatuses(targetSection, fetchedSnapshot);
      writeSnapshot(this.snapshotCacheKey(targetSection), snapshot);
      this.rememberSectionSnapshot(targetSection, snapshot);
      if (targetSection === this.data.section) {
        this.applySectionSnapshot(snapshot, {
          section: targetSection,
          keepPage: Boolean(background),
          skipRecovery
        });
      }
      return snapshot;
    } catch (error) {
      const fallback = readSnapshot(this.snapshotCacheKey(targetSection), { allowStale: true });
      if (fallback && targetSection === this.data.section) {
        this.applySectionSnapshot(fallback, {
          section: targetSection,
          stale: true,
          keepPage: true,
          skipRecovery: true,
          errorMessage: background ? '' : error && error.message ? error.message : '信息加载失败'
        });
        return false;
      }
      if (!background && targetSection === this.data.section) {
        this.setData({
          initialLoading: false,
          pollingError: error && error.message ? error.message : '信息加载失败'
        });
      }
      return false;
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
      lastSuccessAt: formatUpdateTime(meta.updateTime || meta.latestQuoteTime || ''),
      abnormalCount
    });
    if (section !== this.data.section) return;
    setCurrentFunds(this, funds);
    this.setData({
      meta,
      initialLoading: false,
      lastSuccessAt: formatUpdateTime(meta.updateTime || meta.latestQuoteTime || ''),
      pollingError: options.errorMessage || '',
      abnormalCount
    });
    this.updateVisibleFunds({ keepPage: Boolean(options.keepPage), serverPagination: meta.pagination || null });
    if (!options.skipRecovery) this.schedulePurchaseStatusRecovery(funds);
  },

  rememberSectionSnapshot(section, snapshot) {
    const meta = snapshot.meta || {};
    const previous = this.sectionStates && this.sectionStates[section] || {};
    const normalizedFunds = (snapshot.rows || []).map((row) => normalizeFund(row, meta));
    const funds = mergeStablePurchaseStatuses(previous.funds, normalizedFunds);
    this.sectionStates[section] = Object.assign({}, previous, {
      funds,
      meta,
      lastSuccessAt: formatUpdateTime(meta.updateTime || meta.latestQuoteTime || ''),
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
    if (String(state.query || '').trim()) return false;
    setCurrentFunds(this, state.funds);
    this.filteredFundsCache = Array.isArray(state.filteredFunds) ? state.filteredFunds : [];
    this.visiblePage = state.visiblePage || 1;
    this.setData({
      section,
      activeTypeLabel: sectionLabel(section),
      selectedFund: null,
      query: '',
      marketFilter: marketFilterForSection(section),
      excludePausedPurchase: Boolean(state.excludePausedPurchase),
      sortKey: 'premiumRate',
      sortDirection: 'desc',
      activeSortKey: 'premiumRate',
      sortMode: 'desc',
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
      snapshotId: page > 1
        ? options.snapshotId || this.data.meta && this.data.meta.pagination && this.data.meta.pagination.snapshotId
        : '',
      requestMode: options.requestMode,
      timeoutMs: options.timeoutMs,
      timeoutMessage: options.timeoutMessage,
      showLoading: false
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
      fetchFundDetail(code, { section: 'ALL', force: options.force, showLoading: false })
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
        warn: rows.length < favoriteCodes.length ? '部分收藏详情暂不可用，已保留可用数据' : ''
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
      settlementCycle: settlementCycle(fund),
      settlementState: settlementCycle(fund) === 'T+2' ? 'short' : 'long',
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
      showEstimatedNav: false,
      dataVersion: `${this.data.meta && (this.data.meta.updateTime || this.data.meta.latestQuoteTime) || 'initial'}:${filteredFunds.length}:${visibleFunds.map((fund) => [fund.code, fund.marketPrice, fund.premiumRate, fund.lastNav, fund.estimatedNav].join(':')).join('|')}`
    });
  },

  handleLoadMoreFunds() {
    if (this.loadingMoreFunds || this.data.initialLoading || this.data.manualRefreshing || !this.data.hasMoreFunds) return;
    if (this.loadMoreRetryAt && Date.now() < this.loadMoreRetryAt) return;
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
    const targetSection = this.data.section;
    let snapshotId = this.data.meta && this.data.meta.pagination && this.data.meta.pagination.snapshotId;
    let lastError;
    if (!snapshotId) {
      try {
        snapshotId = await this.ensurePaginationSnapshot();
      } catch (error) {
        lastError = error;
      }
      if (!snapshotId) {
        this.loadMoreRetryAt = Date.now() + 2000;
        this.showToast(lastError && lastError.message ? lastError.message : '分页快照更新中，请稍后重试', 1200);
        return;
      }
      if (!this.data.hasMoreFunds) return;
    }
    const expectedSnapshotId = snapshotId;
    const targetPage = (this.visiblePage || 1) + 1;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const snapshot = await this.fetchSnapshotForSection(targetSection, {
          force: false,
          page: targetPage,
          pageSize: PAGE_SIZE,
          snapshotId,
          requestMode: 'page',
          timeoutMs: 5000,
          timeoutMessage: '分页数据请求超时，请重试'
        });
        const currentSnapshotId = this.data.meta && this.data.meta.pagination && this.data.meta.pagination.snapshotId;
        if (targetSection !== this.data.section || currentSnapshotId !== expectedSnapshotId) return;
        if (snapshot.meta && snapshot.meta.pagination && snapshot.meta.pagination.snapshotReset) {
          this.visiblePage = 1;
          this.applySectionSnapshot(snapshot, { section: targetSection, append: false, keepPage: false });
          this.loadMoreRetryAt = 0;
          this.showToast('数据已更新，正在继续加载', 1200);
          return;
        }
        this.applySectionSnapshot(snapshot, { section: targetSection, append: true, keepPage: true });
        this.loadMoreRetryAt = 0;
        return;
      } catch (error) {
        lastError = error;
        if (attempt === 0) await wait(250);
      }
    }
    this.loadMoreRetryAt = Date.now() + 2000;
    this.showToast(lastError && lastError.message ? lastError.message : '加载更多失败', 1200);
  },

  async ensurePaginationSnapshot() {
    const snapshot = await this.fetchSnapshotForSection(this.data.section, {
      force: false,
      page: 1,
      pageSize: PAGE_SIZE,
      requestMode: 'page',
      timeoutMs: 5000,
      timeoutMessage: '分页快照初始化超时，请重试'
    });
    this.applySectionSnapshot(snapshot, {
      section: this.data.section,
      append: false,
      keepPage: false,
      skipRecovery: true
    });
    return snapshot && snapshot.meta && snapshot.meta.pagination && snapshot.meta.pagination.snapshotId || '';
  },

  async handleManualRefresh() {
    if (this.data.manualRefreshing) return;
    if (!allowAction(this, 'manual-refresh')) return;
    this.clearPurchaseStatusRecoveryTimer();
    this.purchaseStatusRecoveryAttempts = 0;
    this.visiblePage = 1;
    this.resetTableScroll();
    const loadingStartedAt = Date.now();
    this.showOperationLoading('刷新数据中', '正在更新公开数据，请稍候');
    this.setData({ manualRefreshing: true, pollingError: '' });
    try {
      await this.fetchSectionSnapshot({
        force: true,
        requestMode: 'refresh',
        timeoutMs: 6000,
        timeoutMessage: '首页数据刷新超时，已保留上一份真实数据',
        skipRecovery: true
      });
    } finally {
      const remaining = MIN_REFRESH_LOADING_MS - (Date.now() - loadingStartedAt);
      if (remaining > 0) await wait(remaining);
      this.setData({ manualRefreshing: false });
      this.hideOperationLoading();
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
    if (!hasMissingPurchaseStatus) {
      this.purchaseStatusRecoveryAttempts = 0;
      this.clearPurchaseStatusRecoveryTimer();
      return;
    }
    if (this.purchaseStatusRecoveryTimer || this.purchaseStatusRecoveryAttempts >= PURCHASE_STATUS_RECOVERY_MAX_ATTEMPTS) return;
    this.purchaseStatusRecoveryTimer = setTimeout(() => {
      this.purchaseStatusRecoveryTimer = null;
      this.purchaseStatusRecoveryAttempts += 1;
      if (this.data.section !== WATCH_SECTION) this.fetchInteractiveSnapshot();
    }, PURCHASE_STATUS_RECOVERY_DELAY_MS);
  },

  clearPurchaseStatusRecoveryTimer() {
    if (this.purchaseStatusRecoveryTimer) clearTimeout(this.purchaseStatusRecoveryTimer);
    this.purchaseStatusRecoveryTimer = null;
  },

  handleSectionChange(event) {
    this.clearSearchTimer();
    const section = event.detail.value;
    if (!section || section === this.data.section) return;
    if (!allowAction(this, `section:${section}`)) return;
    this.rememberCurrentSectionState();
    this.refreshFavoriteCodes();
    this.setData({ query: '' });
    this.resetTableScroll();
    if (this.restoreSectionState(section)) {
      this.fetchSectionSnapshot({ section, force: true });
      return;
    }
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
      activeSortKey: 'premiumRate',
      sortMode: 'desc',
      visibleFunds: [],
      visibleTotalCount: 0,
      hasMoreFunds: false,
      meta: null,
      initialLoading: true
    });
    this.hydrateSectionSnapshot({ section, allowStale: true });
    this.fetchSectionSnapshot({ section, force: true });
  },

  showAllFunds() {
    this.handleSectionChange({ detail: { value: 'ALL' } });
  },

  showWatchFunds() {
    this.handleSectionChange({ detail: { value: WATCH_SECTION } });
  },

  showOperationLoading(title, note) {
    this.setData({
      operationLoading: true,
      loadingTitle: title || '加载中',
      loadingNote: note || '请稍候'
    });
  },

  hideOperationLoading() {
    this.setData({ operationLoading: false, loadingTitle: '', loadingNote: '' });
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
    if (!allowAction(this, 'exclude-paused')) return;
    const nextValue = event && event.currentTarget && event.currentTarget.dataset.direct
      ? !this.data.excludePausedPurchase
      : Boolean(event.detail.value);
    this.setData({ excludePausedPurchase: nextValue });
    this.resetTableScroll();
    if (this.data.section === WATCH_SECTION) this.updateVisibleFunds();
    else this.fetchInteractiveSnapshot();
  },

  handleTableSort(event) {
    this.clearSearchTimer();
    const key = event.detail.key;
    if (!key) return;
    if (!allowAction(this, `sort:${key}`)) return;
    const currentMode = this.data.activeSortKey === key ? this.data.sortMode : 'default';
    const nextMode = currentMode === 'default' ? 'desc' : currentMode === 'desc' ? 'asc' : 'default';
    this.setData(nextMode === 'default'
      ? { activeSortKey: '', sortMode: 'default', sortKey: 'premiumRate', sortDirection: 'desc' }
      : { activeSortKey: key, sortMode: nextMode, sortKey: key, sortDirection: nextMode });
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
    if (!allowAction(this, `select:${fund.code}`)) return;
    wx.navigateTo({
      url: `/pages/detail/detail?code=${encodeURIComponent(fund.code)}&section=${encodeURIComponent(fund.type || 'ALL')}`
    });
  },

  toggleFavorite(event) {
    const fund = event.detail.fund;
    if (!fund || !fund.code) return;
    if (!allowAction(this, `favorite:${fund.code}`)) return;
    const next = new Set(this.data.favoriteCodes);
    const willAdd = !next.has(fund.code);
    if (willAdd) next.add(fund.code);
    else next.delete(fund.code);
    const favoriteCodes = Array.from(next);
    storeFavoriteCodes(favoriteCodes);
    this.setData({
      favoriteCodes,
      pulseCode: fund.code,
      toastText: willAdd ? `已加入收藏：${fund.name}` : `已移出收藏：${fund.name}`
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
    sourceTitle: '收藏',
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
    ALL: '全部',
    WATCH: '收藏',
    'T+2': 'T+2',
    'T+3': 'T+3'
  };
  return map[section] || DEFAULT_SECTION;
}

function marketFilterForSection(section) {
  if (section === 'T+2' || section === 'T+3') return section;
  return 'ALL';
}

function formatUpdateTime(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const normalized = text.replace('T', ' ').replace(/\.\d{3}Z?$/, '').replace(/Z$/, '');
  const fullMatch = normalized.match(/^(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!fullMatch) return normalized;
  return `${fullMatch[1]}-${fullMatch[2]}-${fullMatch[3]} ${fullMatch[4]}:${fullMatch[5]}:${fullMatch[6]}`;
}

function localTimestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function wait(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration));
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
  const limit = fund && fund.purchaseLimit || {};
  const label = String(limit.label || limit.limitText || fund && fund.subscriptionStatus || '').trim();
  const state = String(limit.state || fund && fund.subscriptionState || '').toLowerCase();
  const explicitAmount = purchaseLimitAmount(limit, label);

  if (state === 'paused' || /暂停|停止/.test(label)) return '暂停';
  if (state === 'open' || /不限额|无限额|不限|开放/.test(label) || explicitAmount !== null && explicitAmount >= 800_000_000) return '不限';
  if (state === 'limited' || /限|大额/.test(label)) {
    return explicitAmount === null ? '暂无数据' : `限 ${formatPurchaseAmount(explicitAmount)}`;
  }
  return '暂无数据';
}

function purchaseLimitAmount(limit, label) {
  const value = limit.dailyLimit ?? limit.limitAmount ?? limit.amountYuan;
  if (value !== null && value !== undefined && value !== '') {
    const amount = Number(value);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  const match = String(label || '').match(/(\d+(?:\.\d+)?)\s*(亿|万|元)/);
  if (!match) return null;
  const scale = match[2] === '亿' ? 100_000_000 : match[2] === '万' ? 10_000 : 1;
  const amount = Number(match[1]) * scale;
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function formatPurchaseAmount(amount) {
  if (amount > 10_000) return `${trimPurchaseDecimal(amount / 10_000, 4)} 万`;
  return `${trimPurchaseDecimal(amount, 2)} 元`;
}

function trimPurchaseDecimal(value, precision) {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(precision).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
}

function hasUsablePurchaseStatus(fund) {
  const limit = fund && fund.purchaseLimit || {};
  const label = String(limit.label || limit.limitText || fund && fund.subscriptionStatus || '').trim();
  const state = String(limit.state || fund && fund.subscriptionState || '').toLowerCase();
  return Boolean(label)
    && !/^(未知|暂无数据|--|-|N\/A)$/i.test(label)
    && !['', 'unknown', 'unavailable'].includes(state);
}

function purchaseState(fund) {
  const state = (fund.purchaseLimit && fund.purchaseLimit.state) || fund.subscriptionState;
  return !state || state === 'unknown' ? 'unavailable' : state;
}

function hasChangedField(fund, fields) {
  const changedFields = Array.isArray(fund.changedFields) ? fund.changedFields : [];
  return fields.some((field) => changedFields.includes(field));
}
