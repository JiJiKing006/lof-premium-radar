<script setup lang="ts">
defineProps<{ modelValue: boolean }>();
defineEmits<{ 'update:modelValue': [value: boolean] }>();
</script>

<template>
  <section class="sort-bar" aria-label="申购状态筛选">
    <label class="purchase-checkbox">
      <input
        type="checkbox"
        :checked="modelValue"
        @change="$emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
      />
      <span>过滤暂停申购</span>
    </label>
  </section>
</template>
