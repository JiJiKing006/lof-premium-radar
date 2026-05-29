<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { fetchFundDetail, fetchFundHistory } from '../api/funds';
import type { FundHistoryRow, FundItem } from '../types/fund';
import Sparkline from './Sparkline.vue';

const props = defineProps<{
  row: FundItem;
  section: string;
}>();

defineEmits<{ back: [] }>();

const detail = ref<FundItem>(props.row);
const history = ref<FundHistoryRow[]>([]);
const loading = ref(true);
const error = ref('');

const current = computed(() => detail.value || props.row);
const minuteRows = computed(() => (current.value.intraday || []).slice(-36).reverse());

onMounted(loadDetail);
watch(() => props.row.code, loadDetail);

async function loadDetail() {
  loading.value = true;
  error.value = '';
  detail.value = props.row;
  try {
    const [fund, historySnapshot] = await Promise.all([
      fetchFundDetail(props.row.code, { section: props.section }),
      fetchFundHistory(props.row.code, { limit: 80 }),
    ]);
    detail.value = fund;
    history.value = historySnapshot.rows || [];
  } catch (err) {
    error.value = err instanceof Error ? err.message : '详情数据加载失败';
  } finally {
    loading.value = false;
  }
}

function formatNumber(value: unknown, digits = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return number.toFixed(digits).replace(/\.?0+$/, '');
}

function percentText(value: unknown, { sign = false }: { sign?: boolean } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  const prefix = sign && number > 0 ? '+' : '';
  return `${prefix}${number.toFixed(2)}%`;
}

function amountText(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  if (Math.abs(number) >= 100_000_000) return `${(number / 100_000_000).toFixed(2)}亿`;
  if (Math.abs(number) >= 10_000) return `${(number / 10_000).toFixed(1)}万`;
  return number.toFixed(0);
}

function purchaseText(fund: FundItem) {
  const label = fund.purchaseLimit?.label || fund.purchaseLimit?.limitText || fund.subscriptionStatus || '未知';
  const state = fund.purchaseLimit?.state || fund.subscriptionState || 'unknown';
  if (state === 'open' && (/无限额|不限额/.test(label) || /开放/.test(label))) return '不限额';
  if (/开放申购\s*\/\s*无限额|开放申购.*不限额/.test(label)) return '不限额';
  return label;
}

function purchaseState(fund: FundItem) {
  return fund.purchaseLimit?.state || fund.subscriptionState || 'unknown';
}

function valueClass(value: unknown, inverse = false) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return 'value-flat';
  const up = inverse ? number < 0 : number > 0;
  return up ? 'value-up' : 'value-down';
}

function sourceLabel(source: unknown) {
  const text = String(source || '').toLowerCase();
  if (text.includes('tiantian')) return '天天基金';
  if (text.includes('jisilu')) return '集思录';
  if (text.includes('haoetf')) return 'HaoETF';
  if (text.includes('palmmicro') || text === 'lof') return 'Palmmicro';
  return String(source || '');
}

function estimateReference(fund: FundItem) {
  const source = sourceLabel(fund.estimatedNavSource);
  const time = fund.estimatedNavTime || fund.navQuoteTime || fund.navDate || fund.quoteTime || '';
  if (source && time) return `${source} · ${time}`;
  return source || time || '-';
}
</script>

<template>
  <section class="detail-panel market-detail" aria-label="基金详情">
    <div class="detail-scroll">
      <nav class="detail-nav">
        <button type="button" @click="$emit('back')">返回列表</button>
        <span>{{ current.type }} · {{ current.code }}</span>
      </nav>

      <div class="detail-hero">
        <div class="detail-market-mark" aria-hidden="true">
          <i></i>
          <i></i>
          <i></i>
          <i></i>
        </div>
        <div class="detail-title">
          <p class="detail-kicker">Realtime Fund Detail</p>
          <h2>{{ current.name }}</h2>
          <p class="detail-code-line">
            <b>{{ current.code }}</b>
            <small :class="`limit-${purchaseState(current)}`">{{ purchaseText(current) }}</small>
            <span>{{ current.quoteTime || '-' }}</span>
          </p>
        </div>
        <div class="detail-quote-strip">
          <article>
            <span>现价</span>
            <strong :class="valueClass(current.changeRate ?? current.changePercent)">{{ formatNumber(current.marketPrice ?? current.price) }}</strong>
          </article>
          <article>
            <span>实时溢价率</span>
            <strong :class="valueClass(current.premiumRate)">{{ percentText(current.premiumRate) }}</strong>
            <small>{{ current.premiumNote || '-' }}</small>
          </article>
          <article>
            <span>涨跌幅</span>
            <strong :class="valueClass(current.changeRate ?? current.changePercent)">{{ percentText(current.changeRate ?? current.changePercent, { sign: true }) }}</strong>
          </article>
        </div>
      </div>
      <div v-if="error" class="detail-warning">{{ error }}</div>

      <section class="detail-section">
        <header>
          <strong>实时行情</strong>
          <span>行情、净值、成交与当日走势</span>
        </header>
        <div class="detail-live-grid">
          <div class="detail-chart-cell">
            <Sparkline :points="current.intraday || []" />
          </div>
          <table class="detail-mini-table">
            <tbody>
              <tr><th>基金代码</th><td>{{ current.code }}</td><th>基金名称</th><td>{{ current.name }}</td></tr>
              <tr><th>现价</th><td :class="valueClass(current.changeRate ?? current.changePercent)">{{ formatNumber(current.marketPrice ?? current.price) }}</td><th>涨跌幅</th><td :class="valueClass(current.changeRate ?? current.changePercent)">{{ percentText(current.changeRate ?? current.changePercent, { sign: true }) }}</td></tr>
              <tr><th>官方净值</th><td>{{ formatNumber(current.lastNav ?? current.nav) }}</td><th>净值日期</th><td>{{ current.navDate || '-' }}</td></tr>
              <tr><th>估算净值</th><td>{{ formatNumber(current.estimatedNav ?? current.estimatedValue) }}</td><th>估值参考</th><td>{{ estimateReference(current) }}</td></tr>
              <tr><th>实时溢价率</th><td :class="valueClass(current.premiumRate)">{{ percentText(current.premiumRate) }}</td><th>估值校验</th><td>{{ current.estimateWarning || current.premiumNote || '-' }}</td></tr>
              <tr><th>成交量</th><td>{{ amountText(current.volume) }}</td><th>成交额</th><td>{{ amountText(current.turnover ?? current.amount) }}</td></tr>
              <tr><th>申购状态</th><td>{{ purchaseText(current) }}</td><th>更新时间</th><td>{{ current.updateTime || '-' }}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="detail-section">
        <header>
          <strong>当日分时</strong>
          <span>真实分钟线，按最新时间倒序</span>
        </header>
        <div class="detail-table-wrap">
          <table class="detail-data-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>价格</th>
                <th>成交量</th>
                <th>成交额</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="point in minuteRows" :key="`${point.time}-${point.price}`">
                <td>{{ point.time || '-' }}</td>
                <td>{{ formatNumber(point.price) }}</td>
                <td>{{ amountText(point.volume) }}</td>
                <td>{{ amountText(point.turnover) }}</td>
              </tr>
              <tr v-if="!minuteRows.length">
                <td colspan="4" class="empty-state">暂无分时数据</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="detail-section">
        <header>
          <strong>历史净值与溢价率</strong>
          <span>仅用同日官方净值与场内收盘价计算</span>
        </header>
        <div class="detail-table-wrap history-table-wrap">
          <table class="detail-data-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>收盘价</th>
                <th>单位净值</th>
                <th>历史溢价率</th>
                <th>净值涨幅</th>
                <th>成交额</th>
                <th>申购状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in history" :key="item.date">
                <td>{{ item.date }}</td>
                <td :class="valueClass(item.changeRate)">{{ formatNumber(item.closePrice) }}</td>
                <td>{{ formatNumber(item.unitNav, 4) }}</td>
                <td :class="valueClass(item.premiumRate)">{{ percentText(item.premiumRate) }}</td>
                <td :class="valueClass(item.navGrowthRate)">{{ percentText(item.navGrowthRate, { sign: true }) }}</td>
                <td>{{ amountText(item.turnover) }}</td>
                <td>{{ item.purchaseStatus || '-' }}</td>
              </tr>
              <tr v-if="!history.length && !loading">
                <td colspan="7" class="empty-state">暂无历史数据</td>
              </tr>
              <tr v-if="loading">
                <td colspan="7" class="empty-state">正在加载历史数据</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </section>
</template>
