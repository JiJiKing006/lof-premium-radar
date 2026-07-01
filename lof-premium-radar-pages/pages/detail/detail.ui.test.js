import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(import.meta.dirname, '../..');

describe('详情页 UI 与数据展示约束', () => {
  it('详情数据返回前使用分区骨架屏占位', () => {
    const template = read('pages/detail/detail.wxml');
    const config = JSON.parse(read('pages/detail/detail.json'));

    expect(template).toContain('detailLoading && !current');
    expect(template).toContain('detail-hero-skeleton');
    expect(template).toContain('summarySkeletonCards');
    expect(template).toContain('chart-skeleton');
    expect(template).toContain('liveSkeletonFields');
    expect(template).not.toContain('<app-loading');
    expect(config.usingComponents).toBeUndefined();
  });

  it('顶部展示赎回周期并沿用首页 T+2/T+3 标签颜色', () => {
    const template = read('pages/detail/detail.wxml');
    const script = read('pages/detail/detail.js');
    const styles = read('pages/detail/detail.wxss');

    expect(template).toContain('cycle-{{current.settlementState}}');
    expect(script).toContain("return hasDisplayText(value) ? value : ''");
    expect(script).not.toContain('REVIEW_COPY_MODE');
    expect(script).toContain("fund.settlementCycle === 'T+2' ? 'short'");
    expect(styles).toContain('.cycle-short { color: #0d9b51; }');
    expect(styles).toContain('.cycle-long { color: #e24949; }');
  });

  it('支持复制基金代码并显示成功反馈', () => {
    const template = read('pages/detail/detail.wxml');
    const page = loadDetailPage();
    const copied = [];
    const instance = {
      data: { current: { code: '501225' }, code: '501225' },
    };
    page.copyFundCode.call(instance);
    copied.push(...clipboardWrites);

    expect(template).toContain('bindtap="copyFundCode"');
    expect(template).toContain('复制基金代码');
    expect(template).toContain('/images/icons/detail-copy.svg');
    expect(template).toContain('code-copy-group code-copy-group-hero');
    expect(template).not.toContain('>复制</button>');
    expect(read('pages/detail/detail.wxss')).toContain('background: transparent');
    expect(copied).toEqual(['501225']);
  });

  it('标题只显示代码且最新信息保持两列布局', () => {
    const template = read('pages/detail/detail.wxml');
    const script = read('pages/detail/detail.js');
    const styles = read('pages/detail/detail.wxss');

    expect(script).toContain('title: displayCode');
    expect(script).toContain('titleText: displayCode');
    expect(template).not.toContain('current.name');
    expect(styles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(template).toContain('class="field-identity"');
    expect(template).toContain('class="field-value"');
  });

  it('所有可见功能图标均使用 image icon，回顶不再使用文本箭头', () => {
    const template = read('pages/detail/detail.wxml');

    expect(template).toContain('class="summary-icon"');
    expect(template).toContain('class="live-icon"');
    expect(template).not.toContain('class="audit-icon"');
    expect(template).toContain('detail-back-top.svg');
    expect(template).not.toContain('back-top-arrow');
  });

  it('实时溢价率卡支持浅红浅绿底色并展示连续溢价折价天数', () => {
    const script = read('pages/detail/detail.js');
    const styles = read('pages/detail/detail.wxss');

    expect(script).toContain("streakNote: streak ? `连续${directionText} ${streak} 天` : ''");
    expect(script).toContain('noteClass: analysis.streakClass');
    expect(script).toContain("return number > 0 ? 'premium-tone-up' : 'premium-tone-down'");
    expect(styles).toContain('.premium-tone-up');
    expect(styles).toContain('.premium-tone-down');
    expect(styles).toContain('.summary-note.value-up');
  });

  it('走势突出最新数据并显示 0% 浅黄色虚线', () => {
    const template = read('pages/detail/detail.wxml');
    const styles = read('pages/detail/detail.wxss');

    expect(template).toContain('chart-point {{item.isLatest');
    expect(template).toContain('chart-zero-line');
    expect(styles).toContain('border-top: 2rpx dashed #e8cb75');
    expect(styles).toContain('.chart-point.latest .chart-value');
  });

  it('历史表固定可滚动高度且移除开高低收四个价格列', () => {
    const script = read('pages/detail/detail.js');
    const template = read('pages/detail/detail.wxml');
    const styles = read('pages/detail/detail.wxss');

    expect(template).toContain('scroll-x scroll-y');
    expect(styles).toContain('height: 468rpx');
    expect(script).not.toContain("label: '开盘价'");
    expect(script).not.toContain("label: '收盘价'");
    expect(script).not.toContain("label: '最高价'");
    expect(script).not.toContain("label: '最低价'");
  });

  it('移除底部溢价公式并说明估算净值来源与性质', () => {
    const script = read('pages/detail/detail.js');
    const template = read('pages/detail/detail.wxml');

    expect(template).not.toContain('实时溢价计算');
    expect(template).not.toContain('(场内现价 - 今日估算净值) ÷ 今日估算净值');
    expect(template).not.toContain('calculationFormula');
    expect(template).toContain('估算净值说明');
    expect(template).toContain('estimateExplanation.text');
    expect(script).toContain('依据已披露持仓和相关市场行情测算');
    expect(script).toContain('不代表官方净值');
    expect(script).not.toContain('calculationFormula');
    expect(template).not.toContain('来源审计');
    expect(template).not.toContain('source-audit');
    expect(script).not.toContain('auditRows');
    expect(script).toContain('sourceLabel');
    expect(script).not.toContain('navTrace');
  });

  it('详情请求继续使用冻结接口且不在 1.5 秒主动中断', () => {
    const api = read('utils/fund-api.js');

    expect(api).toContain('timeoutMs: 60000');
    expect(api).toContain('`/api/funds/${code}`');
    expect(api).not.toContain('详情加载超过 1.5 秒');
  });

  it('真实详情和历史数据可生成四张指标卡、走势与自适应最新信息', () => {
    const page = loadDetailPage();
    const instance = {
      data: {
        ...page.data,
        historyRows: [
          { date: '2026-06-25', premiumRate: 26.46, turnover: 25_804_486 },
          { date: '2026-06-24', premiumRate: 31.85, turnover: 24_000_000 },
          { date: '2026-06-23', premiumRate: 35.04, turnover: 23_000_000 }
        ]
      },
      setData(patch) { this.data = { ...this.data, ...patch }; }
    };

    page.applyFund.call(instance, {
      code: '501225',
      name: '全球芯片LOF',
      settlementCycle: 'T+3',
      marketPrice: 4.604,
      changeRate: -4.08,
      premiumRate: 26.46,
      officialPremiumRate: 26.46,
      premiumNote: '基于今日估算净值（非官方）',
      lastNav: 3.6406,
      estimatedNav: 3.487,
      volume: 64667,
      turnover: 30_069_486,
      shareAmount: '1.84亿份',
      shareValueWan: 18400,
      shareChange: '+0.32万份',
      shareSource: 'sse',
      shareTime: '2026-06-26',
      marketValue: 847_136_000,
      marketValueSource: 'eastmoney+sse',
      marketValueTime: '2026-06-26 16:11:39',
      marketValueBasis: 'marketPrice*exchangeShare',
      fundScale: 863_000_000,
      fundScaleSource: 'sina',
      fundScaleDate: '2026-06-26',
      fundScaleTime: '2026-06-28 21:47:55',
      turnoverRate: 0.035145,
      turnoverRateSource: 'eastmoney+sse',
      turnoverRateTime: '2026-06-26 16:11:39',
      turnoverRateBasis: 'volumeShares/exchangeShare',
      turnoverRateVolumeUnit: 'share',
      source: 'eastmoney',
      quoteSource: 'eastmoney',
      navSource: 'eastmoney',
      estimatedNavSource: 'lof',
      navDate: '2026-06-25',
      navQuoteTime: '2026-06-25 23:18:00',
      estimatedNavTime: '2026-06-25 00:00:00',
      updateTime: '2026-06-28 21:47:55',
      quoteTime: '2026-06-26 16:11:39',
      purchaseLimit: { state: 'paused', label: '暂停申购' }
    });

    expect(instance.data.summaryCards).toHaveLength(4);
    expect(instance.data.summaryCards[0]).toMatchObject({
      label: '实时价格',
      value: '4.604',
      note: '2026-06-26 16:11:39'
    });
    expect(instance.data.summaryCards[1]).toMatchObject({ label: '实时溢价率', toneClass: 'premium-tone-up', note: '连续溢价 3 天' });
    expect(instance.data.summaryCards[2]).toMatchObject({ label: '今日估算净值', value: '3.487', note: '2026-06-25 00:00:00' });
    expect(instance.data.summaryCards[3]).toMatchObject({ label: '总规模', value: '8.63亿', note: '2026-06-26' });
    expect(instance.data.trendPoints).toHaveLength(3);
    expect(instance.data.trendPoints.at(-1).isLatest).toBe(true);
    expect(instance.data.current.titleText).toBe('501225');
    expect(instance.data.current.settlementCycleText).toBe('T+3');
    expect(instance.data.liveFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '官方净值', value: '3.6406', note: '2026-06-25 23:18:00' }),
      expect.objectContaining({ label: '总份额', value: '1.84亿份' }),
      expect.objectContaining({ label: '较上一日份额', value: '+0.32万份' }),
      expect.objectContaining({ label: '换手率', value: '0.04%', note: '2026-06-26 16:11:39' })
    ]));
    expect(instance.data.liveFields.some((item) => item.label === '官方溢价率')).toBe(false);
    expect(instance.data.liveFields.some((item) => ['实时价格', '实时溢价率', '今日估算净值', '总规模', '涨跌幅'].includes(item.label))).toBe(false);
    expect(instance.data.liveFields.some((item) => item.label.includes('市值') || item.label.includes('规模'))).toBe(false);
    expect(instance.data.estimateExplanation).toMatchObject({
      time: '2026-06-25 00:00:00'
    });
    expect(instance.data.estimateExplanation.text).toContain('数据来自lof，依据已披露持仓和相关市场行情测算');
    expect(instance.data.estimateExplanation.text).not.toContain('基金');
  });

  it('总规模只接受独立且可追溯的基金规模字段，不回退到场内市值', () => {
    const page = loadDetailPage();
    const instance = {
      data: { ...page.data, historyLoading: false, historyRows: [] },
      setData(patch) { this.data = { ...this.data, ...patch }; }
    };

    page.applyFund.call(instance, {
      code: '501225',
      marketPrice: 4.604,
      marketValue: 847_136_000,
      marketValueSource: 'eastmoney+sse',
      marketValueTime: '2026-06-26 16:11:39',
      marketValueBasis: 'marketPrice*exchangeShare',
      purchaseLimit: { state: 'unknown', label: '暂无数据' }
    });

    expect(instance.data.summaryCards.map((item) => item.label)).toEqual(['实时价格', '总规模']);
    expect(instance.data.summaryCards[1].value).toBe('暂无数据');
    expect(JSON.stringify(instance.data.summaryCards)).not.toContain('场内总规模');
    expect(JSON.stringify(instance.data.summaryCards)).not.toContain('8.47亿');
  });

  it('真实字段缺失时不伪造指标，总规模明确显示暂无数据', () => {
    const page = loadDetailPage();
    const instance = {
      data: { ...page.data, historyLoading: false, historyRows: [] },
      setData(patch) { this.data = { ...this.data, ...patch }; }
    };

    page.applyFund.call(instance, {
      code: '501225',
      marketPrice: 4.604,
      changeRate: null,
      premiumRate: null,
      lastNav: null,
      estimatedNav: null,
      volume: null,
      turnover: null,
      shareAmount: '',
      shareChange: '',
      marketValue: null,
      purchaseLimit: { state: 'unknown', label: '暂无数据' }
    });

    expect(instance.data.summaryCards).toHaveLength(2);
    expect(instance.data.summaryCards[0].label).toBe('实时价格');
    expect(instance.data.summaryCards[1]).toMatchObject({ label: '总规模', value: '暂无数据' });
    expect(instance.data.liveFields).toEqual([]);
    expect(instance.data.estimateExplanation).toBeNull();
    expect(JSON.stringify(instance.data.liveFields)).not.toContain('暂无数据');
  });
});

const clipboardWrites = [];

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function loadDetailPage() {
  let page;
  const formatNumber = (value) => value === null || value === undefined ? '暂无数据' : String(value);
  const percentText = (value, options = {}) => value === null || value === undefined
    ? '暂无数据'
    : `${options.sign && Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)}%`;
  const amountText = (value) => {
    if (value === null || value === undefined) return '暂无数据';
    if (Math.abs(value) >= 100_000_000) return `${(Math.abs(value) / 100_000_000).toFixed(2)}亿`;
    if (Math.abs(value) >= 10_000) return `${(Math.abs(value) / 10_000).toFixed(1)}万`;
    return String(Math.abs(value));
  };
  const context = {
    require(id) {
      if (id === '../../utils/fund-api') return { fetchFundDetail() {}, fetchFundHistory() {} };
      if (id === '../../utils/source-links') return { sourceLabel: (value) => value || '' };
      if (id === '../../utils/fund-display') {
        return {
          purchaseText: (fund) => fund.purchaseLimit?.label || fund.subscriptionStatus || '暂无数据',
          purchaseState: (fund) => fund.purchaseLimit?.state || fund.subscriptionState || 'unavailable',
        };
      }
      if (id === '../../config/review-copy') return { REVIEW_COPY_MODE: true };
      return {
        formatNumber,
        officialNavText: formatNumber,
        percentText,
        amountText,
        formatShareValue: formatNumber,
        shareChangeClass: (value) => Number.parseFloat(value) > 0 ? 'share-up' : 'share-down',
        valueClass: (value) => Number(value) > 0 ? 'value-up' : Number(value) < 0 ? 'value-down' : 'value-flat'
      };
    },
    Page(config) { page = config; },
    wx: {
      setNavigationBarTitle() {},
      pageScrollTo() {},
      setClipboardData(options) { clipboardWrites.push(options.data); options.success && options.success(); },
      showToast() {}
    }
  };
  vm.runInNewContext(read('pages/detail/detail.js'), context);
  return page;
}
