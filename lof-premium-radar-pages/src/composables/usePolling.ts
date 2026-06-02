import { onBeforeUnmount, onMounted, ref, unref, watch, type Ref } from 'vue';

interface UsePollingOptions<T> {
  interval?: number | Ref<number>;
  maxInterval?: number;
  immediate?: boolean;
  prefetchLeadMs?: number;
  onData?: (data: T) => void | Promise<void>;
}

type PreparedResult<T> =
  | { status: 'pending'; promise: Promise<T> }
  | { status: 'resolved'; data: T }
  | { status: 'rejected'; error: unknown };

export function usePolling<T = void>(task: () => Promise<T>, options: UsePollingOptions<T> = {}) {
  const intervalSource = options.interval ?? 20_000;
  const maxInterval = options.maxInterval ?? 60_000;
  const running = ref(false);
  const paused = ref(false);
  const refreshing = ref(false);
  const prefetching = ref(false);
  const error = ref('');
  const lastSuccessAt = ref<string | null>(null);
  const nextRefreshAt = ref<number | null>(null);
  const currentInterval = ref(resolveInterval());
  let refreshTimer: number | null = null;
  let prefetchTimer: number | null = null;
  let cycleId = 0;
  let prepared: PreparedResult<T> | null = null;
  let lastRequestDurationMs = 0;

  async function refreshNow() {
    if (refreshing.value) return;
    cycleId += 1;
    clear();
    prepared = null;
    const startedAt = Date.now();
    refreshing.value = true;
    prefetching.value = false;
    error.value = '';
    try {
      const data = await runTaskWithTiming();
      await applyData(data);
      currentInterval.value = resolveInterval();
      lastSuccessAt.value = new Date().toISOString();
    } catch (event) {
      error.value = event instanceof Error ? event.message : '刷新失败';
      currentInterval.value = Math.min(currentInterval.value * 2, maxInterval);
    } finally {
      schedule();
      await keepRefreshVisible(startedAt);
      refreshing.value = false;
    }
  }

  function schedule() {
    if (!running.value || paused.value) return;
    clear();
    prepared = null;
    const interval = currentInterval.value;
    const dueAt = Date.now() + interval;
    const currentCycle = cycleId;
    nextRefreshAt.value = dueAt;
    const leadMs = resolvePrefetchLead(interval);
    if (leadMs > 0) {
      prefetchTimer = window.setTimeout(() => {
        startPrefetch(currentCycle);
      }, Math.max(0, dueAt - leadMs - Date.now()));
    }
    refreshTimer = window.setTimeout(() => {
      commitScheduledRefresh(currentCycle);
    }, Math.max(0, dueAt - Date.now()));
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
    nextRefreshAt.value = null;
  }

  function clear() {
    if (refreshTimer !== null) {
      window.clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    if (prefetchTimer !== null) {
      window.clearTimeout(prefetchTimer);
      prefetchTimer = null;
    }
  }

  function resolveInterval() {
    return Number(unref(intervalSource)) || 20_000;
  }

  function resolvePrefetchLead(interval: number) {
    const fixedLead = Math.max(0, Number(options.prefetchLeadMs) || 0);
    const adaptiveLead = lastRequestDurationMs > 0 ? lastRequestDurationMs + 1_000 : 0;
    const lead = Math.max(fixedLead, adaptiveLead);
    return Math.min(lead, Math.max(0, interval - 1_000));
  }

  async function applyData(data: T) {
    if (options.onData) await options.onData(data);
  }

  async function runTaskWithTiming() {
    const startedAt = Date.now();
    try {
      return await task();
    } finally {
      lastRequestDurationMs = Math.max(0, Date.now() - startedAt);
    }
  }

  async function startPrefetch(targetCycleId: number) {
    if (!running.value || paused.value || targetCycleId !== cycleId || refreshing.value || prepared) return;
    prefetching.value = true;
    error.value = '';
    const promise = runTaskWithTiming();
    prepared = { status: 'pending', promise };
    try {
      const data = await promise;
      if (targetCycleId !== cycleId) return;
      prepared = { status: 'resolved', data };
    } catch (event) {
      if (targetCycleId !== cycleId) return;
      prepared = { status: 'rejected', error: event };
    } finally {
      if (targetCycleId === cycleId) prefetching.value = false;
    }
  }

  async function commitScheduledRefresh(targetCycleId: number) {
    if (!running.value || paused.value || targetCycleId !== cycleId || refreshing.value) return;
    const startedAt = Date.now();
    refreshing.value = true;
    error.value = '';
    try {
      let data: T;
      if (prepared?.status === 'resolved') {
        data = prepared.data;
      } else if (prepared?.status === 'pending') {
        data = await prepared.promise;
      } else if (prepared?.status === 'rejected') {
        throw prepared.error;
      } else {
        data = await runTaskWithTiming();
      }
      if (targetCycleId !== cycleId) return;
      await applyData(data);
      currentInterval.value = resolveInterval();
      lastSuccessAt.value = new Date().toISOString();
    } catch (event) {
      if (targetCycleId !== cycleId) return;
      error.value = event instanceof Error ? event.message : '刷新失败';
      currentInterval.value = Math.min(currentInterval.value * 2, maxInterval);
    } finally {
      if (targetCycleId !== cycleId) return;
      cycleId += 1;
      schedule();
      await keepRefreshVisible(startedAt);
      refreshing.value = false;
    }
  }

  function keepRefreshVisible(startedAt: number) {
    const remaining = 320 - (Date.now() - startedAt);
    return remaining > 0 ? new Promise((resolve) => window.setTimeout(resolve, remaining)) : Promise.resolve();
  }

  function handleVisibility() {
    paused.value = document.visibilityState === 'hidden';
    if (paused.value) {
      clear();
      nextRefreshAt.value = null;
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
    prefetching,
    error,
    lastSuccessAt,
    nextRefreshAt,
    currentInterval,
    start,
    stop,
    refreshNow,
  };
}
