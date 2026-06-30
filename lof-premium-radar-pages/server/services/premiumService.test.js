import { describe, expect, it } from 'vitest';
import { calculatePremium } from './premiumService.js';

const NOW = new Date('2026-06-29T06:00:00Z');

describe('premiumService', () => {
  it('prefers a fresh exchange IOPV over every estimated or official NAV basis', () => {
    const result = calculatePremium({
      marketPrice: 1.25,
      iopv: 1.24,
      iopvSource: 'sse',
      iopvTime: '2026-06-29 10:30:15',
      realtimeReferenceNav: 1.2,
      realtimeReferenceSource: 'lof',
      realtimeReferenceDate: '2026-06-28',
      lastNav: 1.1,
      navDate: '2026-06-27',
      now: NOW,
    });

    expect(result.premiumRate).toBeCloseTo(0.80645, 5);
    expect(result.basis).toBe('iopv');
    expect(result.note).toBe('基于交易所IOPV');
  });

  it('uses a fresh target-site estimate for realtime premium while keeping it labeled as non-official', () => {
    const result = calculatePremium({
      marketPrice: 4.536,
      realtimeReferenceNav: 3.487,
      realtimeReferenceSource: 'lof',
      realtimeReferenceTime: '2026-06-29 10:38:00',
      realtimeReferenceDate: '2026-06-26',
      lastNav: 3.6406,
      navDate: '2026-06-25',
      now: NOW,
    });

    expect(result.premiumRate).toBeCloseTo(30.0832, 4);
    expect(result.basis).toBe('estimatedNav');
    expect(result.note).toBe('基于目标网站估值（非官方净值）');
    expect(result.estimatedNav).toBe(3.487);
    expect(result.selectedNavSource).toBe('lof');
  });

  it('rejects a stale or older target-site estimate and falls back to the latest official NAV', () => {
    const result = calculatePremium({
      marketPrice: 4.536,
      realtimeReferenceNav: 3.487,
      realtimeReferenceSource: 'lof',
      realtimeReferenceDate: '2026-06-24',
      realtimeReferenceStale: true,
      lastNav: 3.6406,
      navDate: '2026-06-25',
      now: NOW,
    });

    expect(result.premiumRate).toBeNull();
    expect(result.officialPremiumRate).toBeCloseTo(24.5948, 4);
    expect(result.basis).toBe('none');
    expect(result.note).toBe('今日估算净值暂无数据');
  });

  it('keeps official premium separate when no current estimate exists', () => {
    const result = calculatePremium({ marketPrice: 1.25, estimatedNav: 1.2, lastNav: 1.1, now: NOW });

    expect(result.premiumRate).toBeNull();
    expect(result.officialPremiumRate).toBeCloseTo(13.6364, 4);
    expect(result.basis).toBe('none');
  });

  it('does not call yesterday official nav realtime premium', () => {
    const result = calculatePremium({ marketPrice: 1.25, estimatedNav: null, lastNav: 1.2, now: NOW });

    expect(result.premiumRate).toBeNull();
    expect(result.officialPremiumRate).toBeCloseTo(4.1667, 4);
    expect(result.basis).toBe('none');
  });

  it('keeps the last trading-day estimate valid after midnight before a new quote appears', () => {
    const result = calculatePremium({
      marketPrice: 1.25,
      estimatedNav: 1.2,
      estimatedNavSource: 'tiantian',
      estimatedNavTime: '2026-06-30 15:00:00',
      quoteTime: '2026-06-30 15:00:00',
      lastNav: 1.1,
      now: new Date('2026-06-30T16:30:00Z'),
    });

    expect(result.premiumRate).toBeCloseTo(4.1667, 4);
    expect(result.basis).toBe('estimatedNav');
  });

  it('rejects the previous trading-day estimate after a new-day quote appears', () => {
    const result = calculatePremium({
      marketPrice: 1.25,
      estimatedNav: 1.2,
      estimatedNavSource: 'tiantian',
      estimatedNavTime: '2026-06-30 15:00:00',
      quoteTime: '2026-07-01 09:31:00',
      lastNav: 1.1,
      now: new Date('2026-07-01T01:31:00Z'),
    });

    expect(result.premiumRate).toBeNull();
    expect(result.officialPremiumRate).toBeCloseTo(13.6364, 4);
    expect(result.basis).toBe('none');
  });

  it('keeps the preferred supplemental estimate separate from official premium', () => {
    const result = calculatePremium({
      marketPrice: 1.25,
      estimatedNav: 1.2,
      estimatedNavSource: 'palmmicro',
      estimatedNavTime: '2026-05-29 15:00:00',
      supplementalEstimatedNav: 1.18,
      supplementalNavSource: 'tiantian',
      supplementalNavTime: '2026-05-29 15:00:00',
      lastNav: 1.1,
      now: new Date('2026-05-29T08:00:00Z'),
    });

    expect(result.premiumRate).toBeCloseTo(5.9322, 4);
    expect(result.officialPremiumRate).toBeCloseTo(13.6364, 4);
    expect(result.estimatedNav).toBe(1.18);
    expect(result.selectedNavSource).toBe('tiantian');
    expect(result.estimateConfidence).toBe('low');
    expect(result.estimateDeviationRate).toBeGreaterThan(1.5);
  });

  it('keeps high confidence when independent estimates are close', () => {
    const result = calculatePremium({
      marketPrice: 1.25,
      estimatedNav: 1.2,
      estimatedNavSource: 'haoetf',
      supplementalEstimatedNav: 1.201,
      supplementalNavSource: 'jisilu',
      estimatedNavTime: '2026-05-29 15:00:00',
      supplementalNavTime: '2026-05-29 15:00:00',
      lastNav: 1.1,
      now: new Date('2026-05-29T08:00:00Z'),
    });

    expect(result.premiumRate).toBeCloseTo(4.0799, 4);
    expect(result.estimatedNav).toBe(1.201);
    expect(result.estimateConfidence).toBe('high');
    expect(result.estimateWarning).toBe('');
  });

  it('prefers Sina estimates over third-party aggregator estimates', () => {
    const result = calculatePremium({
      marketPrice: 1.25,
      estimatedNav: 1.2,
      estimatedNavSource: 'haoetf',
      estimatedNavTime: '2026-05-29 15:00:00',
      supplementalEstimatedNav: 1.19,
      supplementalNavSource: 'sina',
      supplementalNavTime: '2026-05-29 15:00:00',
      lastNav: 1.1,
      now: new Date('2026-05-29T08:00:00Z'),
    });

    expect(result.estimatedNav).toBe(1.19);
    expect(result.selectedNavSource).toBe('sina');
  });

  it('prefers Eastmoney estimates over Sina, Jisilu, and HaoETF estimates', () => {
    const result = calculatePremium({
      marketPrice: 1.25,
      estimatedNav: 1.19,
      estimatedNavSource: 'sina',
      estimatedNavTime: '2026-05-29 15:00:00',
      supplementalEstimatedNav: 1.18,
      supplementalNavSource: 'eastmoney',
      supplementalNavTime: '2026-05-29 15:00:00',
      lastNav: 1.1,
      now: new Date('2026-05-29T08:00:00Z'),
    });

    expect(result.estimatedNav).toBe(1.18);
    expect(result.selectedNavSource).toBe('eastmoney');
  });

  it('rejects estimated NAV values with an impossible scale and falls back to official NAV', () => {
    const result = calculatePremium({
      marketPrice: 0.936,
      estimatedNav: null,
      supplementalEstimatedNav: 98.17,
      supplementalNavSource: 'jisilu',
      supplementalNavTime: '2026-05-29 15:00:00',
      lastNav: 0.9409,
      now: new Date('2026-05-29T08:00:00Z'),
    });

    expect(result.premiumRate).toBeNull();
    expect(result.officialPremiumRate).toBeCloseTo(-0.5208, 4);
    expect(result.basis).toBe('none');
    expect(result.estimatedNav).toBeNull();
    expect(result.estimateWarning).toContain('估算净值量级异常');
  });
});
