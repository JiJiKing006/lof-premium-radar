<script setup lang="ts">
defineProps<{ modelValue: string; refreshing?: boolean }>();
defineEmits<{
  'update:modelValue': [value: string];
  refresh: [];
}>();
</script>

<template>
  <section class="mobile-search">
    <label>
      <span class="search-icon" aria-hidden="true"></span>
      <input
        :value="modelValue"
        type="search"
        inputmode="search"
        placeholder="代码 / 基金"
        @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
    </label>
    <button type="button" :disabled="refreshing" @click="$emit('refresh')">
      <span>刷新</span>
    </button>
  </section>
</template>
