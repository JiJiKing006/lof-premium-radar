Component({
  properties: {
    value: { type: String, value: 'T+2' }
  },

  data: {
    filters: [
      { key: 'WATCH', label: '自选' },
      { key: 'T+2', label: 'T+2' },
      { key: 'T+3', label: 'T+3' }
    ]
  },

  methods: {
    handleTap(event) {
      this.triggerEvent('change', { value: event.currentTarget.dataset.key });
    }
  }
});
