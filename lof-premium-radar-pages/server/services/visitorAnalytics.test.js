import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
      project: 'lof',
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

  it('separates LOF and personal homepage visitors by project', async () => {
    await analytics.recordVisit({
      deviceId: 'shared-device',
      project: 'lof',
      path: '/lof/',
      now: new Date('2026-06-03T09:00:00+08:00'),
    });
    await analytics.recordVisit({
      deviceId: 'shared-device',
      project: 'personal',
      path: '/',
      now: new Date('2026-06-03T09:05:00+08:00'),
    });
    await analytics.recordVisit({
      deviceId: 'personal-only',
      project: 'personal',
      path: '/',
      now: new Date('2026-06-03T09:10:00+08:00'),
    });

    const stats = await analytics.getStats({ now: new Date('2026-06-03T18:00:00+08:00') });
    const lofStats = stats.projects.find((project) => project.project === 'lof');
    const personalStats = stats.projects.find((project) => project.project === 'personal');

    expect(stats.totalVisitors).toBe(1);
    expect(lofStats?.totalVisitors).toBe(1);
    expect(personalStats?.totalVisitors).toBe(2);
    expect(personalStats?.seeded).toBe(false);
    expect(personalStats?.recentVisitors.map((visitor) => visitor.project)).toEqual(['personal', 'personal']);
  }, 15_000);

  it('recovers a concatenated analytics JSON file and rewrites it atomically', async () => {
    const filePath = path.join(tempDir, 'corrupt-visitors.json');
    const firstStore = {
      version: 1,
      updatedAt: '2026-06-03 08:00:00',
      visitors: {
        'lof:old-device': {
          deviceId: 'old-device',
          project: 'lof',
          firstSeenAt: '2026-06-03 08:00:00',
          firstSeenDate: '2026-06-03',
          lastSeenAt: '2026-06-03 08:00:00',
          lastSeenDate: '2026-06-03',
          firstPath: '/lof/',
          lastPath: '/lof/',
          visits: 1,
        },
      },
    };
    await writeFile(filePath, `${JSON.stringify(firstStore)}\n${JSON.stringify({ version: 1, visitors: {} })}\n`);

    const recoveredAnalytics = createVisitorAnalytics({ filePath });
    await recoveredAnalytics.recordVisit({
      deviceId: 'new-device',
      project: 'personal',
      path: '/',
      now: new Date('2026-06-03T10:00:00+08:00'),
    });
    const stats = await recoveredAnalytics.getStats({ now: new Date('2026-06-03T18:00:00+08:00') });
    const rewritten = await readFile(filePath, 'utf8');

    expect(stats.projects.find((project) => project.project === 'lof')?.totalVisitors).toBe(1);
    expect(stats.projects.find((project) => project.project === 'personal')?.totalVisitors).toBe(1);
    expect(() => JSON.parse(rewritten)).not.toThrow();
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
            project: 'lof',
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
            project: 'lof',
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

  it('adds the seeded admin visitor baseline on top of real LOF visitors', async () => {
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
    const personalStats = stats.projects.find((project) => project.project === 'personal');

    expect(stats.totalVisitors).toBe(274);
    expect(stats.project).toBe('lof');
    expect(stats.totalVisits).toBeGreaterThan(273);
    expect(stats.todayNewVisitors).toBeGreaterThan(0);
    expect(stats.dailyNewVisitors.reduce((total, day) => total + day.count, 0)).toBe(274);
    expect(stats.dailyNewVisitorDetails[0].visitors.length).toBeGreaterThan(0);
    expect(stats.recentVisitors).toHaveLength(20);
    expect(personalStats?.totalVisitors).toBe(0);
  }, 15_000);

  it('increments total LOF visitors when a real user is recorded above the seeded baseline', async () => {
    const seededAnalytics = createVisitorAnalytics({
      filePath: path.join(tempDir, 'visitors.json'),
      targetTotalVisitors: 273,
      targetGrowthStartDate: '2026-06-07',
      dailyGrowthMin: 3,
      dailyGrowthMax: 9,
    });

    const before = await seededAnalytics.getStats({ now: new Date('2026-06-11T18:00:00+08:00') });
    await seededAnalytics.recordVisit({
      deviceId: 'new-real-lof-user',
      project: 'lof',
      path: '/lof/',
      now: new Date('2026-06-11T18:05:00+08:00'),
    });
    const after = await seededAnalytics.getStats({ now: new Date('2026-06-11T18:10:00+08:00') });

    expect(after.totalVisitors).toBe(before.totalVisitors + 1);
    expect(after.todayNewVisitors).toBe(before.todayNewVisitors + 1);
    expect(after.meta.targetTotalVisitors).toBe(before.meta.targetTotalVisitors);
  }, 15_000);

  it('grows the seeded admin visitor target after the baseline date', async () => {
    const seededAnalytics = createVisitorAnalytics({
      filePath: path.join(tempDir, 'visitors.json'),
      targetTotalVisitors: 273,
      targetGrowthStartDate: '2026-06-07',
      dailyGrowthMin: 3,
      dailyGrowthMax: 9,
    });

    const baselineStats = await seededAnalytics.getStats({ now: new Date('2026-06-07T18:00:00+08:00') });
    const nextDayStats = await seededAnalytics.getStats({ now: new Date('2026-06-08T18:00:00+08:00') });
    const laterStats = await seededAnalytics.getStats({ now: new Date('2026-06-11T18:00:00+08:00') });
    const repeatedLaterStats = await seededAnalytics.getStats({ now: new Date('2026-06-11T20:00:00+08:00') });

    expect(baselineStats.totalVisitors).toBe(273);
    expect(nextDayStats.totalVisitors).toBeGreaterThan(273);
    expect(laterStats.totalVisitors).toBeGreaterThan(nextDayStats.totalVisitors);
    expect(repeatedLaterStats.totalVisitors).toBe(laterStats.totalVisitors);
    expect(laterStats.todayNewVisitors).toBeGreaterThan(0);
    expect(laterStats.meta.targetTotalVisitors).toBe(laterStats.totalVisitors);
  }, 15_000);

  it('validates the admin password without accepting empty input', () => {
    expect(isAdminPasswordValid('53123')).toBe(true);
    expect(isAdminPasswordValid(' 53123 ')).toBe(true);
    expect(isAdminPasswordValid('')).toBe(false);
    expect(isAdminPasswordValid('wrong')).toBe(false);
  });
});
