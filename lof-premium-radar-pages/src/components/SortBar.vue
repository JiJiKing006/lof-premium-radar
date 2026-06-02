<script setup lang="ts">
defineProps<{ modelValue: boolean }>();
defineEmits<{ 'update:modelValue': [value: boolean] }>();
</script>

<template>
  <section class="sort-bar" aria-label="申购状态筛选">
    <div class="purchase-checkbox">
      <button
        type="button"
        class="purchase-switch-button"
        role="switch"
        :aria-checked="modelValue"
        aria-label="过滤暂停申购"
        @click="$emit('update:modelValue', !modelValue)"
      >
        <span class="purchase-toggle-ui" aria-hidden="true"></span>
      </button>
      <span>
        <strong>过滤暂停申购</strong>
        <small>隐藏暂停申购基金</small>
      </span>
    </div>
  </section>
</template>
