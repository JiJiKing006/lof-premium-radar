const { allowAction } = require('../../utils/action-guard');

const COLUMN_RULES = {
  favorite: { percent: 11, priority: 'high' },
  security: { percent: 34, priority: 'high' },
  premiumRate: { percent: 20, priority: 'high' },
  price: { percent: 16, priority: 'high' },
  turnover: { percent: 19, priority: 'medium' }
};

function buildColumns() {
  return [
    buildColumn('favorite', '自选', { disabled: true }),
    buildColumn('security', '名称/代码', { disabled: true }),
    buildColumn('premiumRate', '实时溢价率'),
    buildColumn('price', '现价'),
    buildColumn('turnover', '成交额')
  ];
}

function buildColumn(key, title, options = {}) {
  const rule = COLUMN_RULES[key];
  return Object.assign({
    key,
    title,
    priority: rule.priority,
    style: `width:${rule.percent}%;flex-basis:${rule.percent}%;`
  }, options);
}

function buildColumnStyles(columns) {
  return columns.reduce((styles, column) => {
    styles[column.key] = column.style;
    return styles;
  }, {});
}

const DEFAULT_COLUMNS = buildColumns();

Component({
  properties: {
    rows: { type: Array, value: [] },
    loading: { type: Boolean, value: false },
    sortKey: { type: String, value: 'premiumRate' },
    sortDirection: { type: String, value: 'desc' },
    activeSortKey: { type: String, value: 'premiumRate' },
    sortMode: { type: String, value: 'desc' },
    favoriteCodes: { type: Array, value: [] },
    pulseCode: { type: String, value: '' },
    dataVersion: { type: String, value: '' },
    totalCount: { type: Number, value: 0 },
    hasMore: { type: Boolean, value: false },
    loadingMore: { type: Boolean, value: false },
    resetToken: { type: Number, value: 0 },
    updateTime: { type: String, value: '' },
    refreshing: { type: Boolean, value: false },
    showBackTop: { type: Boolean, value: false },
    showEstimatedNav: { type: Boolean, value: false }
  },

  data: {
    hasScrollable: false,
    scrollIntoView: '',
    internalShowBackTop: false,
    skeletonRows: Array.from({ length: 10 }, (_, index) => index),
    columns: DEFAULT_COLUMNS,
    columnStyles: buildColumnStyles(DEFAULT_COLUMNS)
  },

  observers: {
    rows(rows) {
      this.setData({ hasScrollable: Array.isArray(rows) && rows.length > 12 });
      this.queueLoadMoreObserver();
    },

    resetToken() {
      this.resetInlineScroll();
    },

    hasMore() {
      this.queueLoadMoreObserver();
    },

    loadingMore(value) {
      if (!value) this.loadMoreLocked = false;
    }
  },

  lifetimes: {
    ready() {
      this.measureScrollViewport();
      this.queueLoadMoreObserver();
    },

    detached() {
      if (this.loadMoreObserverTimer) clearTimeout(this.loadMoreObserverTimer);
      this.loadMoreObserverTimer = null;
      if (this.loadMoreObserver) this.loadMoreObserver.disconnect();
      this.loadMoreObserver = null;
    }
  },

  methods: {
    handleSort(event) {
      const key = event.currentTarget.dataset.key;
      if (!allowAction(this, `sort:${key}`)) return;
      if (key) this.triggerEvent('sort', { key });
    },

    handleSelect(event) {
      const fund = this.data.rows[Number(event.currentTarget.dataset.index)];
      if (!fund || !allowAction(this, `select:${fund.code}`)) return;
      this.triggerEvent('select', { fund });
    },

    handleFavorite(event) {
      const fund = this.data.rows[Number(event.currentTarget.dataset.index)];
      if (!fund || !allowAction(this, `favorite:${fund.code}`)) return;
      this.triggerEvent('togglefavorite', { fund });
    },

    handleLoadMore(event) {
      if (event && event.type === 'tap' && !allowAction(this, 'load-more')) return;
      this.requestLoadMore();
    },

    handleRefresh() {
      if (this.data.refreshing || !allowAction(this, 'refresh')) return;
      this.resetInlineScroll();
      this.triggerEvent('refresh');
    },

    handleTableScroll(event) {
      const scrollTop = Number(event.detail && event.detail.scrollTop || 0);
      const internalShowBackTop = scrollTop > 220;
      const scrollHeight = Number(event.detail && event.detail.scrollHeight || 0);
      this.currentScrollTop = scrollTop;
      if (internalShowBackTop !== this.data.internalShowBackTop) this.setData({ internalShowBackTop });
      if (scrollHeight && this.tableViewportHeight && scrollHeight - scrollTop - this.tableViewportHeight < 240) {
        this.requestLoadMore();
      }
    },

    scrollTableToTop() {
      if (!allowAction(this, 'back-top')) return;
      this.resetInlineScroll();
    },

    resetInlineScroll() {
      this.setData({ scrollIntoView: '' }, () => {
        this.setData({ scrollIntoView: 'table-body-top', internalShowBackTop: false });
      });
    },

    measureScrollViewport() {
      if (!this.createSelectorQuery) return;
      this.createSelectorQuery().select('.table-scroll').boundingClientRect((rect) => {
        this.tableViewportHeight = Number(rect && rect.height || 0);
      }).exec();
    },

    requestLoadMore() {
      if (!this.data.hasMore || this.data.loading || this.data.loadingMore || this.loadMoreLocked) return;
      this.loadMoreLocked = true;
      if (this.loadMoreObserver) this.loadMoreObserver.disconnect();
      this.loadMoreObserver = null;
      this.triggerEvent('loadmore');
    },

    queueLoadMoreObserver() {
      if (this.loadMoreObserverTimer) clearTimeout(this.loadMoreObserverTimer);
      this.loadMoreObserverTimer = setTimeout(() => {
        this.loadMoreObserverTimer = null;
        if (this.loadMoreObserver) this.loadMoreObserver.disconnect();
        if (!this.data.hasMore || this.data.loading || this.data.loadingMore || !this.createIntersectionObserver) return;
        this.loadMoreObserver = this.createIntersectionObserver({ thresholds: [0] })
          .relativeTo('.table-scroll');
        this.loadMoreObserver.observe('.load-more-sentinel', (result) => {
          const intersectionHeight = Number(result && result.intersectionRect && result.intersectionRect.height || 0);
          if (Number(result && result.intersectionRatio || 0) > 0 || intersectionHeight > 0) this.requestLoadMore();
        });
      }, 0);
    }
  }
});
