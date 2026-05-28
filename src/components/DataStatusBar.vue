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
}>();

const timeText = computed(() => props.meta?.updateTime || props.meta?.latestQuoteTime || props.lastSuccessAt || '-');
</script>

<template>
  <section class="data-status" :class="{ warning: meta?.stale || error || abnormalCount > 0, paused }" aria-label="数据更新时间">
    <span class="time-label">
      <i aria-hidden="true"></i>
      数据更新时间
    </span>
    <time>{{ timeText }}</time>
  </section>
</template>
