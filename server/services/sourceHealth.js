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
  const names = ['palmmicro', 'haoetf', 'eastmoney', 'eastmoney-index', 'eastmoney-trend', 'eastmoney-history-nav', 'eastmoney-history-price', 'tiantian-subscription', 'sina', 'akshare', 'tiantian', 'jisilu', 'lof', 'cache'];
  return Object.fromEntries(names.map((name) => [name, health.get(name) || { ok: false, latency: null, lastSuccessTime: '', error: '尚未请求' }]));
}

export function formatShanghaiTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')}`;
}
