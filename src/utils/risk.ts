import type { FundItem, RiskTag, SubscriptionState } from '../types/fund';
import { isOldNavDate } from './time';

export function computeRiskTags(fund: Pick<FundItem, 'premiumRate' | 'amount' | 'stale' | 'navDate' | 'subscriptionState'>): RiskTag[] {
  const tags: RiskTag[] = [];

  if (fund.premiumRate !== null && fund.premiumRate >= 10) {
    tags.push({ key: 'extreme-premium', label: '极高溢价', level: 'danger' });
  } else if (fund.premiumRate !== null && fund.premiumRate >= 5) {
    tags.push({ key: 'high-premium', label: '高溢价', level: 'danger' });
  }

  if (fund.premiumRate !== null && fund.premiumRate <= -3) {
    tags.push({ key: 'discount', label: '折价', level: 'success' });
  }

  if (fund.amount !== null && fund.amount < 1000) {
    tags.push({ key: 'low-amount', label: '成交低', level: 'warning' });
  }

  if (fund.stale) {
    tags.push({ key: 'stale', label: '数据延迟', level: 'warning' });
  }

  if (isOldNavDate(fund.navDate)) {
    tags.push({ key: 'old-nav', label: '净值滞后', level: 'warning' });
  }

  if (fund.subscriptionState === 'limited' || fund.subscriptionState === 'paused') {
    tags.push({ key: 'subscription-risk', label: '申购受限', level: fund.subscriptionState === 'paused' ? 'danger' : 'warning' });
  }

  return tags;
}

export function normalizeSubscriptionState(status?: string): SubscriptionState {
  const text = status || '';
  if (/暂停/.test(text)) return 'paused';
  if (/限/.test(text)) return 'limited';
  if (/开放/.test(text)) return 'open';
  return 'unknown';
}
