function sourceLabel(source) {
  const raw = String(source || '').trim();
  const text = raw.toLowerCase();
  if (!raw) return '';
  if (text.includes('eastmoney')) return '东方财富';
  if (text.includes('tiantian')) return '天天基金';
  if (text.includes('jisilu')) return '集思录';
  if (text.includes('haoetf')) return 'HaoETF';
  if (text.includes('palmmicro') || text === 'lof') return 'Palmmicro';
  if (text === 'quote-missing') return '暂无行情';
  if (text.includes('sina')) return '新浪财经';
  if (text.includes('akshare')) return 'AkShare';
  if (text === 'sse' || text.includes('sse-share')) return '上交所';
  if (text === 'szse' || text.includes('szse-share')) return '深交所';
  if (text === 'cache') return '缓存';
  if (text === 'internal') return '内部聚合';
  return raw;
}

module.exports = { sourceLabel };
