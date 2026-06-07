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

  it('does not count deploy smoke devices as real users', async () => {
    await analytics.recordVisit({ deviceId: 'device-a', now: new Date('2026-06-03T10:00:00+08:00') });
    await analytics.recordVisit({ deviceId: 'deploy-smoke', path: '/deploy-smoke', now: new Date('2026-06-03T10:01:00+08:00') });

    const stats = await analytics.getStats({ now: new Date('2026-06-03T18:00:00+08:00') });

    expect(stats.totalVisitors).toBe(1);
    expect(stats.todayNewVisitors).toBe(1);
    expect(stats.recentVisitors.map((visitor) => visitor.deviceId)).toEqual(['device-a']);
  }, 15_000);

  it('returns daily new visitor detail rows grouped by first visit date', async () => {
    await analytics.recordVisit({
      deviceId: 'device-a',
      path: '/',
      userAgent: 'Mobile Safari',
      ip: '127.0.0.1',
      now: new Date('2026-06-02T23:30:00+08:00'),
    });
    await analytics.recordVisit({
      deviceId: 'device-b',
      path: '/?category=LOF',
      userAgent: 'WeChat',
      ip: '10.0.0.2',
      now: new Date('2026-06-03T00:05:00+08:00'),
    });
    await analytics.recordVisit({
      deviceId: 'device-b',
      path: '/?category=ETF',
      userAgent: 'WeChat',
      ip: '10.0.0.2',
      now: new Date('2026-06-03T10:00:00+08:00'),
    });

    const stats = await analytics.getStats({ now: new Date('2026-06-03T18:00:00+08:00') });

    expect(stats.dailyNewVisitorDetails).toEqual([
      {
        date: '2026-06-03',
        count: 1,
        visitors: [
          {
            deviceId: 'device-b',
            firstSeenAt: '2026-06-03 00:05:00',
            lastSeenAt: '2026-06-03 10:00:00',
            firstPath: '/?category=LOF',
            lastPath: '/?category=ETF',
            visits: 2,
            userAgent: 'WeChat',
            ip: '10.0.0.2',
          },
        ],
      },
      {
        date: '2026-06-02',
        count: 1,
        visitors: [
          {
            deviceId: 'device-a',
            firstSeenAt: '2026-06-02 23:30:00',
            lastSeenAt: '2026-06-02 23:30:00',
            firstPath: '/',
            lastPath: '/',
            visits: 1,
            userAgent: 'Mobile Safari',
            ip: '127.0.0.1',
          },
        ],
      },
    ]);
  }, 15_000);

  it('can top up admin visitor stats to a deterministic target total', async () => {
    await analytics.recordVisit({
      deviceId: 'device-a',
      path: '/?category=LOF',
      userAgent: 'Mobile Safari',
      ip: '127.0.0.1',
      now: new Date('2026-06-03T09:15:00+08:00'),
    });

    const seededAnalytics = createVisitorAnalytics({
      filePath: path.join(tempDir, 'visitors.json'),
      targetTotalVisitors: 273,
    });
    const stats = await seededAnalytics.getStats({ now: new Date('2026-06-07T18:00:00+08:00') });

    expect(stats.totalVisitors).toBe(273);
    expect(stats.totalVisits).toBeGreaterThan(273);
    expect(stats.todayNewVisitors).toBeGreaterThan(0);
    expect(stats.dailyNewVisitors.reduce((total, day) => total + day.count, 0)).toBe(273);
    expect(stats.dailyNewVisitorDetails[0].visitors.length).toBeGreaterThan(0);
    expect(stats.recentVisitors).toHaveLength(20);
  }, 15_000);

  it('validates the admin password without accepting empty input', () => {
    expect(isAdminPasswordValid('53123')).toBe(true);
    expect(isAdminPasswordValid(' 53123 ')).toBe(true);
    expect(isAdminPasswordValid('')).toBe(false);
    expect(isAdminPasswordValid('wrong')).toBe(false);
  });
});
