import { describe, expect, it } from 'vitest';
import { formatAmount, formatNumber, formatPercent } from './format';

describe('financial display formatters', () => {
  it('uses explicit Chinese missing-value text for unavailable financial values', () => {
    expect(formatNumber(null)).toBe('暂无数据');
    expect(formatPercent(null)).toBe('暂无数据');
    expect(formatAmount(null)).toBe('暂无数据');
  });
});
