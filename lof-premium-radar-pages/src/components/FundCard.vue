<script setup lang="ts">
import type { FundItem } from '../types/fund';
import { formatAmount, formatNumber, formatPercent } from '../utils/format';
import { relativeTime } from '../utils/time';

defineProps<{ fund: FundItem }>();
defineEmits<{ select: [fund: FundItem] }>();

function statusClass(fund: FundItem) {
  return `sub-${fund.subscriptionState}`;
}
</script>

<template>
  <article class="fund-card" :class="{ stale: fund.stale }" @click="$emit('select', fund)">
    <header>
      <div class="fund-title">
        <strong>{{ fund.name }}</strong>
        <span>{{ fund.code }} · {{ fund.type }}</span>
      </div>
      <div class="premium" :class="{ hot: (fund.premiumRate ?? 0) >= 5, cool: (fund.premiumRate ?? 0) < 0, changed: fund.changedFields?.includes('premiumRate') }">
        {{ formatPercent(fund.premiumRate) }}
      </div>
    </header>

    <section class="fund-metrics">
      <div :class="{ changed: fund.changedFields?.includes('price') }">
        <span>现价</span>
        <strong>{{ formatNumber(fund.price) }}</strong>
      </div>
      <div>
        <span>估值</span>
        <strong>{{ formatNumber(fund.estimatedValue) }}</strong>
      </div>
      <div>
        <span>净值日期</span>
        <strong>{{ fund.navDate || '--' }}</strong>
      </div>
      <div>
        <span>成交额</span>
        <strong>{{ formatAmount(fund.amount) }}</strong>
      </div>
    </section>

    <footer>
      <span class="subscription-tag" :class="statusClass(fund)">{{ fund.subscriptionStatus }}</span>
      <span class="data-age">{{ relativeTime(fund.updatedAt) }}</span>
      <span class="confidence">可信度 {{ fund.confidence }}</span>
    </footer>

    <div class="risk-tags" v-if="fund.riskTags.length">
      <span v-for="tag in fund.riskTags" :key="tag.key" :class="`risk-${tag.level}`">{{ tag.label }}</span>
    </div>
  </article>
</template>
