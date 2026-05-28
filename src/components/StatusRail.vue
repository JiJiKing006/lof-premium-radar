<script setup>
import { computed } from 'vue';

const props = defineProps({
  summary: { type: Object, required: true },
  meta: { type: Object, default: null },
  refreshing: { type: Boolean, default: false },
  error: { type: String, default: '' },
});

const updatedText = computed(() => {
  const stamp = props.meta?.fetchedAt || props.meta?.scrapedAt;
  if (!stamp) return '等待首次更新';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(stamp));
});

const sourceState = computed(() => {
  if (props.error) return props.error;
  if (props.refreshing) return '正在更新';
  if (props.meta?.stale) return '缓存数据';
  return '实时缓存';
});
</script>

<template>
  <section class="status-rail" aria-label="行情状态">
    <article>
      <span>显示</span>
      <strong>{{ summary.visible }}</strong>
      <small>/ {{ summary.total }}</small>
    </article>
    <article>
      <span>实时覆盖</span>
      <strong>{{ summary.live }}</strong>
      <small>项</small>
    </article>
    <article>
      <span>最高溢价</span>
      <strong>{{ summary.high === null ? '-' : `${summary.high.toFixed(2)}%` }}</strong>
    </article>
    <article>
      <span>最低溢价</span>
      <strong>{{ summary.low === null ? '-' : `${summary.low.toFixed(2)}%` }}</strong>
    </article>
    <article class="wide">
      <span>{{ sourceState }}</span>
      <strong>{{ updatedText }}</strong>
    </article>
  </section>
</template>
