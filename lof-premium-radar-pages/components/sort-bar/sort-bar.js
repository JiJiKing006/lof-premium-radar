Component({
  properties: {
    value: { type: Boolean, value: false }
  },

  methods: {
    handleTap() {
      this.triggerEvent('change', { value: !this.data.value });
    }
  }
});
