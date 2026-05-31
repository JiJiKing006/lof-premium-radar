<script setup lang="ts">
import type { HotArbitrageItem } from '../types/fund';
import { formatAmount, formatPercent } from '../utils/format';
import { sourceLabel, sourceReference } from '../utils/sourceLinks';

defineProps<{
  rows: HotArbitrageItem[];
  loading: boolean;
  error?: string;
  compact?: boolean;
}>();

function directionText(row: HotArbitrageItem) {
  return row.premiumDirection === 'premium' ? '溢价' : '折价';
}

function directionClass(row: HotArbitrageItem) {
  return row.premiumDirection === 'premium' ? 'is-premium' : 'is-discount';
}

function volumeRatioText(value: number | null) {
  return value === null ? '暂无数据' : `${value.toFixed(2)}倍`;
}

function rowTime(row: HotArbitrageItem) {
  return row.updateTime || row.quoteTime || '暂无数据';
}

function sourceHref(row: HotArbitrageItem) {
  return sourceReference(row.source, row.code, row.type)?.url || '';
}

function sourceText(source: unknown) {
  return sourceLabel(source) || '暂无数据';
}
</script>

<template>
  <section class="hot-arbitrage" :class="{ compact }" aria-label="热门套利观察">
    <header class="hot-arbitrage-head">
      <div>
        <h2>热门套利观察</h2>
        <p>基于实时溢价率、成交额、异动幅度综合计算，仅供参考，不构成投资建议。</p>
      </div>
    </header>

    <div v-if="loading" class="state-card">正在计算热门套利榜</div>
    <div v-else-if="error && !rows.length" class="state-card error">{{ error }}</div>

    <div v-else class="hot-table-wrap">
      <table class="hot-table">
        <thead>
          <tr v-if="compact">
            <th class="rank-col">#</th>
            <th class="fund-col">基金</th>
            <th class="number-col">溢价</th>
            <th class="number-col">热度</th>
          </tr>
          <tr v-else>
            <th class="rank-col">#</th>
            <th class="fund-col">基金</th>
            <th>方向</th>
            <th class="number-col">溢价率</th>
            <th class="number-col">热度</th>
            <th class="number-col">成交额</th>
            <th class="number-col">成交量</th>
            <th class="number-col">异动</th>
            <th>时间</th>
            <th>来源</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.code">
            <td class="rank-col">
              <span class="hot-rank">{{ row.rank }}</span>
            </td>
            <td class="fund-col">
              <strong>{{ row.name }}</strong>
              <span>{{ row.code }} · {{ row.type }}</span>
            </td>
            <template v-if="compact">
              <td class="number-col" :class="directionClass(row)">{{ formatPercent(row.premiumRate) }}</td>
              <td class="number-col hot-score-cell">{{ row.hotScore.toFixed(1) }}</td>
            </template>
            <template v-else>
              <td :class="directionClass(row)">{{ directionText(row) }}</td>
              <td class="number-col" :class="directionClass(row)">{{ formatPercent(row.premiumRate) }}</td>
              <td class="number-col hot-score-cell">{{ row.hotScore.toFixed(1) }}</td>
              <td class="number-col">{{ formatAmount(row.amount) }}</td>
              <td class="number-col">{{ row.volume === null ? '暂无数据' : formatAmount(row.volume) }}</td>
              <td class="number-col">{{ volumeRatioText(row.volumeRatio) }}</td>
              <td class="time-col">{{ rowTime(row) }}</td>
              <td class="source-col">
                <a
                  v-if="sourceHref(row)"
                  class="source-link"
                  :href="sourceHref(row)"
                  target="_blank"
                  rel="noopener noreferrer"
                  @click.stop
                >{{ sourceText(row.source) }}</a>
                <span v-else>{{ sourceText(row.source) }}</span>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
