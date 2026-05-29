<script setup lang="ts">
import { computed } from 'vue';
import type { FundSnapshot } from '../types/fund';

const props = defineProps<{
  meta: FundSnapshot['meta'] | null;
  refreshing: boolean;
  paused: boolean;
  error?: string;
  lastSuccessAt?: string | null;
  abnormalCount: number;
  nextRefreshIn?: number | null;
}>();

const timeText = computed(() => props.meta?.updateTime || props.meta?.latestQuoteTime || props.lastSuccessAt || '-');
const refreshText = computed(() => {
  if (props.paused) return '暂停刷新';
  if (typeof props.nextRefreshIn !== 'number') return '30秒自动刷新';
  return `${props.nextRefreshIn}秒后自动刷新`;
});
</script>

<template>
  <section class="data-status" :class="{ warning: meta?.stale || error || abnormalCount > 0, paused }" aria-label="数据更新时间">
    <span class="time-label">
      <i aria-hidden="true"></i>
      <span>数据更新时间</span>
      <time :key="timeText" class="time-fade">{{ timeText }}</time>
    </span>
    <span class="refresh-countdown">{{ refreshText }}</span>
  </section>
</template>
