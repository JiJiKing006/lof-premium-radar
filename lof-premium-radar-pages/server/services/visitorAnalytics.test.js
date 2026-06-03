import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createVisitorAnalytics,
  isAdminPasswordValid,
} from './visitorAnalytics.js';

let tempDir;
let analytics;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'visitor-analytics-'));
  analytics = createVisitorAnalytics({ filePath: path.join(tempDir, 'visitors.json') });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('visitor analytics', () => {
  it('counts one device once while tracking repeat visits', async () => {
    await analytics.recordVisit({
      deviceId: 'device-a',
      path: '/',
      userAgent: 'Mobile Safari',
      ip: '127.0.0.1',
      now: new Date('2026-06-03T01:10:00+08:00'),
    });
    await analytics.recordVisit({
      deviceId: 'device-a',
      path: '/?category=QDII',
      userAgent: 'Mobile Safari',
      ip: '127.0.0.1',
      now: new Date('2026-06-03T01:12:00+08:00'),
    });

    const stats = await analytics.getStats({ now: new Date('2026-06-03T12:00:00+08:00') });

    expect(stats.totalVisitors).toBe(1);
    expect(stats.totalVisits).toBe(2);
    expect(stats.todayNewVisitors).toBe(1);
    expect(stats.dailyNewVisitors).toEqual([{ date: '2026-06-03', count: 1 }]);
    expect(stats.recentVisitors[0]).toMatchObject({
      deviceId: 'device-a',
      visits: 2,
      firstPath: '/',
      lastPath: '/?category=QDII',
    });
  }, 15_000);

  it('groups daily new visitors by the first visit date in Shanghai time', async () => {
    await analytics.recordVisit({ deviceId: 'device-a', now: new Date('2026-06-02T23:30:00+08:00') });
    await analytics.recordVisit({ deviceId: 'device-b', now: new Date('2026-06-03T00:05:00+08:00') });
    await analytics.recordVisit({ deviceId: 'device-a', now: new Date('2026-06-03T10:00:00+08:00') });

    const stats = await analytics.getStats({ now: new Date('2026-06-03T18:00:00+08:00') });

    expect(stats.totalVisitors).toBe(2);
    expect(stats.todayNewVisitors).toBe(1);
    expect(stats.dailyNewVisitors).toEqual([
      { date: '2026-06-03', count: 1 },
      { date: '2026-06-02', count: 1 },
    ]);
  }, 15_000);

  it('validates the admin password without accepting empty input', () => {
    expect(isAdminPasswordValid('53123')).toBe(true);
    expect(isAdminPasswordValid(' 53123 ')).toBe(true);
    expect(isAdminPasswordValid('')).toBe(false);
    expect(isAdminPasswordValid('wrong')).toBe(false);
  });
});
