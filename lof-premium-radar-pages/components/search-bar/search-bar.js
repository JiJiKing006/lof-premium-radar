Component({
  properties: {
    value: { type: String, value: '' }
  },

  methods: {
    handleInput(event) {
      this.triggerEvent('change', { value: event.detail.value });
    }
  }
});
