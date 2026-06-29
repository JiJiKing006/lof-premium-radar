Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: '加载中' },
    note: { type: String, value: '请稍候' }
  },

  methods: {
    preventClose() {
    }
  }
});
