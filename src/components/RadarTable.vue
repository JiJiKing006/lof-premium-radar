<script setup>
import { ref } from 'vue';
import { formatEmpty, premiumClass, priceClass } from '../domain/funds';

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

const securityColWidth = ref(loadSecurityColWidth());

const columns = [
  { key: 'favorite', label: '自选', disabled: true },
  { key: 'security', label: '基金', disabled: true },
  { key: 'changeRate', label: '涨跌幅' },
  { key: 'price', label: '现价' },
  { key: 'premiumRate', label: '实时溢价率' },
  { key: 'lastNav', label: '官方净值' },
  { key: 'estimatedNav', label: '估算净值' },
  { key: 'turnover', label: '成交额' },
];

function percentText(value, { sign = false } = {}) {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  if (!Number.isFinite(number)) return formatEmpty(value);
  const prefix = sign && number > 0 ? '+' : '';
  return `${prefix}${number.toFixed(2)}%`;
}

function amountText(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return formatEmpty(value);
  if (Math.abs(number) >= 100_000_000) return `${(number / 100_000_000).toFixed(2)}亿`;
  if (Math.abs(number) >= 10_000) return `${(number / 10_000).toFixed(1)}万`;
  return number.toFixed(0);
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

function estimatedDateText(row) {
  return row.navQuoteTime || row.navDate || row.quoteTime || '-';
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
    const nextWidth = Math.min(260, Math.max(144, startWidth + moveEvent.clientX - startX));
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
    const value = Number(window.localStorage.getItem('fund-security-col-width'));
    return Number.isFinite(value) ? Math.min(260, Math.max(144, value)) : 168;
  } catch {
    return 168;
  }
}

function storeSecurityColWidth(value) {
  try {
    window.localStorage.setItem('fund-security-col-width', String(Math.round(value)));
  } catch {
    // Ignore local storage errors.
  }
}
</script>

<template>
  <section class="table-card board" :style="{ '--security-col-width': `${securityColWidth}px` }" aria-label="LOF 溢价表格">
    <div class="table-meta board-topline">
      <strong>{{ rows.length }}</strong>
      <span>条记录</span>
    </div>

    <div class="table-scroll table-wrap">
      <table>
        <thead>
          <tr>
            <th
              v-for="column in columns"
              :key="column.key"
              :class="{ favorite: column.key === 'favorite', security: column.key === 'security', 'sorted-column': sortKey === column.key }"
            >
              <button v-if="!column.disabled" type="button" class="head-button" @click="$emit('sort', column.key)">
                <span>{{ column.label }}</span>
                <b v-if="sortKey === column.key">{{ sortDirection === 'asc' ? '↑' : '↓' }}</b>
                <b v-else>↕</b>
              </button>
              <template v-else-if="column.key === 'security'">
                <span>{{ column.label }}</span>
                <button
                  type="button"
                  class="col-resizer"
                  aria-label="调整基金列宽"
                  @pointerdown="beginSecurityResize"
                ></button>
              </template>
              <span v-else>{{ column.label }}</span>
            </th>
          </tr>
        </thead>
        <tbody :key="dataVersion" class="data-body">
          <tr v-if="loading">
            <td colspan="8" class="empty-state">正在加载行情数据</td>
          </tr>
          <tr v-else-if="!rows.length">
            <td colspan="8" class="empty-state">没有匹配的数据</td>
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
              <small>{{ hasValue(row.lastNav ?? row.nav) ? navDateText(row) : '未公布' }}</small>
            </td>
            <td data-key="estimatedNav" :class="{ 'sorted-column': sortKey === 'estimatedNav', changed: isChanged(row, ['estimatedNav', 'estimatedValue']) }">
              <strong>{{ navText(row.estimatedNav ?? row.estimatedValue) }}</strong>
              <small>{{ hasValue(row.estimatedNav ?? row.estimatedValue) ? estimatedDateText(row) : '-' }}</small>
            </td>
            <td data-key="turnover" :class="{ 'sorted-column': sortKey === 'turnover', changed: isChanged(row, ['turnover', 'amount']) }">{{ amountText(row.turnover ?? row.amount) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
