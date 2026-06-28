const COLUMN_RULES = {
  favorite: { width: 72 },
  security: { min: 220, preferred: 238, max: 286 },
  premiumRate: { min: 176, preferred: 184, max: 216 },
  price: { min: 120, preferred: 126, max: 146 },
  changeRate: { min: 132, preferred: 136, max: 154 },
  lastNav: { min: 198, preferred: 208, max: 242 },
  estimatedNav: { min: 198, preferred: 210, max: 244 }
};

function buildColumns(showEstimatedNav, rows = []) {
  const securityWidth = estimateSecurityColumnWidth(rows);
  const columns = [
    buildColumn('favorite', '自选', COLUMN_RULES.favorite.width, { disabled: true }),
    buildColumn('security', '名称/代码', securityWidth, { disabled: true }),
    buildColumn('premiumRate', '实时溢价率', COLUMN_RULES.premiumRate.preferred),
    buildColumn('price', '现价', COLUMN_RULES.price.preferred),
    buildColumn('changeRate', '涨跌幅', COLUMN_RULES.changeRate.preferred),
    buildColumn('lastNav', '官方净值', COLUMN_RULES.lastNav.preferred)
  ];
  if (showEstimatedNav) columns.push(buildColumn('estimatedNav', '估算净值', COLUMN_RULES.estimatedNav.preferred));
  return columns;
}

function buildColumn(key, title, width, options = {}) {
  const roundedWidth = Math.round(width);
  return Object.assign({
    key,
    title,
    width: roundedWidth,
    style: `width:${roundedWidth}rpx;flex-basis:${roundedWidth}rpx;`
  }, options);
}

function estimateSecurityColumnWidth(rows) {
  const labels = (Array.isArray(rows) ? rows : [])
    .map((row) => [row && row.name, row && row.code].filter(Boolean).join(' '));
  if (!labels.length) return COLUMN_RULES.security.preferred;
  const weights = labels.map(visibleTextWeight).sort((a, b) => a - b);
  const p80 = weights[Math.min(weights.length - 1, Math.floor(weights.length * 0.8))] || 0;
  const width = 186 + p80 * 4.8;
  return clamp(width, COLUMN_RULES.security.min, COLUMN_RULES.security.max);
}

function visibleTextWeight(value) {
  return Array.from(String(value || '')).reduce((total, char) => {
    if (/[\u3400-\u9fff]/u.test(char)) return total + 1;
    if (/[0-9]/u.test(char)) return total + 0.58;
    return total + 0.68;
  }, 0);
}

function clamp(value, min, max) {
  return Math.round(Math.min(max, Math.max(min, value)));
}

function buildGridStyle(columns) {
  const totalWidth = columns.reduce((sum, column) => sum + Number(column.width || 0), 0);
  const width = Math.max(1030, totalWidth);
  return `width:${width}rpx;min-width:${width}rpx;`;
}

function buildColumnStyles(columns) {
  return columns.reduce((styles, column) => {
    styles[column.key] = column.style;
    return styles;
  }, {});
}

Component({
  properties: {
    rows: { type: Array, value: [] },
    loading: { type: Boolean, value: false },
    sortKey: { type: String, value: 'premiumRate' },
    sortDirection: { type: String, value: 'desc' },
    favoriteCodes: { type: Array, value: [] },
    pulseCode: { type: String, value: '' },
    dataVersion: { type: String, value: '' },
    totalCount: { type: Number, value: 0 },
    hasMore: { type: Boolean, value: false },
    loadingMore: { type: Boolean, value: false },
    resetToken: { type: Number, value: 0 },
    updateTime: { type: String, value: '' },
    showBackTop: { type: Boolean, value: false },
    showEstimatedNav: { type: Boolean, value: true }
  },

  data: {
    hasScrollable: false,
    tableScrollLeft: 0,
    tableScrollTop: 0,
    horizontalScrolled: false,
    internalShowBackTop: false,
    skeletonRows: Array.from({ length: 10 }, (_, index) => index),
    columns: buildColumns(true),
    columnStyles: buildColumnStyles(buildColumns(true)),
    gridStyle: buildGridStyle(buildColumns(true))
  },

  observers: {
    rows(rows) {
      this.refreshColumns({ rows });
      this.queueLoadMoreObserver();
    },

    showEstimatedNav(value) {
      this.refreshColumns({ showEstimatedNav: value });
    },

    resetToken() {
      this.resetInlineScroll();
    },

    hasMore() {
      this.queueLoadMoreObserver();
    },

    loadingMore(value) {
      if (!value) this.loadMoreLocked = false;
      this.queueLoadMoreObserver();
    }
  },

  lifetimes: {
    ready() {
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
      if (key) this.triggerEvent('sort', { key });
    },

    handleSelect(event) {
      const index = Number(event.currentTarget.dataset.index);
      const fund = this.data.rows[index];
      this.triggerEvent('select', { fund });
    },

    handleFavorite(event) {
      const index = Number(event.currentTarget.dataset.index);
      const fund = this.data.rows[index];
      this.triggerEvent('togglefavorite', { fund });
    },

    handleLoadMore() {
      this.requestLoadMore();
    },

    handleTableScroll(event) {
      const scrollLeft = Number(event.detail && event.detail.scrollLeft || 0);
      const scrollTop = Number(event.detail && event.detail.scrollTop || 0);
      const horizontalScrolled = scrollLeft > 1;
      const internalShowBackTop = scrollTop > 220;
      const patch = {};
      if (Math.abs(scrollTop - this.data.tableScrollTop) > 8) patch.tableScrollTop = scrollTop;
      if (horizontalScrolled !== this.data.horizontalScrolled) patch.horizontalScrolled = horizontalScrolled;
      if (internalShowBackTop !== this.data.internalShowBackTop) patch.internalShowBackTop = internalShowBackTop;
      if (Object.keys(patch).length) this.setData(patch);
    },

    scrollTableToTop() {
      this.resetInlineScroll();
    },

    refreshColumns(options = {}) {
      const rows = Array.isArray(options.rows) ? options.rows : this.data.rows;
      const showEstimatedNav = Object.prototype.hasOwnProperty.call(options, 'showEstimatedNav')
        ? options.showEstimatedNav
        : this.data.showEstimatedNav;
      const columns = buildColumns(showEstimatedNav !== false, rows);
      this.setData({
        hasScrollable: Array.isArray(rows) && rows.length > 12,
        columns,
        columnStyles: buildColumnStyles(columns),
        gridStyle: buildGridStyle(columns)
      });
    },

    resetInlineScroll() {
      this.setData({
        tableScrollLeft: 0,
        tableScrollTop: 0,
        horizontalScrolled: false,
        internalShowBackTop: false
      });
    },

    requestLoadMore() {
      if (!this.data.hasMore || this.data.loading || this.data.loadingMore || this.loadMoreLocked) return;
      this.loadMoreLocked = true;
      this.triggerEvent('loadmore');
    },

    queueLoadMoreObserver() {
      if (this.loadMoreObserverTimer) clearTimeout(this.loadMoreObserverTimer);
      this.loadMoreObserverTimer = setTimeout(() => {
        this.loadMoreObserverTimer = null;
        if (this.loadMoreObserver) this.loadMoreObserver.disconnect();
        if (!this.data.hasMore || this.data.loading || this.data.loadingMore || !this.createIntersectionObserver) return;
        this.loadMoreObserver = this.createIntersectionObserver({ thresholds: [0, 0.01] })
          .relativeTo('.table-scroll');
        this.loadMoreObserver.observe('.load-more-sentinel', (result) => {
          if (Number(result && result.intersectionRatio || 0) > 0) this.requestLoadMore();
        });
      }, 0);
    }
  }
});
