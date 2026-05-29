<script setup lang="ts">
import type { FundItem } from '../types/fund';
import FundCard from './FundCard.vue';

defineProps<{
  funds: FundItem[];
  loading: boolean;
  error?: string;
}>();

defineEmits<{ select: [fund: FundItem] }>();
</script>

<template>
  <section class="fund-list" aria-label="基金列表">
    <div v-if="loading" class="state-card">正在加载行情数据</div>
    <div v-else-if="error && !funds.length" class="state-card error">{{ error }}</div>
    <div v-else-if="!funds.length" class="state-card">没有匹配的数据</div>
    <FundCard v-for="fund in funds" v-else :key="fund.code" :fund="fund" @select="$emit('select', $event)" />
  </section>
</template>
