import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseNumber } from '../utils/number.js';

const MAX_POINTS_PER_DAY = 260;

export class IntradaySeries {
  constructor({ cwd }) {
    this.file = path.join(cwd, '.cache', 'intraday-series.json');
    this.series = {};
  }

  async load() {
    try {
      this.series = JSON.parse(await readFile(this.file, 'utf8'));
    } catch {
      this.series = {};
    }
  }

  merge(rows) {
    for (const row of rows) {
      const price = parseNumber(row.price);
      if (price === null || !row.code) continue;
      const quoteDate = row.quoteDate || new Date().toISOString().slice(0, 10);
      const quoteTime = row.quoteTime || new Date().toTimeString().slice(0, 5);
      const key = `${row.code}:${quoteDate}`;
      const list = this.series[key] || [];
      const last = list.at(-1);

      if (!last || last.time !== quoteTime || last.price !== price) {
        list.push({ time: quoteTime, price, at: new Date().toISOString() });
      }

      this.series[key] = list.slice(-MAX_POINTS_PER_DAY);
      row.intraday = this.series[key];
    }

    return rows;
  }

  attach(rows) {
    for (const row of rows) {
      const quoteDate = row.quoteDate || new Date().toISOString().slice(0, 10);
      row.intraday = this.series[`${row.code}:${quoteDate}`] || seedFromHistory(row);
    }
    return rows;
  }

  async save() {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.series, null, 2));
  }
}

function seedFromHistory(row) {
  const historyTable = row.detail?.tables?.find((table) => /历史价格/.test(table.title || '') || /fundhistorytable/.test(table.id || ''));
  const points = (historyTable?.rows || [])
    .slice()
    .reverse()
    .map((item) => ({ time: item[0], price: parseNumber(item[1]) }))
    .filter((item) => item.price !== null);

  if (parseNumber(row.price) !== null && row.quoteTime) {
    points.push({ time: row.quoteTime, price: parseNumber(row.price) });
  }

  return points.slice(-MAX_POINTS_PER_DAY);
}
