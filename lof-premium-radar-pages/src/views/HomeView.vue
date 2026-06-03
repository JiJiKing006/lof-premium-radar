<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import DataStatusBar from '../components/DataStatusBar.vue';
import DetailPanel from '../components/DetailPanel.vue';
import FilterTabs from '../components/FilterTabs.vue';
import RadarTable from '../components/RadarTable.vue';
import SearchBar from '../components/SearchBar.vue';
import SortBar from '../components/SortBar.vue';
import { recordVisitor } from '../api/analytics';
import { useFilters } from '../composables/useFilters';
import { useFunds } from '../composables/useFunds';
import type { FundItem, FundSortKey } from '../types/fund';

const AUTO_REFRESH_INTERVAL = 30_000;
const VISITOR_DEVICE_KEY = 'lof-visitor-device-id';
const section = ref('LOF');
const selectedFund = ref<FundItem | null>(null);
const excludePausedPurchase = ref(false);
const sortDirection = ref<'asc' | 'desc'>('desc');
const { funds, meta, initialLoading, polling } = useFunds(section);
const favoriteCodes = ref<Set<string>>(new Set(loadFavoriteCodes()));
const toastText = ref('');
const pulseCode = ref('');
const nowTick = ref(Date.now());
const showBackTop = ref(false);
const shellRef = ref<HTMLElement | null>(null);
let toastTimer: number | undefined;
let pulseTimer: number | undefined;
let countdownTimer: number | undefined;
let scrollTargets: Element[] = [];
const tabFunds = computed(() => {
  if (section.value !== 'WATCH') return funds.value;
  return funds.value.filter((fund) => favoriteCodes.value.has(fund.code));
});
const { query, sortKey, visibleFunds } = useFilters(tabFunds, excludePausedPurchase, sortDirection);
const pollingPaused = computed(() => polling.paused.value);
const pollingError = computed(() => polling.error.value);
const pollingLastSuccessAt = computed(() => polling.lastSuccessAt.value);
const pollingNextRefreshAt = computed(() => polling.nextRefreshAt.value);
const activeTypeLabel = computed(() => {
  if (section.value === 'WATCH') return '自选';
  if (section.value === 'QDII') return 'QDII类型';
  if (section.value === 'ETF') return 'ETF类型';
  return 'LOF类型';
});
const nextRefreshIn = computed(() => {
  if (pollingPaused.value) return null;
  const intervalSeconds = Math.round(AUTO_REFRESH_INTERVAL / 1000);
  const target = pollingNextRefreshAt.value;
  if (!target) return intervalSeconds;
  return Math.min(intervalSeconds, Math.max(0, Math.ceil((target - nowTick.value) / 1000)));
});
const abnormalCount = computed(() => funds.value.filter((fund) => fund.stale || fund.confidence < 70 || fund.errorMessage).length);
const dataVersion = computed(() => {
  const rowSignature = visibleFunds.value
    .map((fund) => [
      fund.code,
      fund.marketPrice ?? fund.price ?? '',
      fund.changeRate ?? fund.changePercent ?? '',
      fund.premiumRate ?? '',
      fund.lastNav ?? fund.nav ?? '',
      fund.estimatedNav ?? fund.estimatedValue ?? '',
      fund.turnover ?? fund.amount ?? '',
    ].join(':'))
    .join('|');
  return `${meta.value?.updateTime || meta.value?.latestQuoteTime || 'initial'}:${rowSignature}`;
});

function handleTableSort(key: FundSortKey) {
  if (sortKey.value === key) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc';
    return;
  }
  sortKey.value = key;
  sortDirection.value = 'asc';
}

function fundFromRaw(raw: Record<string, unknown>): FundItem {
  return (raw.__fundItem as FundItem) || (raw as unknown as FundItem);
}

function handleSelectFund(raw: Record<string, unknown>) {
  selectedFund.value = fundFromRaw(raw);
}

function handleDetailBack() {
  selectedFund.value = null;
}

function toggleFavorite(raw: Record<string, unknown>) {
  const fund = fundFromRaw(raw);
  const next = new Set(favoriteCodes.value);
  const willAdd = !next.has(fund.code);
  if (willAdd) {
    next.add(fund.code);
  } else {
    next.delete(fund.code);
  }
  favoriteCodes.value = next;
  storeFavoriteCodes(next);
  pulseCode.value = fund.code;
  window.clearTimeout(pulseTimer);
  pulseTimer = window.setTimeout(() => {
    pulseCode.value = '';
  }, 650);
  showToast(willAdd ? `已加入自选：${fund.name}` : `已移出自选：${fund.name}`);
}

function showToast(message: string) {
  toastText.value = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastText.value = '';
  }, 1800);
}

function refreshScrollTargets() {
  cleanupScrollTargets();
  scrollTargets = Array.from(document.querySelectorAll('.table-scroll, .detail-scroll'));
  scrollTargets.forEach((target) => {
    target.addEventListener('scroll', syncBackTopVisibility, { passive: true });
  });
  syncBackTopVisibility();
}

function cleanupScrollTargets() {
  scrollTargets.forEach((target) => {
    target.removeEventListener('scroll', syncBackTopVisibility);
  });
  scrollTargets = [];
}

function syncBackTopVisibility() {
  showBackTop.value = window.scrollY > 160 || scrollTargets.some((target) => target.scrollTop > 160);
}

function scrollToPageTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  scrollTargets.forEach((target) => {
    target.scrollTo({ top: 0, behavior: 'smooth' });
  });
  window.setTimeout(syncBackTopVisibility, 360);
}

function resetShellScroll() {
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (shellRef.value) {
    shellRef.value.scrollTop = 0;
    shellRef.value.scrollTo({ top: 0, behavior: 'auto' });
  }
}

watch(section, () => {
  selectedFund.value = null;
  excludePausedPurchase.value = false;
  sortKey.value = 'premiumRate';
  sortDirection.value = 'desc';
});

watch(selectedFund, () => {
  nextTick(() => {
    if (selectedFund.value) {
      resetShellScroll();
    }
    refreshScrollTargets();
  });
});

watch(visibleFunds, () => {
  nextTick(refreshScrollTargets);
});

onMounted(() => {
  recordCurrentVisit();
  countdownTimer = window.setInterval(() => {
    nowTick.value = Date.now();
  }, 1_000);
  window.addEventListener('scroll', syncBackTopVisibility, { passive: true });
  nextTick(refreshScrollTargets);
});

onBeforeUnmount(() => {
  window.clearInterval(countdownTimer);
  window.removeEventListener('scroll', syncBackTopVisibility);
  cleanupScrollTargets();
});

function loadFavoriteCodes(): string[] {
  try {
    const raw = window.localStorage.getItem('fund-watchlist');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function storeFavoriteCodes(codes: Set<string>) {
  try {
    window.localStorage.setItem('fund-watchlist', JSON.stringify([...codes]));
  } catch {
    // Ignore local storage errors.
  }
}

function recordCurrentVisit() {
  try {
    recordVisitor(getOrCreateDeviceId()).catch(() => {});
  } catch {
    // Analytics must never block the fund radar.
  }
}

function getOrCreateDeviceId() {
  const existing = window.localStorage.getItem(VISITOR_DEVICE_KEY);
  if (existing) return existing;
  const next = createDeviceId();
  window.localStorage.setItem(VISITOR_DEVICE_KEY, next);
  return next;
}

function createDeviceId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `visitor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

</script>

<template>
  <main ref="shellRef" class="mobile-shell" :class="{ 'detail-mode': selectedFund }">
    <template v-if="!selectedFund">
      <header class="mobile-header">
        <div class="mobile-brand">
          <p>Premium Radar</p>
          <h1>实时溢价工具</h1>
          <span class="mobile-subtitle">{{ activeTypeLabel }} · 移动 H5</span>
        </div>
        <div class="radar-logo" :class="{ paused: pollingPaused }" aria-label="实时雷达">
          <span class="radar-grid"></span>
          <span class="radar-sweep"></span>
          <span class="radar-core"></span>
        </div>
      </header>

      <DataStatusBar
        :meta="meta"
        :paused="pollingPaused"
        :error="pollingError"
        :last-success-at="pollingLastSuccessAt"
        :abnormal-count="abnormalCount"
        :next-refresh-in="nextRefreshIn"
      />

      <div class="sticky-tools" aria-label="基金筛选工具">
        <SearchBar v-model="query" />
        <FilterTabs v-model="section" />
        <SortBar v-model="excludePausedPurchase" />
      </div>
    </template>

    <DetailPanel
      v-if="selectedFund"
      :row="selectedFund"
      :section="section === 'WATCH' ? selectedFund.type : section"
      @back="handleDetailBack"
    />
    <template v-else>
      <RadarTable
        :rows="visibleFunds.map((fund) => fund.raw || fund)"
        :loading="initialLoading"
        :sort-key="sortKey"
        :sort-direction="sortDirection"
        :favorite-codes="favoriteCodes"
        :pulse-code="pulseCode"
        :data-version="dataVersion"
        @sort="handleTableSort"
        @toggle-favorite="toggleFavorite"
        @select="handleSelectFund"
      />
    </template>

    <footer class="author-mark" aria-label="作者标识">
      <span>作者</span>
      <strong>jijiking</strong>
    </footer>
    <div class="bottom-safe-area" aria-hidden="true"></div>

    <Transition name="toast">
      <div v-if="toastText" class="watch-toast" role="status">{{ toastText }}</div>
    </Transition>

    <Transition name="back-top">
      <button
        v-if="showBackTop"
        type="button"
        class="back-top-button"
        aria-label="返回顶部"
        @click="scrollToPageTop"
      >
        <b>↑</b>
        <span>顶部</span>
      </button>
    </Transition>
  </main>
</template>
