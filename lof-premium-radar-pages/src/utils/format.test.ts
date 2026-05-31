import { describe, expect, it } from 'vitest';
import { formatAmount, formatNumber, formatPercent, formatShareChangeText, shareChangeClass } from './format';

describe('financial display formatters', () => {
  it('uses explicit Chinese missing-value text for unavailable financial values', () => {
    expect(formatNumber(null)).toBe('暂无数据');
    expect(formatPercent(null)).toBe('暂无数据');
    expect(formatAmount(null)).toBe('暂无数据');
  });

  it('formats share changes as previous-day additions or reductions without inventing values', () => {
    expect(formatShareChangeText('0.32亿份')).toBe('较上一日份额增加 0.32亿份');
    expect(formatShareChangeText('-1250万份')).toBe('较上一日份额减少 1250万份');
    expect(formatShareChangeText(null)).toBe('较上一日份额 暂无数据');
  });

  it('classifies share change direction from signed source text', () => {
    expect(shareChangeClass('0.32亿份')).toBe('share-up');
    expect(shareChangeClass('-1250万份')).toBe('share-down');
    expect(shareChangeClass('暂无数据')).toBe('share-flat');
  });
});
