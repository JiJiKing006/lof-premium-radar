import { computed, onBeforeUnmount, onMounted, ref, unref, watch } from 'vue';
import { fetchFundSnapshot } from '../api/funds';
import { toNumber } from '../domain/funds';

const REFRESH_MS = 60_000;

export function useFundRadar(activeSection) {
  const rows = ref([]);
  const meta = ref(null);
  const query = ref('');
  const stance = ref('all');
  const sortKey = ref('realtimePremiumValue');
  const sortDirection = ref('desc');
  const loading = ref(true);
  const refreshing = ref(false);
  const error = ref('');
  let timer = null;

  const load = async ({ force = false } = {}) => {
    refreshing.value = true;
    error.value = '';
    try {
      const snapshot = await fetchFundSnapshot({ force, section: unref(activeSection) || 'lof' });
      rows.value = snapshot.rows || [];
      meta.value = snapshot.meta || snapshot;
    } catch (event) {
      error.value = event instanceof Error ? event.message : '行情更新失败';
    } finally {
      loading.value = false;
      refreshing.value = false;
    }
  };

  const filteredRows = computed(() => {
    const keyword = query.value.trim().toLowerCase();
    const list = rows.value.filter((row) => {
      const matchKeyword =
        !keyword ||
        String(row.code || '').toLowerCase().includes(keyword) ||
        String(row.name || '').toLowerCase().includes(keyword) ||
        String(row.indexName || '').toLowerCase().includes(keyword);
      const realtimePremium = toNumber(row.realtimePremium);
      const officialPremium = toNumber(row.officialPremium);
      const matchStance =
        stance.value === 'all' ||
        (stance.value === 'discount' && realtimePremium !== null && realtimePremium < 0) ||
        (stance.value === 'premium' && realtimePremium !== null && realtimePremium > 0) ||
        (stance.value === 'live' && realtimePremium !== null) ||
        (stance.value === 'official-discount' && officialPremium !== null && officialPremium < 0);
      return matchKeyword && matchStance;
    });

    return [...list].sort((a, b) => {
      const left = valueForSort(a, sortKey.value);
      const right = valueForSort(b, sortKey.value);
      const direction = sortDirection.value === 'asc' ? 1 : -1;

      if (typeof left === 'number' || typeof right === 'number') {
        const safeLeft = Number.isFinite(left) ? left : Number.NEGATIVE_INFINITY;
        const safeRight = Number.isFinite(right) ? right : Number.NEGATIVE_INFINITY;
        return (safeLeft - safeRight) * direction || (a.rank || 0) - (b.rank || 0);
      }

      return String(left).localeCompare(String(right), 'zh-CN') * direction || (a.rank || 0) - (b.rank || 0);
    });
  });

  const summary = computed(() => {
    const premiums = rows.value.map((row) => toNumber(row.realtimePremium)).filter((value) => value !== null);
    return {
      total: rows.value.length,
      visible: filteredRows.value.length,
      live: premiums.length,
      high: premiums.length ? Math.max(...premiums) : null,
      low: premiums.length ? Math.min(...premiums) : null,
    };
  });

  const setSort = (key) => {
    if (sortKey.value === key) {
      sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc';
      return;
    }
    sortKey.value = key;
    sortDirection.value = key === 'quoteDateTime' || key === 'priceValue' ? 'desc' : 'asc';
  };

  onMounted(() => {
    load();
    timer = window.setInterval(() => load(), REFRESH_MS);
  });

  watch(
    () => unref(activeSection),
    () => {
      rows.value = [];
      loading.value = true;
      load();
    },
  );

  onBeforeUnmount(() => {
    if (timer) window.clearInterval(timer);
  });

  return {
    rows,
    meta,
    query,
    stance,
    sortKey,
    sortDirection,
    loading,
    refreshing,
    error,
    filteredRows,
    summary,
    load,
    setSort,
  };
}

function valueForSort(row, key) {
  if (key === 'security') return `${row.code || ''}${row.name || ''}`;
  if (key === 'quoteDateTime') return `${row.quoteDate || ''} ${row.quoteTime || ''}`;
  if (key.endsWith('Value')) return row[key] ?? Number.NaN;
  return row[key] ?? '';
}
