<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import DataStatusBar from '../components/DataStatusBar.vue';
import DetailPanel from '../components/DetailPanel.vue';
import FilterTabs from '../components/FilterTabs.vue';
import MarketIndexStrip from '../components/MarketIndexStrip.vue';
import RadarTable from '../components/RadarTable.vue';
import SearchBar from '../components/SearchBar.vue';
import SortBar from '../components/SortBar.vue';
import { useFilters } from '../composables/useFilters';
import { useFunds } from '../composables/useFunds';
import { useMarketIndices } from '../composables/useMarketIndices';
import type { FundItem, FundSortKey } from '../types/fund';

const section = ref('LOF');
const selectedFund = ref<FundItem | null>(null);
const excludePausedPurchase = ref(false);
const sortDirection = ref<'asc' | 'desc'>('desc');
const { funds, meta, initialLoading, polling, refreshNow } = useFunds(section);
const { indices: indexRows, error: indexError } = useMarketIndices();
const favoriteCodes = ref<Set<string>>(new Set(loadFavoriteCodes()));
const toastText = ref('');
const pulseCode = ref('');
let toastTimer: number | undefined;
let pulseTimer: number | undefined;
const tabFunds = computed(() => {
  if (section.value !== 'WATCH') return funds.value;
  return funds.value.filter((fund) => favoriteCodes.value.has(fund.code));
});
const { query, sortKey, visibleFunds } = useFilters(tabFunds, excludePausedPurchase, sortDirection);
const pullStart = ref<number | null>(null);
const pullDistance = ref(0);

const abnormalCount = computed(() => funds.value.filter((fund) => fund.stale || fund.confidence < 70 || fund.errorMessage).length);

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

watch(section, () => {
  selectedFund.value = null;
  excludePausedPurchase.value = false;
  sortKey.value = 'premiumRate';
  sortDirection.value = 'desc';
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
</script>

<template>
  <main class="mobile-shell" @touchstart.passive="onTouchStart" @touchmove.passive="onTouchMove" @touchend.passive="onTouchEnd">
    <header class="mobile-header">
      <div class="mobile-brand">
        <p>Premium Radar</p>
        <h1>基金溢价雷达</h1>
        <div class="market-microline" aria-hidden="true">
          <i></i>
          <i></i>
          <i></i>
          <i></i>
          <i></i>
        </div>
      </div>
      <div class="radar-logo" :class="{ paused: polling.paused.value }" aria-label="实时雷达">
        <span class="radar-grid"></span>
        <span class="radar-sweep"></span>
        <span class="radar-core"></span>
      </div>
    </header>

    <div class="pull-hint" :style="{ height: `${Math.min(pullDistance, 76)}px` }">
      {{ pullDistance > 70 ? '松开刷新' : '下拉刷新' }}
    </div>

    <MarketIndexStrip :rows="indexRows" :error="indexError" />

    <div class="sticky-tools">
      <SearchBar v-model="query" :refreshing="polling.refreshing.value" @refresh="refreshNow" />
      <DataStatusBar
        :meta="meta"
        :refreshing="polling.refreshing.value"
        :paused="polling.paused.value"
        :error="polling.error.value"
        :last-success-at="polling.lastSuccessAt.value"
        :abnormal-count="abnormalCount"
      />
    </div>

    <FilterTabs v-model="section" />
    <SortBar v-model="excludePausedPurchase" />

    <DetailPanel
      v-if="selectedFund"
      :row="selectedFund"
      :section="section === 'WATCH' ? selectedFund.type : section"
      @back="selectedFund = null"
    />
    <RadarTable
      v-else
      :rows="visibleFunds.map((fund) => fund.raw || fund)"
      :loading="initialLoading"
      :sort-key="sortKey"
      :sort-direction="sortDirection"
      :favorite-codes="favoriteCodes"
      :pulse-code="pulseCode"
      @sort="handleTableSort"
      @toggle-favorite="toggleFavorite"
      @select="selectedFund = fundFromRaw($event)"
    />

    <Transition name="toast">
      <div v-if="toastText" class="watch-toast" role="status">{{ toastText }}</div>
    </Transition>
  </main>
</template>
