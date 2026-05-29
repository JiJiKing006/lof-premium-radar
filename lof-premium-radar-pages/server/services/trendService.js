const MAX_POINTS = 80;
const series = new Map();

export function attachIntraday(rows) {
  for (const row of rows) {
    if (!row.code || !Number.isFinite(Number(row.marketPrice))) {
      row.intraday = [];
      continue;
    }
    const key = `${row.code}:${String(row.quoteTime || '').slice(0, 10) || 'latest'}`;
    const list = series.get(key) || [];
    const point = {
      time: row.quoteTime || row.updateTime,
      price: Number(row.marketPrice),
    };
    const last = list.at(-1);
    if (!last || last.time !== point.time || last.price !== point.price) {
      list.push(point);
    }
    const trimmed = list.slice(-MAX_POINTS);
    series.set(key, trimmed);
    row.intraday = trimmed.length > 1 ? trimmed : seedFlat(point);
  }
  return rows;
}

function seedFlat(point) {
  return [
    { ...point, time: `${point.time || ''}-start` },
    point,
  ];
}
