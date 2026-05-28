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
});
