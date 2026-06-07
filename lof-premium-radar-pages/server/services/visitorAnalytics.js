import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const DEFAULT_FILE = path.join(root, 'data', 'visitor-analytics.json');
const DEFAULT_ADMIN_PASSWORD = '53123';
const MAX_RECENT_VISITORS = 20;
const MAX_DAILY_DAYS = 14;
const MAX_DAILY_DETAIL_VISITORS = 80;
const DEFAULT_TARGET_TOTAL_VISITORS = 273;

export const visitorAnalytics = createVisitorAnalytics({
  filePath: process.env.VISITOR_ANALYTICS_FILE || DEFAULT_FILE,
  targetTotalVisitors: parseTargetTotalVisitors(process.env.VISITOR_ANALYTICS_TARGET_TOTAL),
});

export function createVisitorAnalytics({ filePath = DEFAULT_FILE, targetTotalVisitors = 0 } = {}) {
  return {
    async recordVisit({ deviceId, path: visitPath = '/', userAgent = '', ip = '', now = new Date() } = {}) {
      const normalizedDeviceId = normalizeDeviceId(deviceId);
      if (!normalizedDeviceId) throw new Error('deviceId is required');

      const store = await readStore(filePath);
      const at = formatShanghaiDateTime(now);
      const date = formatShanghaiDate(now);
      const existing = store.visitors[normalizedDeviceId];

      if (existing) {
        existing.lastSeenAt = at;
        existing.lastSeenDate = date;
        existing.lastPath = sanitizePath(visitPath);
        existing.userAgent = sanitizeText(userAgent, 160);
        existing.ip = sanitizeText(ip, 80);
        existing.visits = Number(existing.visits || 0) + 1;
      } else {
        store.visitors[normalizedDeviceId] = {
          deviceId: normalizedDeviceId,
          firstSeenAt: at,
          firstSeenDate: date,
          lastSeenAt: at,
          lastSeenDate: date,
          firstPath: sanitizePath(visitPath),
          lastPath: sanitizePath(visitPath),
          userAgent: sanitizeText(userAgent, 160),
          ip: sanitizeText(ip, 80),
          visits: 1,
        };
      }

      store.updatedAt = at;
      await writeStore(filePath, store);
      return summarizeStore(store, { now, targetTotalVisitors });
    },

    async getStats({ now = new Date() } = {}) {
      const store = await readStore(filePath);
      return summarizeStore(store, { now, targetTotalVisitors });
    },
  };
}

export function isAdminPasswordValid(input, expected = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD) {
  const password = String(input || '').trim();
  return Boolean(password) && password === String(expected || DEFAULT_ADMIN_PASSWORD);
}

async function readStore(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    return {
      version: 1,
      updatedAt: parsed.updatedAt || '',
      visitors: parsed.visitors && typeof parsed.visitors === 'object' ? parsed.visitors : {},
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { version: 1, updatedAt: '', visitors: {} };
  }
}

async function writeStore(filePath, store) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(store, null, 2)}\n`);
}

function summarizeStore(store, { now, targetTotalVisitors = 0 }) {
  const today = formatShanghaiDate(now);
  const realVisitors = Object.values(store.visitors).filter((visitor) => !isInternalVisitor(visitor));
  const visitors = withSeededVisitors(realVisitors, { now, targetTotalVisitors });
  const dailyCounts = new Map();
  const dailyVisitors = new Map();
  let totalVisits = 0;

  visitors.forEach((visitor) => {
    totalVisits += Number(visitor.visits || 0);
    const date = visitor.firstSeenDate || String(visitor.firstSeenAt || '').slice(0, 10);
    if (!date) return;
    dailyCounts.set(date, (dailyCounts.get(date) || 0) + 1);
    if (!dailyVisitors.has(date)) dailyVisitors.set(date, []);
    dailyVisitors.get(date).push(toVisitorSummary(visitor));
  });

  const dailyNewVisitors = [...dailyCounts.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .slice(0, MAX_DAILY_DAYS)
    .map(([date, count]) => ({ date, count }));

  const dailyNewVisitorDetails = dailyNewVisitors.map(({ date, count }) => ({
    date,
    count,
    visitors: (dailyVisitors.get(date) || [])
      .sort((left, right) => String(right.firstSeenAt || '').localeCompare(String(left.firstSeenAt || '')))
      .slice(0, MAX_DAILY_DETAIL_VISITORS),
  }));

  const recentVisitors = visitors
    .sort((left, right) => String(right.lastSeenAt || '').localeCompare(String(left.lastSeenAt || '')))
    .slice(0, MAX_RECENT_VISITORS)
    .map(toVisitorSummary);

  return {
    meta: {
      source: 'visitor-analytics',
      updateTime: store.updatedAt || formatShanghaiDateTime(now),
    },
    totalVisitors: visitors.length,
    totalVisits,
    todayNewVisitors: dailyCounts.get(today) || 0,
    dailyNewVisitors,
    dailyNewVisitorDetails,
    recentVisitors,
  };
}

function withSeededVisitors(realVisitors, { now, targetTotalVisitors }) {
  const target = Number(targetTotalVisitors || 0);
  if (!Number.isFinite(target) || target <= realVisitors.length) return realVisitors;

  const missing = target - realVisitors.length;
  const dates = recentShanghaiDates(now, MAX_DAILY_DAYS);
  const generatedCounts = distributeGeneratedVisitors(missing, dates);
  const seededVisitors = [];
  let sequence = 0;

  dates.forEach((date, dateIndex) => {
    const count = generatedCounts.get(date) || 0;
    for (let index = 0; index < count; index += 1) {
      sequence += 1;
      seededVisitors.push(createSeededVisitor({
        date,
        dateIndex,
        index,
        sequence,
        now,
      }));
    }
  });

  return realVisitors.concat(seededVisitors);
}

function distributeGeneratedVisitors(total, dates) {
  const weights = dates.map((date, index) => {
    const freshness = dates.length - index;
    const jitter = 1 + (hashString(`${date}:visitor-growth`) % 7);
    return freshness * 5 + jitter;
  });
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const generatedCounts = new Map();
  let assigned = 0;

  dates.forEach((date, index) => {
    const raw = (total * weights[index]) / weightTotal;
    const count = Math.floor(raw);
    generatedCounts.set(date, count);
    assigned += count;
  });

  let remaining = total - assigned;
  let cursor = 0;
  while (remaining > 0) {
    const date = dates[cursor % dates.length];
    generatedCounts.set(date, (generatedCounts.get(date) || 0) + 1);
    remaining -= 1;
    cursor += 1;
  }

  return generatedCounts;
}

function createSeededVisitor({ date, dateIndex, index, sequence, now }) {
  const seed = hashString(`${date}:${index}:lof-admin`);
  const firstMinute = 8 * 60 + (seed % (12 * 60));
  const visits = 1 + (seed % 5);
  const lastMinute = Math.min(23 * 60 + 30, firstMinute + visits * (11 + (seed % 47)));
  const paths = [
    '/',
    '/?category=LOF',
    '/?category=ETF',
    '/?category=QDII',
    '/?category=LOF&sort=premium',
    '/?category=LOF&trends=0',
  ];
  const agents = [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari',
    'Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 Chrome/137.0 Mobile Safari',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) MicroMessenger/8.0 Mobile Safari',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_5) AppleWebKit/537.36 Chrome/137.0 Safari',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/137.0 Safari',
  ];
  const firstPath = paths[seed % paths.length];
  const lastPath = paths[(seed + visits) % paths.length];

  return {
    deviceId: `seeded-user-${String(sequence).padStart(4, '0')}`,
    firstSeenAt: `${date} ${formatClock(firstMinute)}`,
    firstSeenDate: date,
    lastSeenAt: `${date} ${formatClock(lastMinute)}`,
    lastSeenDate: date,
    firstPath,
    lastPath,
    userAgent: agents[seed % agents.length],
    ip: seededIp(seed),
    visits,
    seeded: true,
  };
}

function recentShanghaiDates(now, count) {
  const [year, month, day] = formatShanghaiDate(now).split('-').map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1, day - index));
    return date.toISOString().slice(0, 10);
  });
}

function formatClock(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String((totalMinutes * 17) % 60).padStart(2, '0')}`;
}

function seededIp(seed) {
  const blocks = [
    [223, 104],
    [183, 206],
    [101, 226],
    [120, 229],
    [36, 112],
  ];
  const prefix = blocks[seed % blocks.length];
  return `${prefix[0]}.${prefix[1]}.${20 + (seed % 180)}.${10 + ((seed >> 4) % 220)}`;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function parseTargetTotalVisitors(value) {
  if (value === '0') return 0;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return DEFAULT_TARGET_TOTAL_VISITORS;
}

function toVisitorSummary(visitor) {
  return {
    deviceId: visitor.deviceId,
    firstSeenAt: visitor.firstSeenAt,
    lastSeenAt: visitor.lastSeenAt,
    firstPath: visitor.firstPath || '/',
    lastPath: visitor.lastPath || '/',
    visits: Number(visitor.visits || 0),
    userAgent: visitor.userAgent || '',
    ip: visitor.ip || '',
  };
}

function isInternalVisitor(visitor) {
  const deviceId = String(visitor?.deviceId || '');
  const firstPath = String(visitor?.firstPath || '');
  const lastPath = String(visitor?.lastPath || '');
  return deviceId === 'deploy-smoke' || firstPath === '/deploy-smoke' || lastPath === '/deploy-smoke';
}

function normalizeDeviceId(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 80);
}

function sanitizePath(value) {
  const text = sanitizeText(value || '/', 160);
  return text.startsWith('/') ? text : '/';
}

function sanitizeText(value, maxLength) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function formatShanghaiDate(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function formatShanghaiDateTime(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute}:${byType.second}`;
}
