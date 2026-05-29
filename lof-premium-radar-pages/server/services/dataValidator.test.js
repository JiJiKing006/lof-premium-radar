import { describe, expect, it } from 'vitest';
import { validateFundRecord } from './dataValidator.js';

const baseRecord = {
  code: '513100',
  name: '纳指ETF',
  category: 'QDII',
  marketPrice: 1.23,
  lastNav: 1.2,
  estimatedNav: 1.21,
  premiumRate: 1.65,
  quoteTime: '2026-05-28 15:00:00',
};

describe('dataValidator', () => {
  it('marks missing price as abnormal', () => {
    const result = validateFundRecord({ ...baseRecord, marketPrice: null });

    expect(result.isAbnormal).toBe(true);
    expect(result.abnormalReason).toContain('price 缺失');
  });

  it('marks missing nav as abnormal only when both official and estimated nav are absent', () => {
    const options = { now: new Date('2026-05-28T15:05:00+08:00').getTime() };
    expect(validateFundRecord({ ...baseRecord, lastNav: null, estimatedNav: 1.21 }, options).isAbnormal).toBe(false);

    const result = validateFundRecord({ ...baseRecord, lastNav: null, estimatedNav: null }, options);
    expect(result.isAbnormal).toBe(true);
    expect(result.abnormalReason).toContain('nav 缺失');
  });

  it('marks extreme premium and stale quote time as abnormal', () => {
    const result = validateFundRecord(
      { ...baseRecord, premiumRate: 35, quoteTime: '2026-05-28 09:30:00' },
      { now: new Date('2026-05-28T15:30:00+08:00').getTime(), staleMs: 10 * 60_000 },
    );

    expect(result.isAbnormal).toBe(true);
    expect(result.abnormalReason).toContain('溢价率异常');
    expect(result.abnormalReason).toContain('数据时间过旧');
  });

  it('marks low confidence multi-source estimates as abnormal', () => {
    const result = validateFundRecord({ ...baseRecord, estimateConfidence: 'low', estimateDeviationRate: 2.3 });

    expect(result.isAbnormal).toBe(true);
    expect(result.abnormalReason).toContain('估算净值多源偏差过大');
  });
});
