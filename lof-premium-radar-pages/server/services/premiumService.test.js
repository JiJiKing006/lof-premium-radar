import { describe, expect, it } from 'vitest';
import { calculatePremium } from './premiumService.js';

describe('premiumService', () => {
  it('uses only official nav when calculating premium', () => {
    const result = calculatePremium({ marketPrice: 1.25, estimatedNav: 1.2, lastNav: 1.1 });

    expect(result.premiumRate).toBeCloseTo(13.6364, 4);
    expect(result.basis).toBe('lastNav');
    expect(result.note).toBe('基于已公布官方净值');
  });

  it('falls back to official nav and marks the result as non realtime estimate', () => {
    const result = calculatePremium({ marketPrice: 1.25, estimatedNav: null, lastNav: 1.2 });

    expect(result.premiumRate).toBeCloseTo(4.1667, 4);
    expect(result.basis).toBe('lastNav');
    expect(result.note).toBe('基于已公布官方净值');
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
    });

    expect(result.premiumRate).toBeCloseTo(13.6364, 4);
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
      lastNav: 1.1,
    });

    expect(result.premiumRate).toBeCloseTo(13.6364, 4);
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
      lastNav: 0.9409,
    });

    expect(result.premiumRate).toBeCloseTo(-0.5208, 4);
    expect(result.basis).toBe('lastNav');
    expect(result.estimatedNav).toBeNull();
    expect(result.estimateWarning).toContain('估算净值量级异常');
  });
});
