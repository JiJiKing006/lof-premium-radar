const health = new Map();

export function recordSourceSuccess(source, latency) {
  health.set(source, {
    ok: true,
    latency,
    lastSuccessTime: formatShanghaiTime(new Date()),
    error: '',
  });
}

export function recordSourceFailure(source, error, latency = null) {
  const previous = health.get(source) || {};
  health.set(source, {
    ok: false,
    latency,
    lastSuccessTime: previous.lastSuccessTime || '',
    error: error?.message || String(error || '数据源失败'),
  });
}

export function getDataSourceHealth() {
  const names = ['palmmicro', 'haoetf', 'eastmoney', 'eastmoney-index', 'eastmoney-trend', 'eastmoney-history-nav', 'eastmoney-history-price', 'tiantian-subscription', 'sse-share', 'szse-share', 'sina', 'akshare', 'tiantian', 'jisilu', 'lof', 'cache'];
  return Object.fromEntries(names.map((name) => [name, health.get(name) || { ok: false, latency: null, lastSuccessTime: '', error: '尚未请求' }]));
}

export function formatShanghaiTime(date = new Date()) {
  const shanghai = new Date(date.getTime() + 8 * 60 * 60_000);
  return `${shanghai.toISOString().slice(0, 10)} ${shanghai.toISOString().slice(11, 19)}`;
}
