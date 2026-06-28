const CONFIG = require('../config/mp');
const VISITOR_DEVICE_KEY = 'lof-visitor-device-id';

function getOrCreateDeviceId() {
  const existing = wx.getStorageSync(VISITOR_DEVICE_KEY);
  if (existing) return existing;
  const next = createDeviceId();
  wx.setStorageSync(VISITOR_DEVICE_KEY, next);
  return next;
}

function createDeviceId() {
  return `visitor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function recordVisitor(deviceId, path, project) {
  return new Promise((resolve) => {
    wx.request({
      url: `${String(CONFIG.apiBaseUrl).replace(/\/$/, '')}/api/analytics/visit`,
      method: 'POST',
      data: { deviceId, path, project },
      timeout: 5000,
      success: resolve,
      fail: resolve
    });
  });
}

module.exports = { getOrCreateDeviceId, recordVisitor };
