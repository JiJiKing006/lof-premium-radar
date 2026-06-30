Component({
  properties: {
    value: { type: String, value: 'T+2' }
  },

  data: {
    filters: [
      { key: 'WATCH', label: '收藏' },
      { key: 'T+2', label: '延2天' },
      { key: 'T+3', label: '延3天' }
    ]
  },

  methods: {
    handleTap(event) {
      this.triggerEvent('change', { value: event.currentTarget.dataset.key });
    }
  }
});
