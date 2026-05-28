export async function fetchAkshareQuotes() {
  if (!process.env.AKSHARE_BASE_URL) {
    throw new Error('AKSHARE_BASE_URL 未配置');
  }

  const response = await fetch(`${process.env.AKSHARE_BASE_URL.replace(/\/$/, '')}/fund/quotes`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`AKShare 返回 ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows.length) throw new Error('AKShare 返回空数组');

  // TODO: 根据实际 AKShare HTTP 封装字段补充映射。目前仅支持已统一格式的内部 AKShare 网关。
  return rows.map((row) => ({ ...row, source: 'akshare', sourceStatus: 'fallback' }));
}
