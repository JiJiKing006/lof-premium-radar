Component({
  properties: {
    meta: { type: Object, value: null },
    paused: { type: Boolean, value: false },
    error: { type: String, value: '' },
    lastSuccessAt: { type: String, value: '' },
    abnormalCount: { type: Number, value: 0 },
    nextRefreshIn: { type: Number, optionalTypes: [String], value: 30 }
  },

  observers: {
    'meta, paused, error, lastSuccessAt, abnormalCount, nextRefreshIn': function updateText() {
      const meta = this.data.meta || {};
      const timeText = meta.updateTime || meta.latestQuoteTime || this.data.lastSuccessAt || '暂无数据';
      const refreshText = this.data.paused
        ? '自动更新暂停'
        : typeof this.data.nextRefreshIn === 'number'
          ? `${this.data.nextRefreshIn}秒后自动更新`
          : '自动更新';
      const warning = Boolean(meta.stale || this.data.error || this.data.abnormalCount > 0);
      this.setData({ timeText, refreshText, warning });
    }
  },

  data: {
    timeText: '暂无数据',
    refreshText: '自动更新',
    warning: false
  }
});
