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

export const visitorAnalytics = createVisitorAnalytics({
  filePath: process.env.VISITOR_ANALYTICS_FILE || DEFAULT_FILE,
});

export function createVisitorAnalytics({ filePath = DEFAULT_FILE } = {}) {
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
      return summarizeStore(store, { now });
    },

    async getStats({ now = new Date() } = {}) {
      const store = await readStore(filePath);
      return summarizeStore(store, { now });
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

function summarizeStore(store, { now }) {
  const today = formatShanghaiDate(now);
  const visitors = Object.values(store.visitors).filter((visitor) => !isInternalVisitor(visitor));
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
