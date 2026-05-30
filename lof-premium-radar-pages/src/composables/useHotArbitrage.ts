import { onMounted, ref, watch, type Ref } from 'vue';
import { fetchHotArbitrageSnapshot } from '../api/funds';
import type { HotArbitrageItem, HotArbitrageSnapshot } from '../types/fund';

export function useHotArbitrage(section: Ref<string>) {
  const rows = ref<HotArbitrageItem[]>([]);
  const meta = ref<HotArbitrageSnapshot['meta'] | null>(null);
  const loading = ref(true);
  const error = ref('');
  let requestId = 0;

  async function load({ force = false } = {}) {
    const currentRequestId = ++requestId;
    loading.value = true;
    error.value = '';
    try {
      const snapshot = await fetchHotArbitrageSnapshot({
        force,
        section: section.value === 'WATCH' ? 'ALL' : section.value,
        limit: 10,
      });
      if (currentRequestId !== requestId) return;
      rows.value = snapshot.rows || [];
      meta.value = snapshot.meta;
    } catch (err) {
      if (currentRequestId !== requestId) return;
      error.value = err instanceof Error ? err.message : '热门套利榜加载失败';
      rows.value = [];
    } finally {
      if (currentRequestId === requestId) loading.value = false;
    }
  }

  onMounted(() => {
    load();
  });

  watch(section, () => {
    load();
  });

  return {
    rows,
    meta,
    loading,
    error,
    refreshHotArbitrage: () => load({ force: true }),
  };
}
