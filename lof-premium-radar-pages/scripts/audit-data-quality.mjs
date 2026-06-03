import { getFundQuotes } from '../server/services/fundAggregator.js';
import { getFundHistory } from '../server/services/fundHistoryService.js';
import { fetchLofSnapshot } from '../server/sources/lofProvider.js';

const categories = process.argv.includes('--all') ? ['LOF', 'QDII', 'ETF'] : ['LOF'];
const force = process.argv.includes('--force');
const historyLimit = numberArg('--history-limit', 20);

const fieldChecks = [
  ['marketPrice', '现价'],
  ['lastNav', '官方净值'],
  ['premiumRate', '溢价率'],
];

const historyChecks = [
  ['premiumRate', '历史溢价率'],
  ['changeRate', '场内涨幅'],
  ['turnover', '成交额'],
];

const report = {
  checkedAt: new Date().toISOString(),
  categories: {},
  totals: {
    rows: 0,
    homeIssues: 0,
    historyIssues: 0,
  },
};

for (const category of categories) {
  const snapshot = await getFundQuotes({ category, force, includeTrends: false });
  const estimateAvailability = await getEstimateAvailability(category);
  const homeIssues = snapshot.rows.flatMap((row) => auditHomeRow(row, estimateAvailability));
  const unavailableEstimates = snapshot.rows
    .filter((row) => !hasValue(row.estimatedNav) && !estimateAvailability.get(normalizeCode(row.code))?.hasEstimatedNav)
    .map((row) => ({
      code: row.code,
      name: row.name,
      field: 'estimatedNav',
      label: '估算净值',
      status: 'source_unavailable',
      navSource: row.navSource || '',
      navQuoteTime: row.navQuoteTime || '',
    }));
  const historyIssues = [];

  for (const row of snapshot.rows) {
    const history = await getFundHistory(row.code, { limit: historyLimit, force });
    const latestRows = (history.rows || []).slice(0, Math.min(5, historyLimit));
    for (const item of latestRows) {
      for (const [field, label] of historyChecks) {
        if (!hasValue(item[field])) {
          historyIssues.push({
            code: row.code,
            name: row.name,
            field,
            label,
            date: item.date,
            priceSource: history.meta?.priceSource || '',
            sourceProvider: history.meta?.sourceProvider || '',
          });
        }
      }
    }
  }

  report.categories[category] = {
    meta: snapshot.meta,
    rowCount: snapshot.rows.length,
    homeIssues,
    unavailableEstimates,
    historyIssues,
  };
  report.totals.rows += snapshot.rows.length;
  report.totals.homeIssues += homeIssues.length;
  report.totals.historyIssues += historyIssues.length;
}

console.log(JSON.stringify(report, null, 2));

async function getEstimateAvailability(category) {
  if (category !== 'LOF') return new Map();

  try {
    const snapshot = await fetchLofSnapshot();
    return new Map((snapshot.rows || []).map((row) => [
      normalizeCode(row.code),
      {
        hasEstimatedNav: hasValue(firstValue(
          row.realtimeEstValue,
          row.realtimeEst,
          row.referenceEstValue,
          row.referenceEst,
          row.officialEstValue,
          row.officialEst,
        )),
        source: 'lof',
      },
    ]));
  } catch {
    return new Map();
  }
}

function auditHomeRow(row, estimateAvailability) {
  const issues = fieldChecks
    .filter(([field]) => !hasValue(row[field]))
    .map(([field, label]) => ({
      code: row.code,
      name: row.name,
      field,
      label,
      source: row.source || '',
      quoteSource: row.quoteSource || '',
      navSource: row.navSource || '',
      sourceStatus: row.sourceStatus || '',
      dataStatus: row.dataStatus || '',
      quoteTime: row.quoteTime || '',
      navQuoteTime: row.navQuoteTime || '',
      updateTime: row.updateTime || '',
    }));

  const expectedEstimate = estimateAvailability.get(normalizeCode(row.code));
  if (!hasValue(row.estimatedNav) && expectedEstimate?.hasEstimatedNav) {
    issues.push({
      code: row.code,
      name: row.name,
      field: 'estimatedNav',
      label: '估算净值',
      source: row.source || '',
      quoteSource: row.quoteSource || '',
      navSource: row.navSource || '',
      expectedSource: expectedEstimate.source,
      sourceStatus: row.sourceStatus || '',
      dataStatus: row.dataStatus || '',
      quoteTime: row.quoteTime || '',
      navQuoteTime: row.navQuoteTime || '',
      updateTime: row.updateTime || '',
    });
  }

  return issues;
}

function hasValue(value) {
  if (value === null || value === undefined || value === '') return false;
  const number = Number(value);
  return typeof value === 'number' ? Number.isFinite(number) : true;
}

function numberArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function firstValue(...values) {
  for (const value of values) {
    if (hasValue(value)) return value;
  }
  return null;
}

function normalizeCode(code) {
  return String(code || '').replace(/^(SZ|SH)/i, '').trim();
}
