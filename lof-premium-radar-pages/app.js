const CONFIG = require('./config/mp');

App({
  globalData: {
    apiBaseUrl: CONFIG.apiBaseUrl
  },

  onLaunch() {
    if (CONFIG.apiBaseUrl) {
      wx.setStorageSync('apiBaseUrl', CONFIG.apiBaseUrl);
    }
  }
});
