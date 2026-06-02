<script setup>
import { computed, shallowRef, ref, watchEffect } from 'vue';
import { formatEmpty, premiumClass, priceClass } from '../domain/funds';
import { computeSmartColumnWidths, createColumnWidthVars, stabilizeColumnWidths } from '../utils/adaptiveTableColumns';
import { sourceLabel, sourceReference } from '../utils/sourceLinks';

const props = defineProps({
  rows: { type: Array, required: true },
  loading: { type: Boolean, default: false },
  sortKey: { type: String, required: true },
  sortDirection: { type: String, required: true },
  favoriteCodes: { type: Set, default: () => new Set() },
  pulseCode: { type: String, default: '' },
  dataVersion: { type: String, default: '' },
});

defineEmits(['sort', 'select', 'toggleFavorite']);

const SECURITY_COL_MIN_WIDTH = 102;
const SECURITY_COL_MAX_WIDTH = 138;
const SECURITY_COL_DEFAULT_WIDTH = 116;
const SECURITY_COL_STORAGE_KEY = 'fund-security-col-width-v4';
const skeletonRows = Array.from({ length: 10 }, (_, index) => index);

const securityColWidth = ref(loadSecurityColWidth());
const stableColumnWidths = shallowRef({});

const columns = [
  {
    key: 'favorite',
    title: '自选',
    disabled: true,
    type: 'status',
    priority: 'low',
    minWidth: 36,
    preferredWidth: 36,
    maxWidth: 36,
    nowrap: true,
    value: () => '',
  },
  {
    key: 'security',
    title: '基金',
    disabled: true,
    type: 'fund',
    priority: 'high',
    minWidth: SECURITY_COL_MIN_WIDTH,
    preferredWidth: SECURITY_COL_DEFAULT_WIDTH,
    maxWidth: SECURITY_COL_MAX_WIDTH,
    clamp: 2,
    value: (row) => `${row.name || ''} ${row.code || ''}`,
  },
  {
    key: 'changeRate',
    title: '涨跌幅',
    type: 'percent',
    priority: 'medium',
    minWidth: 58,
    preferredWidth: 66,
    maxWidth: 76,
    nowrap: true,
    value: (row) => percentText(row.changeRate ?? row.changePercent ?? row.changeValue, { sign: true }),
  },
  {
    key: 'price',
    title: '现价',
    type: 'number',
    priority: 'high',
    minWidth: 56,
    preferredWidth: 64,
    maxWidth: 72,
    nowrap: true,
    value: (row) => navText(row.marketPrice ?? row.price, '-'),
  },
  {
    key: 'premiumRate',
    title: '实时溢价率',
    type: 'percent',
    priority: 'high',
    minWidth: 78,
    preferredWidth: 90,
    maxWidth: 104,
    nowrap: true,
    value: (row) => `${percentText(row.premiumRate ?? row.realtimePremiumValue ?? row.realtimePremium)} ${row.premiumNote || ''}`,
  },
  {
    key: 'lastNav',
    title: '官方净值',
    type: 'number',
    priority: 'high',
    minWidth: 82,
    preferredWidth: 94,
    maxWidth: 108,
    clamp: 2,
    value: (row) => `${navText(row.lastNav ?? row.nav)} ${sourceText(navSource(row))} ${navDateText(row)}`,
  },
  {
    key: 'estimatedNav',
    title: '估算净值',
    type: 'number',
    priority: 'medium',
    minWidth: 82,
    preferredWidth: 94,
    maxWidth: 108,
    clamp: 2,
    value: (row) => `${navText(row.estimatedNav ?? row.estimatedValue)} ${sourceText(estimatedSource(row))} ${estimatedTimeText(row)}`,
  },
];

watchEffect(() => {
  const widths = computeSmartColumnWidths(columns, props.rows);
  if (widths.security) widths.security.width = securityColWidth.value;
  stableColumnWidths.value = stabilizeColumnWidths(stableColumnWidths.value, widths);
});

const tableStyle = computed(() => {
  return createColumnWidthVars(stableColumnWidths.value);
});

function percentText(value, { sign = false } = {}) {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  if (!Number.isFinite(number)) return formatEmpty(value);
  const prefix = sign && number > 0 ? '+' : '';
  return `${prefix}${number.toFixed(2)}%`;
}

function navText(value, fallback = '未公布') {
  return value === null || value === undefined || value === '' ? fallback : value;
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== '';
}

function purchaseLimit(row) {
  const limit = row.purchaseLimit || {};
  const label = limit.label || limit.limitText || '未知';
  return {
    label: normalizePurchaseLabel(label, limit.state),
    state: limit.state || 'unknown',
  };
}

function normalizePurchaseLabel(label, state) {
  const text = String(label || '').trim();
  if (state === 'open' && (/无限额|不限额/.test(text) || /开放/.test(text))) return '不限额';
  if (/开放申购\s*\/\s*无限额|开放申购.*不限额/.test(text)) return '不限额';
  return text || '未知';
}

function navDateText(row) {
  return row.navDate || row.navQuoteTime || row.quoteTime || '-';
}

function navSource(row) {
  return row.navSource || row.raw?.navSource || row.source || '';
}

function estimatedSource(row) {
  return row.estimatedNavSource || row.raw?.estimatedNavSource || '';
}

function estimatedTimeText(row) {
  return row.estimatedNavTime || row.navQuoteTime || row.navDate || row.quoteTime || '';
}

function sourceHref(source, row) {
  return sourceReference(source, row.code, row.type)?.url || '';
}

function sourceText(source) {
  return sourceLabel(source) || '暂无数据';
}

function valueClass(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return 'is-flat';
  return number > 0 ? 'is-up' : 'is-down';
}

function isFavorite(row) {
  return Boolean(row?.code && props.favoriteCodes?.has(row.code));
}

function isChanged(row, keys) {
  return keys.some((key) => row.changedFields?.includes(key));
}

function beginSecurityResize(event) {
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const startWidth = securityColWidth.value;
  const pointerId = event.pointerId;
  event.currentTarget.setPointerCapture?.(pointerId);

  function onMove(moveEvent) {
    const nextWidth = Math.min(
      SECURITY_COL_MAX_WIDTH,
      Math.max(SECURITY_COL_MIN_WIDTH, startWidth + moveEvent.clientX - startX),
    );
    securityColWidth.value = nextWidth;
  }

  function onEnd() {
    storeSecurityColWidth(securityColWidth.value);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onEnd);
    window.removeEventListener('pointercancel', onEnd);
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onEnd);
  window.addEventListener('pointercancel', onEnd);
}

function loadSecurityColWidth() {
  try {
    const storedValue = window.localStorage.getItem(SECURITY_COL_STORAGE_KEY);
    if (storedValue === null) return SECURITY_COL_DEFAULT_WIDTH;
    const value = Number(storedValue);
    return Number.isFinite(value)
      ? Math.min(SECURITY_COL_MAX_WIDTH, Math.max(SECURITY_COL_MIN_WIDTH, value))
      : SECURITY_COL_DEFAULT_WIDTH;
  } catch {
    return SECURITY_COL_DEFAULT_WIDTH;
  }
}

function storeSecurityColWidth(value) {
  try {
    window.localStorage.setItem(SECURITY_COL_STORAGE_KEY, String(Math.round(value)));
  } catch {
    // Ignore local storage errors.
  }
}

function columnWidthVar(column) {
  return `var(--col-${column.key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}-width)`;
}
</script>

<template>
  <section class="table-card board" :style="tableStyle" aria-label="LOF 溢价表格">
    <div class="table-meta board-topline">
      <span class="table-title">基金观察表格</span>
      <strong>{{ rows.length }}</strong>
      <span>条记录</span>
    </div>

    <div class="table-scroll table-wrap">
      <table>
        <colgroup>
          <col
            v-for="column in columns"
            :key="column.key"
            :class="column.key"
            :style="{ width: columnWidthVar(column) }"
          >
        </colgroup>
        <thead>
          <tr>
            <th
              v-for="column in columns"
              :key="column.key"
              :class="{ favorite: column.key === 'favorite', security: column.key === 'security', 'sorted-column': sortKey === column.key }"
            >
              <button v-if="!column.disabled" type="button" class="head-button" @click="$emit('sort', column.key)">
                <span>{{ column.title }}</span>
                <b v-if="sortKey === column.key">{{ sortDirection === 'asc' ? '↑' : '↓' }}</b>
                <b v-else>↕</b>
              </button>
              <template v-else-if="column.key === 'security'">
                <span>{{ column.title }}</span>
                <button
                  type="button"
                  class="col-resizer"
                  aria-label="调整基金列宽"
                  @pointerdown="beginSecurityResize"
                ></button>
              </template>
              <span v-else>{{ column.title }}</span>
            </th>
          </tr>
        </thead>
        <tbody :key="dataVersion" class="data-body">
          <template v-if="loading">
            <tr
              v-for="row in skeletonRows"
              :key="`market-skeleton-${row}`"
              class="data-row skeleton-row"
              aria-hidden="true"
            >
              <td class="favorite" data-key="favorite">
                <span class="skeleton-line skeleton-dot"></span>
              </td>
              <td class="security" data-key="security">
                <div class="fund-cell skeleton-fund">
                  <span class="skeleton-line skeleton-name"></span>
                  <span class="skeleton-line skeleton-code"></span>
                </div>
              </td>
              <td data-key="changeRate"><span class="skeleton-line skeleton-num"></span></td>
              <td data-key="price"><span class="skeleton-line skeleton-num short"></span></td>
              <td data-key="premiumRate">
                <span class="skeleton-line skeleton-num"></span>
                <span class="skeleton-line skeleton-note"></span>
              </td>
              <td data-key="lastNav">
                <span class="skeleton-line skeleton-num short"></span>
                <span class="skeleton-line skeleton-note"></span>
              </td>
              <td data-key="estimatedNav">
                <span class="skeleton-line skeleton-num short"></span>
                <span class="skeleton-line skeleton-note long"></span>
              </td>
            </tr>
          </template>
          <tr v-else-if="!rows.length">
            <td colspan="7" class="empty-state">没有匹配的数据</td>
          </tr>
          <tr
            v-for="(row, index) in rows"
            v-else
            :key="row.code"
            class="data-row"
            :style="{ animationDelay: `${Math.min(index, 12) * 18}ms` }"
            @click="$emit('select', row)"
          >
            <td class="favorite" data-key="favorite">
              <button
                type="button"
                class="watch-button"
                :class="{ active: isFavorite(row), burst: pulseCode === row.code }"
                :aria-label="isFavorite(row) ? `取消自选 ${row.name}` : `加入自选 ${row.name}`"
                @click.stop="$emit('toggleFavorite', row)"
              >
                <svg class="watch-star" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    class="watch-star-path"
                    d="M12 3.8 14.35 8.55 19.6 9.3 15.8 13.02 16.7 18.25 12 15.78 7.3 18.25 8.2 13.02 4.4 9.3 9.65 8.55 12 3.8Z"
                  />
                </svg>
              </button>
            </td>
            <td class="security" data-key="security">
              <div class="fund-cell">
                <strong>{{ row.name }}</strong>
                <span>
                  <b>{{ row.code }}</b>
                  <small :class="`limit-${purchaseLimit(row).state}`">{{ purchaseLimit(row).label }}</small>
                </span>
              </div>
            </td>
            <td data-key="changeRate" :class="[valueClass(row.changeRate ?? row.changePercent ?? row.changeValue), { 'sorted-column': sortKey === 'changeRate', changed: isChanged(row, ['changeRate', 'changePercent', 'changeValue']) }]">{{ percentText(row.changeRate ?? row.changePercent ?? row.changeValue, { sign: true }) }}</td>
            <td data-key="price" :class="[priceClass({ change: row.changeRate ?? row.change }), { 'sorted-column': sortKey === 'price', changed: isChanged(row, ['price', 'marketPrice']) }]">
              <strong>{{ navText(row.marketPrice ?? row.price, '-') }}</strong>
            </td>
            <td data-key="premiumRate" :class="[premiumClass(row.premiumRate ?? row.realtimePremium), { 'sorted-column': sortKey === 'premiumRate', changed: isChanged(row, ['premiumRate', 'realtimePremium']) }]">
              <strong>{{ percentText(row.premiumRate ?? row.realtimePremiumValue ?? row.realtimePremium) }}</strong>
              <small>{{ row.premiumNote || '-' }}</small>
            </td>
            <td data-key="lastNav" :class="{ 'sorted-column': sortKey === 'lastNav', changed: isChanged(row, ['lastNav', 'nav']) }">
              <strong>{{ navText(row.lastNav ?? row.nav) }}</strong>
              <small>
                <template v-if="hasValue(row.lastNav ?? row.nav)">
                  <a
                    v-if="sourceHref(navSource(row), row)"
                    class="source-link"
                    :href="sourceHref(navSource(row), row)"
                    target="_blank"
                    rel="noopener noreferrer"
                    @click.stop
                  >{{ sourceText(navSource(row)) }}</a>
                  <span v-else>{{ sourceText(navSource(row)) }}</span>
                  <span class="nav-date-text">{{ navDateText(row) }}</span>
                </template>
                <template v-else>未公布</template>
              </small>
            </td>
            <td data-key="estimatedNav" :class="{ 'sorted-column': sortKey === 'estimatedNav', changed: isChanged(row, ['estimatedNav', 'estimatedValue']) }">
              <strong>{{ navText(row.estimatedNav ?? row.estimatedValue) }}</strong>
              <small>
                <template v-if="hasValue(row.estimatedNav ?? row.estimatedValue)">
                  <a
                    v-if="sourceHref(estimatedSource(row), row)"
                    class="source-link"
                    :href="sourceHref(estimatedSource(row), row)"
                    target="_blank"
                    rel="noopener noreferrer"
                    @click.stop
                  >{{ sourceText(estimatedSource(row)) }}</a>
                  <span v-else>{{ sourceText(estimatedSource(row)) }}</span>
                  <span v-if="estimatedTimeText(row)" class="estimated-time-text">{{ estimatedTimeText(row) }}</span>
                </template>
                <template v-else>暂无数据</template>
              </small>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
