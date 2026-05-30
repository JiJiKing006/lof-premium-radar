import { getFundQuotes } from './fundAggregator.js';
import { getFundHistory } from './fundHistoryService.js';

const DEFAULT_LIMIT = 20;
const MIN_ABS_PREMIUM = 0.8;
const MIN_AMOUNT = 3_000_000;
const MAX_QUOTE_AGE_MS = 10 * 60_000;

export async function getHotArbitrageList({ category = 'ALL', limit = DEFAULT_LIMIT, force = false, now = new Date() } = {}) {
  const snapshot = await getFundQuotes({ category, force, includeTrends: false });
  const currentTime = now instanceof Date ? now : new Date(now);
  const rows = snapshot.rows.filter((row) => isEligible(row, currentTime));
  const activityScores = buildActivityScoreMap(snapshot.rows);
  const enrichedRows = await Promise.all(rows.map((row) => enrichWithAvgAmount(row, { force })));
  const scoredRows = calculateHotArbitrageRows(enrichedRows, {
    activityScores,
    now: currentTime,
  })
    .sort((left, right) => right.hotScore - left.hotScore)
    .slice(0, normalizeLimit(limit));

  return {
    meta: {
      sourceId: 'hot-arbitrage',
      sourceTitle: '热门套利观察',
      sourceProvider: snapshot.meta.sourceProvider,
      rowCount: scoredRows.length,
      allCount: rows.length,
      updateTime: snapshot.meta.updateTime,
      latestQuoteTime: snapshot.meta.latestQuoteTime,
      sourceStatus: snapshot.meta.sourceStatus,
      stale: snapshot.meta.stale,
      status: 'ok',
      scoring: 'premium + activity + freshness + optional avgAmount5d anomaly',
    },
    rows: scoredRows.map((row, index) => ({
      ...row,
      rank: index + 1,
    })),
  };
}

export function calculateHotArbitrageRows(rows, { activityScores = new Map(), now = new Date() } = {}) {
  return rows
    .filter((row) => isEligible(row, now))
    .map((row) => {
      const amount = amountValue(row);
      const absPremium = Math.abs(Number(row.premiumRate));
      const arbitrageSpaceScore = scoreArbitrageSpace(absPremium);
      const activityScore = activityScores.get(row.code) ?? scoreActivityByPeerRank(row.activityRankPercentile);
      const freshnessScore = scoreFreshness(quoteAgeMs(row.quoteTime, now));
      const avgAmount5d = positiveNumber(row.avgAmount5d);
      const volumeRatio = avgAmount5d ? amount / avgAmount5d : null;
      const anomalyScore = volumeRatio ? scoreAnomaly(volumeRatio) : null;
      const hotScore = anomalyScore === null
        ? arbitrageSpaceScore * 0.5 + activityScore * 0.4 + freshnessScore * 0.1
        : arbitrageSpaceScore * 0.4 + activityScore * 0.35 + anomalyScore * 0.15 + freshnessScore * 0.1;

      return {
        code: row.code,
        name: row.name,
        type: row.category || row.type,
        marketPrice: row.marketPrice ?? row.price ?? null,
        lastNav: row.lastNav ?? row.nav ?? null,
        estimatedNav: row.estimatedNav ?? row.estimatedValue ?? null,
        premiumRate: Number(row.premiumRate),
        premiumDirection: Number(row.premiumRate) >= 0 ? 'premium' : 'discount',
        amount,
        turnover: amount,
        volume: positiveNumber(row.volume),
        avgAmount5d,
        volumeRatio,
        hotScore: roundScore(hotScore),
        arbitrageSpaceScore,
        activityScore,
        anomalyScore,
        freshnessScore,
        quoteTime: row.quoteTime || '',
        updateTime: row.updateTime || row.quoteTime || '',
        source: row.source || '',
        quoteSource: row.quoteSource || row.source || '',
      };
    });
}

export function scoreArbitrageSpace(absPremium) {
  const value = Math.abs(Number(absPremium));
  if (!Number.isFinite(value) || value < 0.5) return 0;
  if (value < 1) return 30;
  if (value < 2) return 60;
  if (value <= 5) return 85;
  return 100;
}

export function scoreActivityByPeerRank(rankPercentile) {
  const value = Number(rankPercentile);
  if (!Number.isFinite(value) || value <= 0) return 20;
  if (value <= 0.1) return 100;
  if (value <= 0.2) return 85;
  if (value <= 0.4) return 65;
  if (value <= 0.6) return 40;
  return 20;
}

export function scoreAnomaly(volumeRatio) {
  const value = Number(volumeRatio);
  if (!Number.isFinite(value) || value < 1) return 20;
  if (value < 1.5) return 50;
  if (value < 2) return 75;
  return 100;
}

export function scoreFreshness(ageMs) {
  const age = Number(ageMs);
  if (!Number.isFinite(age) || age < 0) return 0;
  if (age <= 60_000) return 100;
  if (age <= 3 * 60_000) return 80;
  if (age <= 10 * 60_000) return 50;
  if (age <= 30 * 60_000) return 20;
  return 0;
}

function buildActivityScoreMap(rows) {
  const scoreMap = new Map();
  const groups = new Map();

  for (const row of rows) {
    const type = String(row.category || row.type || 'UNKNOWN').toUpperCase();
    const amount = amountValue(row);
    if (!amount) continue;
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push({ code: row.code, amount });
  }

  for (const peers of groups.values()) {
    peers.sort((left, right) => right.amount - left.amount);
    const total = peers.length;
    peers.forEach((peer, index) => {
      scoreMap.set(peer.code, scoreActivityByPeerRank((index + 1) / total));
    });
  }

  return scoreMap;
}

async function enrichWithAvgAmount(row, { force }) {
  try {
    const history = await getFundHistory(row.code, { limit: 8, force });
    const amounts = (history.rows || [])
      .map((item) => positiveNumber(item.turnover))
      .filter(Boolean)
      .slice(0, 5);
    if (amounts.length < 5) return row;
    const avgAmount5d = amounts.reduce((sum, value) => sum + value, 0) / amounts.length;
    return { ...row, avgAmount5d };
  } catch {
    return row;
  }
}

function isEligible(row, now) {
  const premium = Number(row.premiumRate);
  const amount = amountValue(row);
  const price = positiveNumber(row.marketPrice ?? row.price);
  const nav = positiveNumber(row.lastNav ?? row.nav ?? row.estimatedNav ?? row.estimatedValue);
  if (!Number.isFinite(premium) || Math.abs(premium) < MIN_ABS_PREMIUM) return false;
  if (!amount || amount < MIN_AMOUNT) return false;
  if (!price || !nav) return false;
  if (quoteAgeMs(row.quoteTime, now) > MAX_QUOTE_AGE_MS) return false;
  if (isSuspended(row)) return false;
  return true;
}

function isSuspended(row) {
  const text = [
    row.tradingStatus,
    row.status,
    row.abnormalReason,
    row.raw?.tradingStatus,
    row.raw?.status,
  ].filter(Boolean).join(' ');
  return /停牌|暂停交易|停市/i.test(text);
}

function quoteAgeMs(quoteTime, now) {
  const time = parseQuoteTime(quoteTime);
  const current = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(time) || !Number.isFinite(current)) return Number.POSITIVE_INFINITY;
  return Math.max(0, current - time);
}

function parseQuoteTime(value) {
  const text = String(value || '').trim();
  if (!text) return NaN;
  const normalized = text.includes('T') ? text : text.replace(' ', 'T');
  const withTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}+08:00`;
  return new Date(withTimezone).getTime();
}

function amountValue(row) {
  return positiveNumber(row.turnover ?? row.amount);
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function roundScore(value) {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function normalizeLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_LIMIT;
  return Math.min(20, Math.max(1, Math.floor(number)));
}
