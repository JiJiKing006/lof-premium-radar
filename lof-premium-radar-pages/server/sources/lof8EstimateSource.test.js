import { describe, expect, it } from 'vitest';
import { normalizeLof8Estimate } from './lof8EstimateSource.js';

describe('lof8EstimateSource', () => {
  it('accepts only explicitly available timestamped estimates', () => {
    expect(normalizeLof8Estimate({
      code: '161725',
      estNav: 0.5069,
      estTime: '2026-06-30 15:00',
      hasEstNav: true,
    })).toMatchObject({
      code: '161725',
      estimatedNav: 0.5069,
      estimatedNavSource: 'lof8-tiantian',
      estimatedNavTime: '2026-06-30 15:00:00',
    });
  });

  it('does not relabel official nav fallback as an estimate', () => {
    expect(normalizeLof8Estimate({
      code: '160723',
      estNav: 1.6933,
      estTime: '',
      hasEstNav: false,
    })).toBeNull();
  });
});
