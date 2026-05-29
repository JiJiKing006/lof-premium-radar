<script setup lang="ts">
import type { MarketIndexItem } from '../api/market';

defineProps<{
  rows: MarketIndexItem[];
  error?: string;
}>();

function valueClass(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return 'is-flat';
  return number > 0 ? 'is-up' : 'is-down';
}

function numberText(value: unknown, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return number.toFixed(digits);
}

function percentText(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`;
}
</script>

<template>
  <section class="index-strip" aria-label="主要指数涨跌">
    <div v-if="rows.length" class="index-strip-track">
      <article v-for="item in rows" :key="item.key" class="index-chip" :class="valueClass(item.changeRate)">
        <span>{{ item.name }}</span>
        <strong>{{ numberText(item.value) }}</strong>
        <b>{{ percentText(item.changeRate) }}</b>
      </article>
    </div>
    <div v-else class="index-strip-empty">
      {{ error || '指数行情加载中' }}
    </div>
  </section>
</template>
