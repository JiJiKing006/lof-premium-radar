import { onMounted, onUnmounted, ref } from 'vue';
import { fetchMarketIndices, type MarketIndexSnapshot } from '../api/market';

export function useMarketIndices() {
  const indices = ref<MarketIndexSnapshot['rows']>([]);
  const meta = ref<MarketIndexSnapshot['meta'] | null>(null);
  const error = ref('');
  let timer: number | undefined;

  async function load({ force = false } = {}) {
    try {
      const snapshot = await fetchMarketIndices({ force });
      indices.value = snapshot.rows || [];
      meta.value = snapshot.meta;
      error.value = '';
    } catch (err) {
      error.value = err instanceof Error ? err.message : '指数行情加载失败';
    }
  }

  onMounted(() => {
    void load();
    timer = window.setInterval(() => {
      void load({ force: true });
    }, 10_000);
  });

  onUnmounted(() => {
    window.clearInterval(timer);
  });

  return { indices, meta, error, refreshIndices: () => load({ force: true }) };
}
