import { describe, expect, it } from 'vitest';
import {
  calculateHotArbitrageRows,
  scoreActivityByPeerRank,
  scoreAnomaly,
  scoreArbitrageSpace,
  scoreFreshness,
} from './hotArbitrageService.js';

describe('hotArbitrageService scoring', () => {
  it('scores arbitrage space from absolute premium rate', () => {
    expect(scoreArbitrageSpace(0.49)).toBe(0);
    expect(scoreArbitrageSpace(0.8)).toBe(30);
    expect(scoreArbitrageSpace(1.5)).toBe(60);
    expect(scoreArbitrageSpace(3)).toBe(85);
    expect(scoreArbitrageSpace(5.1)).toBe(100);
  });

  it('scores activity by same-type turnover percentile', () => {
    expect(scoreActivityByPeerRank(0.1)).toBe(100);
    expect(scoreActivityByPeerRank(0.2)).toBe(85);
    expect(scoreActivityByPeerRank(0.4)).toBe(65);
    expect(scoreActivityByPeerRank(0.6)).toBe(40);
    expect(scoreActivityByPeerRank(0.9)).toBe(20);
  });

  it('scores abnormal turnover and quote freshness', () => {
    expect(scoreAnomaly(0.9)).toBe(20);
    expect(scoreAnomaly(1.2)).toBe(50);
    expect(scoreAnomaly(1.7)).toBe(75);
    expect(scoreAnomaly(2.1)).toBe(100);
    expect(scoreFreshness(60_000)).toBe(100);
    expect(scoreFreshness(180_000)).toBe(80);
    expect(scoreFreshness(600_000)).toBe(50);
    expect(scoreFreshness(1_800_000)).toBe(20);
    expect(scoreFreshness(1_800_001)).toBe(0);
  });

  it('filters invalid candidates and uses upgraded formula when avgAmount5d exists', () => {
    const now = new Date('2026-05-30T10:00:00+08:00');
    const rows = calculateHotArbitrageRows([
      {
        code: '501018',
        name: '南方原油LOF',
        category: 'LOF',
        marketPrice: 1.9,
        lastNav: 1.8,
        premiumRate: 5.2,
        turnover: 12_000_000,
        volume: 6_000_000,
        avgAmount5d: 4_000_000,
        quoteTime: '2026-05-30 09:59:30',
        updateTime: '2026-05-30 10:00:00',
        source: 'eastmoney',
      },
      {
        code: '161125',
        name: '标普500LOF',
        category: 'LOF',
        marketPrice: 3.1,
        lastNav: 3.09,
        premiumRate: 0.4,
        turnover: 20_000_000,
        quoteTime: '2026-05-30 09:59:30',
      },
    ], {
      now,
      activityScores: new Map([
        ['501018', 100],
        ['161125', 100],
      ]),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      code: '501018',
      premiumDirection: 'premium',
      arbitrageSpaceScore: 100,
      activityScore: 100,
      anomalyScore: 100,
      freshnessScore: 100,
      hotScore: 100,
      volumeRatio: 3,
    });
  });

  it('keeps same-day close quotes after market close', () => {
    const rows = calculateHotArbitrageRows([
      {
        code: '501018',
        name: '南方原油LOF',
        category: 'LOF',
        marketPrice: 1.9,
        lastNav: 1.8,
        premiumRate: 5.2,
        turnover: 12_000_000,
        quoteTime: '2026-06-08 15:00:03',
        source: 'sina',
      },
    ], {
      now: new Date('2026-06-08T20:20:00+08:00'),
      activityScores: new Map([['501018', 100]]),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].freshnessScore).toBeGreaterThan(0);
  });
});
