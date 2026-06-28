const CONFIG = require('../config/mp');

function apiBaseUrl() {
  const devBaseUrl = developmentApiBaseUrl();
  if (devBaseUrl) return devBaseUrl.replace(/\/$/, '');
  const stored = wx.getStorageSync('apiBaseUrl');
  return String(stored || defaultApiBaseUrl() || '').replace(/\/$/, '');
}

function defaultApiBaseUrl() {
  return CONFIG.apiBaseUrl;
}

function developmentApiBaseUrl() {
  try {
    const envVersion = wx.getAccountInfoSync && wx.getAccountInfoSync().miniProgram.envVersion;
    if (envVersion && envVersion !== 'release' && CONFIG.devApiBaseUrl) return CONFIG.devApiBaseUrl;
  } catch (error) {
    // Some DevTools runtimes do not expose account info.
  }
  try {
    const systemInfo = wx.getSystemInfoSync && wx.getSystemInfoSync();
    if (systemInfo && isDevtoolsRuntime(systemInfo) && CONFIG.devApiBaseUrl) return CONFIG.devApiBaseUrl;
  } catch (error) {
    // Fall back to the release API outside the local development runtime.
  }
  try {
    if (typeof __wxConfig !== 'undefined' && isDevtoolsRuntime(__wxConfig) && CONFIG.devApiBaseUrl) return CONFIG.devApiBaseUrl;
  } catch (error) {
    // Fall back to the release API outside the local development runtime.
  }
  return '';
}

function isDevtoolsRuntime(info) {
  const host = info.host && typeof info.host === 'object' ? info.host : {};
  const text = [
    info.platform,
    info.environment,
    info.brand,
    info.model,
    host.env,
    host.platform,
    info.envVersion
  ].filter(Boolean).join(' ');
  return /devtools|wechatdevtools|开发者工具/i.test(text);
}

function requestJson(path, data, options = {}) {
  const url = `${apiBaseUrl()}${path}`;
  const timeout = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 10000;
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'GET',
      data,
      timeout,
      header: { Accept: 'application/json' },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data);
          return;
        }
        reject(new Error(`接口返回 ${response.statusCode}`));
      },
      fail(error) {
        const message = error && error.errMsg ? error.errMsg : '接口请求失败';
        reject(new Error(/timeout/i.test(message) ? (options.timeoutMessage || '接口请求超时，请重试') : message));
      }
    });
  });
}

module.exports = { requestJson };
