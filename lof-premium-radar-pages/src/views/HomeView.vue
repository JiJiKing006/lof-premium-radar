<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import DataStatusBar from '../components/DataStatusBar.vue';
import DetailPanel from '../components/DetailPanel.vue';
import FilterTabs from '../components/FilterTabs.vue';
import HotArbitragePanel from '../components/HotArbitragePanel.vue';
import RadarTable from '../components/RadarTable.vue';
import SearchBar from '../components/SearchBar.vue';
import SortBar from '../components/SortBar.vue';
import { useFilters } from '../composables/useFilters';
import { useFunds } from '../composables/useFunds';
import { useHotArbitrage } from '../composables/useHotArbitrage';
import type { FundItem, FundSortKey } from '../types/fund';

const AUTO_REFRESH_INTERVAL = 30_000;
const section = ref('LOF');
const selectedFund = ref<FundItem | null>(null);
const excludePausedPurchase = ref(false);
const sortDirection = ref<'asc' | 'desc'>('desc');
const { funds, meta, initialLoading, polling, refreshNow } = useFunds(section);
const { rows: hotArbitrageRows, loading: hotArbitrageLoading, error: hotArbitrageError, refreshHotArbitrage } = useHotArbitrage(section);
const favoriteCodes = ref<Set<string>>(new Set(loadFavoriteCodes()));
const toastText = ref('');
const pulseCode = ref('');
const manualRefreshing = ref(false);
const nowTick = ref(Date.now());
const showBackTop = ref(false);
let toastTimer: number | undefined;
let pulseTimer: number | undefined;
let countdownTimer: number | undefined;
let scrollTargets: Element[] = [];
const tabFunds = computed(() => {
  if (section.value !== 'WATCH') return funds.value;
  return funds.value.filter((fund) => favoriteCodes.value.has(fund.code));
});
const { query, sortKey, visibleFunds } = useFilters(tabFunds, excludePausedPurchase, sortDirection);
const pullStart = ref<number | null>(null);
const pullDistance = ref(0);

const pollingPaused = computed(() => polling.paused.value);
const pollingError = computed(() => polling.error.value);
const pollingLastSuccessAt = computed(() => polling.lastSuccessAt.value);
const nextRefreshIn = computed(() => {
  if (pollingPaused.value) return null;
  const lastSuccessMs = pollingLastSuccessAt.value ? Date.parse(pollingLastSuccessAt.value) : 0;
  if (!lastSuccessMs) return Math.round(AUTO_REFRESH_INTERVAL / 1000);
  return Math.max(0, Math.ceil((lastSuccessMs + AUTO_REFRESH_INTERVAL - nowTick.value) / 1000));
});
const abnormalCount = computed(() => funds.value.filter((fund) => fund.stale || fund.confidence < 70 || fund.errorMessage).length);
const displayedHotArbitrageRows = computed(() => hotArbitrageRows.value);
const showHotArbitrageEntry = computed(() => displayedHotArbitrageRows.value.length > 0);
const hotDrawerOpen = ref(false);
const hotTabTop = ref<number | null>(loadHotTabTop());
const hotTabDragging = ref(false);
const hotTabStyle = computed(() => (hotTabTop.value === null ? {} : { '--hot-tab-top': `${hotTabTop.value}px` }));
let hotTabPointerId: number | null = null;
let hotTabStartY = 0;
let hotTabStartTop = 0;
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

function onTouchStart(event: TouchEvent) {
  if (window.scrollY > 0) return;
  pullStart.value = event.touches[0]?.clientY ?? null;
}

function onTouchMove(event: TouchEvent) {
  if (pullStart.value === null) return;
  pullDistance.value = Math.max(0, (event.touches[0]?.clientY ?? 0) - pullStart.value);
}

function onTouchEnd() {
  if (pullDistance.value > 70) refreshNow();
  pullStart.value = null;
  pullDistance.value = 0;
}

async function handleManualRefresh() {
  if (manualRefreshing.value) return;
  const startedAt = Date.now();
  manualRefreshing.value = true;
  try {
    await refreshNow();
    await refreshHotArbitrage();
  } finally {
    await keepManualRefreshVisible(startedAt);
    manualRefreshing.value = false;
  }
}

function keepManualRefreshVisible(startedAt: number) {
  const remaining = 360 - (Date.now() - startedAt);
  return remaining > 0 ? new Promise((resolve) => window.setTimeout(resolve, remaining)) : Promise.resolve();
}

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
  hotDrawerOpen.value = false;
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

function onHotTabPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  hotTabPointerId = event.pointerId;
  hotTabStartY = event.clientY;
  hotTabStartTop = hotTabTop.value ?? Math.round(window.innerHeight * 0.48);
  hotTabDragging.value = false;
  window.addEventListener('pointermove', onHotTabPointerMove);
  window.addEventListener('pointerup', onHotTabPointerUp);
  window.addEventListener('pointercancel', onHotTabPointerCancel);
}

function onHotTabPointerMove(event: PointerEvent) {
  if (hotTabPointerId !== event.pointerId) return;
  const deltaY = event.clientY - hotTabStartY;
  if (Math.abs(deltaY) > 4) hotTabDragging.value = true;
  hotTabTop.value = clampHotTabTop(hotTabStartTop + deltaY);
}

function onHotTabPointerUp(event: PointerEvent) {
  if (hotTabPointerId !== event.pointerId) return;
  cleanupHotTabDrag();
  if (hotTabDragging.value) {
    storeHotTabTop(hotTabTop.value);
    window.setTimeout(() => {
      hotTabDragging.value = false;
    }, 0);
    return;
  }
  hotDrawerOpen.value = true;
}

function onHotTabPointerCancel() {
  cleanupHotTabDrag();
  hotTabDragging.value = false;
}

function cleanupHotTabDrag() {
  hotTabPointerId = null;
  window.removeEventListener('pointermove', onHotTabPointerMove);
  window.removeEventListener('pointerup', onHotTabPointerUp);
  window.removeEventListener('pointercancel', onHotTabPointerCancel);
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

function clampHotTabTop(value: number) {
  const min = 74;
  const max = Math.max(min, window.innerHeight - 74);
  return Math.min(max, Math.max(min, Math.round(value)));
}

watch(section, () => {
  selectedFund.value = null;
  excludePausedPurchase.value = false;
  sortKey.value = 'premiumRate';
  sortDirection.value = 'desc';
  hotDrawerOpen.value = false;
});

watch(showHotArbitrageEntry, (visible) => {
  if (!visible) hotDrawerOpen.value = false;
});

watch(selectedFund, () => {
  nextTick(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    refreshScrollTargets();
  });
});

watch(visibleFunds, () => {
  nextTick(refreshScrollTargets);
});

onMounted(() => {
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
  cleanupHotTabDrag();
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

function loadHotTabTop(): number | null {
  try {
    const value = Number(window.localStorage.getItem('hot-drawer-tab-top'));
    return Number.isFinite(value) ? clampHotTabTop(value) : null;
  } catch {
    return null;
  }
}

function storeHotTabTop(value: number | null) {
  if (value === null) return;
  try {
    window.localStorage.setItem('hot-drawer-tab-top', String(value));
  } catch {
    // Ignore local storage errors.
  }
}

</script>

<template>
  <main
    class="mobile-shell"
    :class="{ 'detail-mode': selectedFund }"
    @touchstart.passive="onTouchStart"
    @touchmove.passive="onTouchMove"
    @touchend.passive="onTouchEnd"
  >
    <template v-if="!selectedFund">
      <header class="mobile-header">
        <div class="mobile-brand">
          <p>Premium Radar</p>
          <h1>数据观察工具</h1>
          <div class="market-microline" aria-hidden="true">
            <i></i>
            <i></i>
            <i></i>
            <i></i>
            <i></i>
          </div>
        </div>
        <div class="radar-logo" :class="{ paused: pollingPaused }" aria-label="实时雷达">
          <span class="radar-grid"></span>
          <span class="radar-sweep"></span>
          <span class="radar-core"></span>
        </div>
      </header>

      <div class="pull-hint" :style="{ height: `${Math.min(pullDistance, 76)}px` }">
        {{ pullDistance > 70 ? '松开刷新' : '下拉刷新' }}
      </div>

      <div class="sticky-tools">
        <SearchBar v-model="query" :refreshing="manualRefreshing" @refresh="handleManualRefresh" />
        <DataStatusBar
          :meta="meta"
          :refreshing="manualRefreshing"
          :paused="pollingPaused"
          :error="pollingError"
          :last-success-at="pollingLastSuccessAt"
          :abnormal-count="abnormalCount"
          :next-refresh-in="nextRefreshIn"
        />
      </div>

      <FilterTabs v-model="section" />
      <SortBar v-model="excludePausedPurchase" />
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

    <button
      v-if="showHotArbitrageEntry && !selectedFund"
      type="button"
      class="hot-drawer-tab"
      :class="{ dragging: hotTabDragging }"
      :style="hotTabStyle"
      :aria-expanded="hotDrawerOpen"
      aria-controls="hot-drawer"
      @pointerdown="onHotTabPointerDown"
      @keydown.enter.prevent="hotDrawerOpen = true"
      @keydown.space.prevent="hotDrawerOpen = true"
    >
      <span>热门</span>
      <b>{{ displayedHotArbitrageRows.length }}</b>
    </button>

    <Transition name="drawer-fade">
      <div
        v-if="hotDrawerOpen"
        class="hot-drawer-mask"
        role="presentation"
        @click="hotDrawerOpen = false"
      ></div>
    </Transition>
    <Transition name="drawer-slide">
      <aside
        v-if="hotDrawerOpen"
        id="hot-drawer"
        class="hot-drawer"
        aria-label="热门观察侧边栏"
      >
        <div class="hot-drawer-head">
          <div>
            <strong>热门观察</strong>
            <span>仅作套利信号辅助</span>
          </div>
          <button type="button" aria-label="关闭热门观察" @click="hotDrawerOpen = false">×</button>
        </div>
        <HotArbitragePanel
          :rows="displayedHotArbitrageRows"
          :loading="false"
          :error="hotArbitrageError"
          compact
        />
      </aside>
    </Transition>

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
