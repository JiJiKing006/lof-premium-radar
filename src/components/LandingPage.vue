<script setup>
defineEmits(['open']);
</script>

<template>
  <section class="landing">
    <div class="hero-copy">
      <p class="hero-kicker">Premium Radar for Arbitrage</p>
      <h2>把折溢价、申购状态和走势放到同一张决策屏里。</h2>
      <p>
        面向套利交易者的移动端溢价雷达，聚合 LOF、纳指100与 QDII 数据，突出实时溢价、价格波动、申购限制和份额变化，减少来回切站的判断成本。
      </p>
      <div class="hero-actions">
        <button type="button" @click="$emit('open', 'qdii')">查看 QDII</button>
        <button type="button" @click="$emit('open', 'nasdaq100')">纳斯达克100</button>
      </div>
    </div>
    <div class="hero-panel" aria-hidden="true">
      <div class="signal-line"></div>
      <div class="signal-card hot">
        <span>实时溢价</span>
        <strong>+6.64%</strong>
      </div>
      <div class="signal-card">
        <span>申购状态</span>
        <strong>限额 1000元</strong>
      </div>
      <div class="signal-card cool">
        <span>价格波动</span>
        <strong>分时追踪</strong>
      </div>
    </div>
  </section>
</template>
