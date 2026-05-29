import { describe, expect, it } from 'vitest';
import { computeRiskTags, normalizeSubscriptionState } from './risk';

describe('computeRiskTags', () => {
  it('marks extreme premium, stale data, low amount, old nav and subscription risk', () => {
    const tags = computeRiskTags({
      premiumRate: 12,
      amount: 200,
      stale: true,
      navDate: '2020-01-01',
      subscriptionState: 'paused',
    });

    expect(tags.map((tag) => tag.key)).toEqual([
      'extreme-premium',
      'low-amount',
      'stale',
      'old-nav',
      'subscription-risk',
    ]);
  });

  it('marks discount when premium is lower than -3 percent', () => {
    const tags = computeRiskTags({
      premiumRate: -3.2,
      amount: 5000,
      stale: false,
      navDate: new Date().toISOString().slice(0, 10),
      subscriptionState: 'open',
    });

    expect(tags).toContainEqual({ key: 'discount', label: '折价', level: 'success' });
  });
});

describe('normalizeSubscriptionState', () => {
  it('distinguishes open, limited and paused statuses', () => {
    expect(normalizeSubscriptionState('开放申购')).toBe('open');
    expect(normalizeSubscriptionState('限1000元')).toBe('limited');
    expect(normalizeSubscriptionState('暂停申购')).toBe('paused');
  });
});
