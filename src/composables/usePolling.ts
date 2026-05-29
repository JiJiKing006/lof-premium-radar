import { onBeforeUnmount, onMounted, ref, unref, watch, type Ref } from 'vue';

interface UsePollingOptions {
  interval?: number | Ref<number>;
  maxInterval?: number;
  immediate?: boolean;
}

export function usePolling(task: () => Promise<void>, options: UsePollingOptions = {}) {
  const intervalSource = options.interval ?? 20_000;
  const maxInterval = options.maxInterval ?? 60_000;
  const running = ref(false);
  const paused = ref(false);
  const refreshing = ref(false);
  const error = ref('');
  const lastSuccessAt = ref<string | null>(null);
  const currentInterval = ref(resolveInterval());
  let timer: number | null = null;

  async function refreshNow() {
    if (refreshing.value) return;
    const startedAt = Date.now();
    refreshing.value = true;
    error.value = '';
    try {
      await task();
      currentInterval.value = resolveInterval();
      lastSuccessAt.value = new Date().toISOString();
    } catch (event) {
      error.value = event instanceof Error ? event.message : '刷新失败';
      currentInterval.value = Math.min(currentInterval.value * 2, maxInterval);
    } finally {
      await keepRefreshVisible(startedAt);
      refreshing.value = false;
      schedule();
    }
  }

  function schedule() {
    if (!running.value || paused.value) return;
    clear();
    timer = window.setTimeout(refreshNow, currentInterval.value);
  }

  function start() {
    if (running.value) return;
    running.value = true;
    paused.value = document.visibilityState === 'hidden';
    if (options.immediate !== false && !paused.value) refreshNow();
    else schedule();
  }

  function stop() {
    running.value = false;
    clear();
  }

  function clear() {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  }

  function resolveInterval() {
    return Number(unref(intervalSource)) || 20_000;
  }

  function keepRefreshVisible(startedAt: number) {
    const remaining = 320 - (Date.now() - startedAt);
    return remaining > 0 ? new Promise((resolve) => window.setTimeout(resolve, remaining)) : Promise.resolve();
  }

  function handleVisibility() {
    paused.value = document.visibilityState === 'hidden';
    if (paused.value) {
      clear();
      return;
    }
    if (running.value) refreshNow();
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', handleVisibility);
  });

  watch(
    () => resolveInterval(),
    (next) => {
      currentInterval.value = next;
      schedule();
    },
  );

  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', handleVisibility);
    stop();
  });

  return {
    running,
    paused,
    refreshing,
    error,
    lastSuccessAt,
    currentInterval,
    start,
    stop,
    refreshNow,
  };
}
