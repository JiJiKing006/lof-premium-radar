const { postJson } = require('./request');

function registerSubscription(options = {}) {
  return login().then((code) => postJson('/api/subscriptions/register', {
    code,
    testMode: options.testMode ? 'develop' : ''
  }, {
    timeoutMs: 10000
  }));
}

function getSubscriptionStatus() {
  return login().then((code) => postJson('/api/subscriptions/status', { code }, {
    timeoutMs: 10000,
    showLoading: false
  }));
}

function cancelSubscription() {
  return login().then((code) => postJson('/api/subscriptions/cancel', { code }, { timeoutMs: 10000 }));
}

function login() {
  return new Promise((resolve, reject) => {
    wx.login({
      timeout: 8000,
      success(result) {
        if (result && result.code) resolve(result.code);
        else reject(new Error('微信登录未返回临时 code'));
      },
      fail(error) { reject(new Error(error && error.errMsg || '微信登录失败')); }
    });
  });
}

module.exports = { registerSubscription, getSubscriptionStatus, cancelSubscription };
