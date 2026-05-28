<script setup>
import { formatEmpty, premiumClass, priceClass } from '../domain/funds';
import Sparkline from './Sparkline.vue';

const props = defineProps({
  rows: { type: Array, required: true },
  loading: { type: Boolean, default: false },
  sortKey: { type: String, required: true },
  sortDirection: { type: String, required: true },
  favoriteCodes: { type: Set, default: () => new Set() },
  pulseCode: { type: String, default: '' },
});

defineEmits(['sort', 'select', 'toggleFavorite']);

const columns = [
  { key: 'favorite', label: '自选', disabled: true },
  { key: 'security', label: '基金', disabled: true },
  { key: 'changeRate', label: '涨跌幅' },
  { key: 'price', label: '现价' },
  { key: 'premiumRate', label: '实时溢价率' },
  { key: 'lastNav', label: '官方净值' },
  { key: 'estimatedNav', label: '估算净值' },
  { key: 'turnover', label: '成交额' },
  { key: 'trend', label: '分时预览', disabled: true },
];

function percentText(value) {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  if (!Number.isFinite(number)) return formatEmpty(value);
  return `${number.toFixed(2)}%`;
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
  return {
    label: limit.label || limit.limitText || '未知',
    state: limit.state || 'unknown',
  };
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
</script>

<template>
  <section class="table-card board" aria-label="LOF 溢价表格">
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
              <span v-else>{{ column.label }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="9" class="empty-state">正在加载行情数据</td>
          </tr>
          <tr v-else-if="!rows.length">
            <td colspan="9" class="empty-state">没有匹配的数据</td>
          </tr>
          <tr v-for="row in rows" v-else :key="row.code" class="data-row" @click="$emit('select', row)">
            <td class="favorite" data-key="favorite">
              <button
                type="button"
                class="watch-button"
                :class="{ active: isFavorite(row), burst: pulseCode === row.code }"
                :aria-label="isFavorite(row) ? `取消自选 ${row.name}` : `加入自选 ${row.name}`"
                @click.stop="$emit('toggleFavorite', row)"
              >
                <span aria-hidden="true">★</span>
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
            <td data-key="changeRate" :class="[valueClass(row.changeRate ?? row.changePercent ?? row.changeValue), { 'sorted-column': sortKey === 'changeRate' }]">{{ percentText(row.changeRate ?? row.changePercent ?? row.changeValue) }}</td>
            <td data-key="price" :class="[priceClass({ change: row.changeRate ?? row.change }), { 'sorted-column': sortKey === 'price' }]">
              <strong>{{ navText(row.marketPrice ?? row.price, '-') }}</strong>
            </td>
            <td data-key="premiumRate" :class="[premiumClass(row.premiumRate ?? row.realtimePremium), { 'sorted-column': sortKey === 'premiumRate' }]">
              <strong>{{ percentText(row.premiumRate ?? row.realtimePremiumValue ?? row.realtimePremium) }}</strong>
              <small>{{ row.premiumNote || '-' }}</small>
            </td>
            <td data-key="lastNav" :class="{ 'sorted-column': sortKey === 'lastNav' }">
              <strong>{{ navText(row.lastNav ?? row.nav) }}</strong>
              <small>{{ hasValue(row.lastNav ?? row.nav) ? navDateText(row) : '未公布' }}</small>
            </td>
            <td data-key="estimatedNav" :class="{ 'sorted-column': sortKey === 'estimatedNav' }">
              <strong>{{ navText(row.estimatedNav ?? row.estimatedValue) }}</strong>
              <small>{{ hasValue(row.estimatedNav ?? row.estimatedValue) ? estimatedDateText(row) : '-' }}</small>
            </td>
            <td data-key="turnover" :class="{ 'sorted-column': sortKey === 'turnover' }">{{ amountText(row.turnover ?? row.amount) }}</td>
            <td class="trend-cell" data-key="trend">
              <Sparkline :points="row.intraday || []" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
