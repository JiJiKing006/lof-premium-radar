import { describe, expect, it } from 'vitest';
import { formatEmpty, quoteDateTime } from './funds';

describe('fund display helpers', () => {
  it('uses explicit Chinese empty-state text for unavailable values', () => {
    expect(formatEmpty(null)).toBe('暂无数据');
    expect(formatEmpty(undefined)).toBe('暂无数据');
    expect(formatEmpty('')).toBe('暂无数据');
  });

  it('uses explicit Chinese empty-state text when quote time is unavailable', () => {
    expect(quoteDateTime({})).toBe('暂无数据');
  });
});
