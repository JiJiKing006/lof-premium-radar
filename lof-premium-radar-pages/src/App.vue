<script setup lang="ts">
import { computed, ref } from 'vue';
import AdminView from './views/AdminView.vue';
import HomeView from './views/HomeView.vue';
import { isAdminRoute } from './utils/appPath';

const currentPath = ref(window.location.pathname);
const isAdminPath = computed(() => isAdminRoute(currentPath.value, import.meta.env.BASE_URL));

window.addEventListener('popstate', () => {
  currentPath.value = window.location.pathname;
});
</script>

<template>
  <AdminView v-if="isAdminPath" />
  <HomeView v-else />
</template>
