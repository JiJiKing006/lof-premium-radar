<script setup lang="ts">
defineProps<{ modelValue: string }>();
defineEmits<{ 'update:modelValue': [value: string] }>();

const filters = [
  { key: 'WATCH', label: '自选' },
  { key: 'LOF', label: 'LOF类型' },
  { key: 'QDII', label: 'QDII类型' },
  { key: 'ETF', label: 'ETF类型' },
];
</script>

<template>
  <nav class="filter-tabs" aria-label="基金筛选">
    <button
      v-for="filter in filters"
      :key="filter.key"
      type="button"
      :class="{ active: modelValue === filter.key }"
      @click="$emit('update:modelValue', filter.key)"
    >
      {{ filter.label }}
    </button>
  </nav>
</template>
