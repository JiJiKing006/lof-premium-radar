<script setup>
import { computed } from 'vue';
import { toNumber } from '../domain/funds';

const props = defineProps({
  points: { type: Array, default: () => [] },
});

const CHART_WIDTH = 160;
const CHART_HEIGHT = 42;
const PADDING = 4;
const viewBox = `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`;
const clipId = `spark-${Math.random().toString(36).slice(2)}`;

const chart = computed(() => {
  const values = props.points.map((point) => toNumber(point.price)).filter((value) => value !== null);
  if (!values.length) return { coordinates: [], baselineY: CHART_HEIGHT / 2 };
  const baseline = values[0];
  const drawableWidth = CHART_WIDTH - PADDING * 2;
  const drawableHeight = CHART_HEIGHT - PADDING * 2;

  let min = Math.min(...values, baseline);
  let max = Math.max(...values, baseline);
  if (max === min) {
    const pad = Math.abs(baseline) * 0.01 || 1;
    min = baseline - pad;
    max = baseline + pad;
  }
  const spread = max - min;
  const yFor = (value) => PADDING + (1 - (value - min) / spread) * drawableHeight;
  const baselineY = yFor(baseline);

  if (values.length === 1) {
    return {
      baselineY,
      coordinates: [
        { x: PADDING, y: baselineY },
        { x: CHART_WIDTH - PADDING, y: baselineY },
      ],
    };
  }

  return {
    baselineY,
    coordinates: values.map((value, index) => ({
      x: PADDING + (index / (values.length - 1)) * drawableWidth,
      y: yFor(value),
    })),
  };
});

const coordinates = computed(() => chart.value.coordinates);

const baselineY = computed(() => chart.value.baselineY);

const areaGradientId = computed(() => `${clipId}-area`);

const areaPath = computed(() => {
  if (!coordinates.value.length) return '';
  const line = coordinates.value
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
  const first = coordinates.value[0];
  const last = coordinates.value.at(-1);
  return `${line} L${last.x.toFixed(2)} ${baselineY.value.toFixed(2)} L${first.x.toFixed(2)} ${baselineY.value.toFixed(2)} Z`;
});

const path = computed(() => {
  if (!coordinates.value.length) return '';
  return coordinates.value
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
});

const tone = computed(() => {
  const values = props.points.map((point) => toNumber(point.price)).filter((value) => value !== null);
  if (values.length < 2) return 'flat';
  return values.at(-1) >= values[0] ? 'up' : 'down';
});

const isUp = computed(() => tone.value === 'up');
</script>

<template>
  <svg :key="path" class="sparkline" :class="`sparkline-${tone}`" :viewBox="viewBox" preserveAspectRatio="none" role="img" aria-label="当天价格走势">
    <defs>
      <linearGradient :id="areaGradientId" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="currentColor" stop-opacity="0.16" />
        <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
      </linearGradient>
    </defs>
    <line class="sparkline-baseline" :x1="PADDING" :x2="CHART_WIDTH - PADDING" :y1="baselineY" :y2="baselineY" />
    <g :class="isUp ? 'sparkline-red' : 'sparkline-green'">
      <path v-if="areaPath" class="sparkline-area" :d="areaPath" :fill="`url(#${areaGradientId})`" />
      <path v-if="path" class="sparkline-line" :d="path" />
    </g>
  </svg>
</template>
