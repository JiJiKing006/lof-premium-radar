<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { fetchFundDetail, fetchFundHistory } from '../api/funds';
import type { FundHistoryRow, FundItem } from '../types/fund';
import { formatShareChangeText, formatShareValue, shareChangeClass } from '../utils/format';
import { sourceLabel, sourceReference } from '../utils/sourceLinks';

const props = defineProps<{
  row: FundItem;
  section: string;
}>();

defineEmits<{ back: [] }>();

const detail = ref<FundItem>(props.row);
const history = ref<FundHistoryRow[]>([]);
const loading = ref(true);
const error = ref('');
const historySkeletonRows = Array.from({ length: 8 }, (_, index) => index);

const current = computed(() => detail.value || props.row);
const latestHistory = computed(() => history.value[0]);

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
  if (!Number.isFinite(number)) return '暂无数据';
  return number.toFixed(digits).replace(/\.?0+$/, '');
}

function percentText(value: unknown, { sign = false }: { sign?: boolean } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '暂无数据';
  const prefix = sign && number > 0 ? '+' : '';
  return `${prefix}${number.toFixed(2)}%`;
}

function amountText(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '暂无数据';
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

function navSource(fund: FundItem) {
  return fund.navSource || (fund.raw?.navSource as string) || fund.source || '';
}

function estimatedSource(fund: FundItem) {
  return fund.estimatedNavSource || (fund.raw?.estimatedNavSource as string) || '';
}

function sourceText(source: unknown) {
  return sourceLabel(source) || '暂无数据';
}

function sourceHref(source: unknown, fund: FundItem = current.value) {
  return sourceReference(source, fund.code, fund.type)?.url || '';
}

function shareSourceText(fund: FundItem) {
  if (!hasShareData(fund)) return '暂无数据';
  return sourceText(fund.shareSource);
}

function shareSourceHref(fund: FundItem) {
  if (!hasShareData(fund)) return '';
  return sourceHref(fund.shareSource, fund);
}

function hasShareData(fund: FundItem) {
  return Boolean(fund.shareAmount || fund.shareChange);
}
</script>

<template>
  <section class="detail-panel market-detail" aria-label="基金详情">
    <div class="detail-scroll">
      <nav class="detail-nav">
        <button type="button" @click="$emit('back')">返回列表</button>
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
          <article>
            <span>上日净值涨幅</span>
            <strong :class="valueClass(latestHistory?.navGrowthRate)">{{ percentText(latestHistory?.navGrowthRate, { sign: true }) }}</strong>
          </article>
        </div>
      </div>
      <div v-if="error" class="detail-warning">{{ error }}</div>

      <section class="detail-section">
        <header>
          <strong>实时行情</strong>
          <span>行情、净值、成交、份额</span>
        </header>
        <div class="detail-live-grid">
          <div class="detail-field-columns" aria-label="实时行情字段">
            <table class="detail-two-col-table" aria-label="实时行情字段">
              <tbody>
                <tr>
                  <th scope="row">基金代码</th>
                  <td>{{ current.code }}</td>
                </tr>
                <tr>
                  <th scope="row">基金名称</th>
                  <td>{{ current.name }}</td>
                </tr>
                <tr>
                  <th scope="row">现价</th>
                  <td>{{ formatNumber(current.marketPrice ?? current.price) }}</td>
                </tr>
                <tr>
                  <th scope="row">涨跌幅</th>
                  <td :class="valueClass(current.changeRate ?? current.changePercent)">{{ percentText(current.changeRate ?? current.changePercent, { sign: true }) }}</td>
                </tr>
                <tr>
                  <th scope="row">实时溢价率</th>
                  <td :class="valueClass(current.premiumRate)">{{ percentText(current.premiumRate) }}</td>
                </tr>
                <tr>
                  <th scope="row">官方净值</th>
                  <td>
                    <span class="detail-value-stack">
                      <strong>{{ formatNumber(current.lastNav ?? current.nav) }}</strong>
                      <small>
                        <a
                          v-if="sourceHref(navSource(current), current)"
                          class="source-link"
                          :href="sourceHref(navSource(current), current)"
                          target="_blank"
                          rel="noopener noreferrer"
                        >{{ sourceText(navSource(current)) }}</a>
                        <template v-else>{{ sourceText(navSource(current)) }}</template>
                      </small>
                    </span>
                  </td>
                </tr>
                <tr>
                  <th scope="row">净值日期</th>
                  <td>{{ current.navDate || '暂无数据' }}</td>
                </tr>
                <tr>
                  <th scope="row">更新时间</th>
                  <td>{{ current.updateTime || '暂无数据' }}</td>
                </tr>
              </tbody>
            </table>

            <table class="detail-two-col-table" aria-label="实时行情字段续表">
              <tbody>
                <tr>
                  <th scope="row">上日净值涨幅</th>
                  <td :class="valueClass(latestHistory?.navGrowthRate)">{{ percentText(latestHistory?.navGrowthRate, { sign: true }) }}</td>
                </tr>
                <tr>
                  <th scope="row">估算净值</th>
                  <td>
                    <span class="detail-value-stack">
                      <strong>{{ formatNumber(current.estimatedNav ?? current.estimatedValue) }}</strong>
                      <small>
                        <a
                          v-if="sourceHref(estimatedSource(current), current)"
                          class="source-link"
                          :href="sourceHref(estimatedSource(current), current)"
                          target="_blank"
                          rel="noopener noreferrer"
                        >{{ sourceText(estimatedSource(current)) }}</a>
                        <template v-else>{{ sourceText(estimatedSource(current)) }}</template>
                      </small>
                    </span>
                  </td>
                </tr>
                <tr>
                  <th scope="row">估值时间</th>
                  <td>{{ current.estimatedNavTime || current.navQuoteTime || current.navDate || current.quoteTime || '暂无数据' }}</td>
                </tr>
                <tr>
                  <th scope="row">场内份额</th>
                  <td>
                    <span class="detail-value-stack">
                      <strong>{{ formatShareValue(current.shareAmount) }}</strong>
                      <small v-if="shareSourceHref(current)">
                        <a
                          class="source-link"
                          :href="shareSourceHref(current)"
                          target="_blank"
                          rel="noopener noreferrer"
                        >{{ shareSourceText(current) }}</a>
                      </small>
                      <small v-else-if="hasShareData(current)">{{ shareSourceText(current) }}</small>
                    </span>
                  </td>
                </tr>
                <tr>
                  <th scope="row">较上一日份额</th>
                  <td>
                    <span class="detail-value-stack">
                      <strong :class="shareChangeClass(current.shareChange)">{{ hasShareData(current) ? formatShareValue(current.shareChange) : '暂无数据' }}</strong>
                      <small v-if="hasShareData(current)">{{ current.shareTime || '暂无数据' }}</small>
                    </span>
                  </td>
                </tr>
                <tr>
                  <th scope="row">成交额</th>
                  <td>{{ amountText(current.turnover ?? current.amount) }}</td>
                </tr>
                <tr>
                  <th scope="row">成交量</th>
                  <td>{{ amountText(current.volume) }}</td>
                </tr>
                <tr>
                  <th scope="row">申购状态</th>
                  <td>{{ purchaseText(current) }}</td>
                </tr>
                <tr>
                  <th scope="row">估值校验</th>
                  <td>{{ current.estimateWarning || current.premiumNote || '暂无数据' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="detail-source-note">
            数据参考：行情 {{ sourceText(current.quoteSource || current.source) }}；净值 {{ sourceText(navSource(current)) }}；份额 {{ shareSourceText(current) }}。
          </p>
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
                <th>开盘</th>
                <th>最高</th>
                <th>最低</th>
                <th>收盘价</th>
                <th>场内涨幅</th>
                <th>单位净值</th>
                <th>历史溢价率</th>
                <th>净值涨幅</th>
                <th>成交量</th>
                <th>成交额</th>
                <th>申购状态</th>
              </tr>
            </thead>
            <tbody>
              <template v-if="loading">
                <tr
                  v-for="row in historySkeletonRows"
                  :key="`history-skeleton-${row}`"
                  class="skeleton-row"
                  aria-hidden="true"
                >
                  <td class="date-cell"><span class="skeleton-line skeleton-date"></span></td>
                  <td><span class="skeleton-line skeleton-num"></span></td>
                  <td><span class="skeleton-line skeleton-num"></span></td>
                  <td><span class="skeleton-line skeleton-num"></span></td>
                  <td><span class="skeleton-line skeleton-num"></span></td>
                  <td><span class="skeleton-line skeleton-num"></span></td>
                  <td><span class="skeleton-line skeleton-num"></span></td>
                  <td><span class="skeleton-line skeleton-num"></span></td>
                  <td><span class="skeleton-line skeleton-num long"></span></td>
                  <td><span class="skeleton-line skeleton-num long"></span></td>
                  <td><span class="skeleton-line skeleton-note"></span></td>
                </tr>
              </template>
              <template v-else>
                <tr v-for="item in history" :key="item.date">
                  <td class="date-cell">{{ item.date }}</td>
                  <td>{{ formatNumber(item.openPrice) }}</td>
                  <td>{{ formatNumber(item.highPrice) }}</td>
                  <td>{{ formatNumber(item.lowPrice) }}</td>
                  <td :class="valueClass(item.changeRate)">{{ formatNumber(item.closePrice) }}</td>
                  <td :class="valueClass(item.changeRate)">{{ percentText(item.changeRate, { sign: true }) }}</td>
                  <td>{{ formatNumber(item.unitNav, 4) }}</td>
                  <td :class="valueClass(item.premiumRate)">{{ percentText(item.premiumRate) }}</td>
                  <td :class="valueClass(item.navGrowthRate)">{{ percentText(item.navGrowthRate, { sign: true }) }}</td>
                  <td>{{ amountText(item.volume) }}</td>
                  <td>{{ amountText(item.turnover) }}</td>
                  <td>{{ item.purchaseStatus || '暂无数据' }}</td>
                </tr>
              </template>
              <tr v-if="!history.length && !loading">
                <td colspan="11" class="empty-state">暂无历史数据</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </section>
</template>
