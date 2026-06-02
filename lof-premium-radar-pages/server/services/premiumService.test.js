import { describe, expect, it } from 'vitest';
import { calculatePremium } from './premiumService.js';

describe('premiumService', () => {
  it('uses estimated nav before official nav when calculating premium', () => {
    const result = calculatePremium({ marketPrice: 1.25, estimatedNav: 1.2, lastNav: 1.1 });

    expect(result.premiumRate).toBeCloseTo(4.1667, 4);
    expect(result.basis).toBe('estimatedNav');
    expect(result.note).toBe('基于估算净值');
  });

  it('falls back to official nav and marks the result as non realtime estimate', () => {
    const result = calculatePremium({ marketPrice: 1.25, estimatedNav: null, lastNav: 1.2 });

    expect(result.premiumRate).toBeCloseTo(4.1667, 4);
    expect(result.basis).toBe('lastNav');
    expect(result.note).toBe('基于已公布净值，非实时估算');
  });

  it('uses the preferred supplemental estimate when calculating realtime premium', () => {
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

    expect(result.premiumRate).toBeCloseTo(5.9322, 4);
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
});
