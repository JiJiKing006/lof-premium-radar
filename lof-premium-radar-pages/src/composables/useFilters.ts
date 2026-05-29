import { computed, ref, type Ref } from 'vue';
import type { FundItem, FundSortKey } from '../types/fund';

export function useFilters(funds: Ref<FundItem[]>, excludePausedPurchase: Ref<boolean>, sortDirection: Ref<'asc' | 'desc'>) {
  const query = ref('');
  const sortKey = ref<FundSortKey>('premiumRate');

  const visibleFunds = computed(() => {
    const keyword = query.value.trim().toLowerCase();
    const filtered = funds.value.filter((fund) => {
      const matchesKeyword =
        !keyword ||
        fund.code.toLowerCase().includes(keyword) ||
        fund.name.toLowerCase().includes(keyword) ||
        String(fund.raw?.indexName || '').toLowerCase().includes(keyword);

      if (!matchesKeyword) return false;
      if (excludePausedPurchase.value && isPausedPurchase(fund)) return false;
      return true;
    });

    const multiplier = sortDirection.value === 'asc' ? 1 : -1;
    return filtered.slice().sort((left, right) => {
      const leftValue = sortValue(left, sortKey.value);
      const rightValue = sortValue(right, sortKey.value);
      return (leftValue - rightValue) * multiplier;
    });
  });

  return { query, sortKey, visibleFunds };
}

function sortValue(fund: FundItem, key: FundSortKey): number {
  if (key === 'price') return fund.marketPrice ?? fund.price ?? Number.NEGATIVE_INFINITY;
  if (key === 'turnover') return fund.turnover ?? fund.amount ?? Number.NEGATIVE_INFINITY;
  if (key === 'changeRate') return fund.changeRate ?? fund.changePercent ?? Number.NEGATIVE_INFINITY;
  if (key === 'lastNav') return fund.lastNav ?? fund.nav ?? Number.NEGATIVE_INFINITY;
  if (key === 'estimatedNav') return fund.estimatedNav ?? fund.estimatedValue ?? Number.NEGATIVE_INFINITY;
  if (key === 'volume') return fund.volume ?? Number.NEGATIVE_INFINITY;
  return fund[key] ?? Number.NEGATIVE_INFINITY;
}

function isPausedPurchase(fund: FundItem): boolean {
  const limit = fund.purchaseLimit || {};
  const state = String(limit.state || fund.subscriptionState || 'unknown');
  const label = String(limit.label || limit.limitText || fund.subscriptionStatus || '');
  return state === 'paused' || /暂停申购|停止申购/.test(label);
}
