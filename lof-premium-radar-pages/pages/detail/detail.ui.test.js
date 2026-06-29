import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(import.meta.dirname, '../..');

describe('详情页 UI 与数据展示约束', () => {
  it('详情数据返回前展示统一的自定义 loading', () => {
    const template = read('pages/detail/detail.wxml');
    const config = JSON.parse(read('pages/detail/detail.json'));

    expect(template).toContain('detailLoading && !current');
    expect(template).toContain('<app-loading');
    expect(template).toContain('title="加载详情中"');
    expect(template).toContain('正在获取行情、净值与溢价数据');
    expect(template).not.toContain('detail-skeleton-hero');
    expect(config.usingComponents['app-loading']).toBe('/components/app-loading/app-loading');
  });

  it('顶部展示赎回周期并沿用首页 T+2/T+3 标签颜色', () => {
    const template = read('pages/detail/detail.wxml');
    const script = read('pages/detail/detail.js');
    const styles = read('pages/detail/detail.wxss');

    expect(template).toContain('cycle-{{current.settlementState}}');
    expect(script).toContain("fund.settlementCycle === 'T+2' ? 'short'");
    expect(styles).toContain('.cycle-short { color: #0d9b51; }');
    expect(styles).toContain('.cycle-long { color: #e24949; }');
  });

  it('所有可见功能图标均使用 image icon，回顶不再使用文本箭头', () => {
    const template = read('pages/detail/detail.wxml');

    expect(template).toContain('class="summary-icon"');
    expect(template).toContain('class="live-icon"');
    expect(template).toContain('class="audit-icon"');
    expect(template).toContain('detail-back-top.svg');
    expect(template).not.toContain('back-top-arrow');
  });

  it('溢价卡支持浅红浅绿底色并保留真实依据说明', () => {
    const script = read('pages/detail/detail.js');
    const styles = read('pages/detail/detail.wxss');

    expect(script).toContain("note: fund.premiumNote || '暂无数据'");
    expect(script).toContain("return number > 0 ? 'premium-tone-up' : 'premium-tone-down'");
    expect(styles).toContain('.premium-tone-up');
    expect(styles).toContain('.premium-tone-down');
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

  it('详情请求继续使用冻结接口且不在 1.5 秒主动中断', () => {
    const api = read('utils/fund-api.js');

    expect(api).toContain('timeoutMs: 60000');
    expect(api).toContain('`/api/funds/${code}`');
    expect(api).not.toContain('详情加载超过 1.5 秒');
  });

  it('真实详情和历史数据可生成四张指标卡、走势与双列行情', () => {
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
      premiumNote: '基于已公布官方净值',
      lastNav: 3.6406,
      estimatedNav: 3.487,
      volume: 64667,
      turnover: 30_069_486,
      shareAmount: '1.84亿份',
      shareChange: '+0.32万份',
      shareSource: 'sse',
      shareTime: '2026-06-26',
      source: 'eastmoney',
      quoteSource: 'eastmoney',
      navSource: 'eastmoney',
      estimatedNavSource: 'lof',
      navDate: '2026-06-25',
      estimatedNavTime: '2026-06-25 00:00:00',
      updateTime: '2026-06-28 21:47:55',
      quoteTime: '2026-06-26 16:11:39',
      purchaseLimit: { state: 'paused', label: '暂停申购' }
    });

    expect(instance.data.summaryCards).toHaveLength(4);
    expect(instance.data.summaryCards[1]).toMatchObject({ toneClass: 'premium-tone-up', note: '基于已公布官方净值' });
    expect(instance.data.summaryCards[2]).toMatchObject({ label: '连续溢价天数', value: '3天' });
    expect(instance.data.summaryCards[3]).toMatchObject({ value: '+426.5万', note: '2026-06-26' });
    expect(instance.data.trendPoints).toHaveLength(3);
    expect(instance.data.trendPoints.at(-1).isLatest).toBe(true);
    expect(instance.data.leftFields).toHaveLength(6);
    expect(instance.data.rightFields).toHaveLength(6);
  });
});

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
    wx: { setNavigationBarTitle() {}, pageScrollTo() {} }
  };
  vm.runInNewContext(read('pages/detail/detail.js'), context);
  return page;
}
