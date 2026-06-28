const { fetchFundDetail, fetchFundHistory } = require('../../utils/fund-api');
const { formatNumber, officialNavText, percentText, amountText, formatShareValue, shareChangeClass, valueClass } = require('../../utils/format');
const { sourceLabel } = require('../../utils/source-links');

const HISTORY_COLUMNS = [
  { key: 'date', label: '日期', value: 'date', kind: 'date' },
  { key: 'premiumRate', label: '历史溢价率', value: 'premiumRate', kind: 'percent' },
  { key: 'changeRate', label: '场内涨幅', value: 'changeRate', kind: 'percent' },
  { key: 'openPrice', label: '开盘价', value: 'openPrice', kind: 'number' },
  { key: 'closePrice', label: '收盘价', value: 'closePrice', kind: 'number' },
  { key: 'unitNav', label: '单位净值', value: 'unitNav', kind: 'number' },
  { key: 'navGrowthRate', label: '净值涨幅', value: 'navGrowthRate', kind: 'percent' },
  { key: 'volume', label: '成交量', value: 'volume', kind: 'amount' },
  { key: 'turnover', label: '成交额', value: 'turnover', kind: 'amount' },
  { key: 'highPrice', label: '最高价', value: 'highPrice', kind: 'number' },
  { key: 'lowPrice', label: '最低价', value: 'lowPrice', kind: 'number' }
];

Page({
  data: {
    code: '',
    section: '',
    current: null,
    heroQuotes: [],
    leftFields: [],
    rightFields: [],
    liveFields: [],
    auditRows: [],
    historyColumns: HISTORY_COLUMNS,
    historyRows: [],
    historySkeletonRows: Array.from({ length: 8 }, (_, index) => index),
    detailHeroSkeletonCards: Array.from({ length: 4 }, (_, index) => index),
    detailFieldSkeletonCards: Array.from({ length: 8 }, (_, index) => index),
    detailLoading: false,
    historyLoading: false,
    error: '',
    historyError: '',
    showBackTop: false
  },

  onLoad(options) {
    this.setData({
      code: options.code || '',
      section: options.section || ''
    });
    this.loadDetail();
  },

  async loadDetail(options = {}) {
    if (!this.data.code) return;
    this.setData({
      detailLoading: true,
      historyLoading: true,
      error: '',
      historyError: ''
    });
    try {
      const fund = await fetchFundDetail(this.data.code, { section: this.data.section, force: options.force });
      this.applyFund(fund);
    } catch (error) {
      this.setData({ error: error && error.message ? error.message : '详情数据加载失败' });
    } finally {
      this.setData({ detailLoading: false });
    }

    try {
      const snapshot = await fetchFundHistory(this.data.code, { limit: 40, force: options.force });
      const rows = (snapshot.rows || []).map((row) => decorateHistoryRow(row));
      this.setData({ historyRows: rows });
      if (this.data.current) this.applyFund(this.data.current);
    } catch (error) {
      this.setData({ historyError: error && error.message ? error.message : '历史数据加载失败' });
    } finally {
      this.setData({ historyLoading: false });
    }
  },

  onPageScroll(event) {
    const showBackTop = Number(event.scrollTop || 0) > 160;
    if (showBackTop !== this.data.showBackTop) {
      this.setData({ showBackTop });
    }
  },

  applyFund(fund) {
    wx.setNavigationBarTitle({
      title: `${fund.name || '基金详情'}（${fund.code || this.data.code}）`
    });
    const current = Object.assign({}, fund, {
      titleText: `${fund.name || '基金详情'}（${fund.code || this.data.code}）`,
      purchaseText: purchaseText(fund),
      purchaseState: purchaseState(fund),
      navSourceText: sourceText(navSource(fund)),
      estimatedSourceText: sourceText(estimatedSource(fund)),
      quoteSourceText: sourceText(fund.quoteSource || fund.source),
      shareSourceText: hasShareData(fund) ? sourceText(fund.shareSource) : '暂无数据',
      shareChangeClass: shareChangeClass(fund.shareChange)
    });
    const latestHistory = this.data.historyRows[0] || {};
    this.setData({
      current,
      heroQuotes: [
        { label: '现价', value: formatNumber(fund.marketPrice ?? fund.price), className: valueClass(fund.changeRate ?? fund.changePercent), note: '' },
        { label: '实时溢价率', value: percentText(fund.premiumRate), className: valueClass(fund.premiumRate), note: fund.premiumNote || '-' },
        { label: '官方净值', value: officialNavText(fund.lastNav ?? fund.nav), className: '', note: fund.navDate || '暂无数据' },
        { label: '估算净值', value: formatNumber(fund.estimatedNav ?? fund.estimatedValue, 4), className: '', note: fund.estimatedNavTime || '暂无数据' }
      ],
      leftFields: [
        { label: '代码', value: fund.code },
        { label: '名称', value: fund.name },
        { label: '现价', value: formatNumber(fund.marketPrice ?? fund.price) },
        { label: '涨跌幅', value: percentText(fund.changeRate ?? fund.changePercent, { sign: true }), className: valueClass(fund.changeRate ?? fund.changePercent) },
        { label: '实时溢价率', value: percentText(fund.premiumRate), className: valueClass(fund.premiumRate) },
        { label: '官方净值', value: officialNavText(fund.lastNav ?? fund.nav), note: sourceText(navSource(fund)) },
        { label: '净值日期', value: fund.navDate || '暂无数据' },
        { label: '更新时间', value: fund.updateTime || '暂无数据' }
      ],
      rightFields: [
        { label: '上日净值涨幅', value: percentText(latestHistory.navGrowthRate, { sign: true }), className: valueClass(latestHistory.navGrowthRate) },
        { label: '估算净值', value: formatNumber(fund.estimatedNav ?? fund.estimatedValue), note: sourceText(estimatedSource(fund)) },
        { label: '估值时间', value: fund.estimatedNavTime || fund.navQuoteTime || fund.navDate || fund.quoteTime || '暂无数据' },
        { label: '场内份额', value: formatShareValue(fund.shareAmount), note: current.shareSourceText },
        { label: '较上一日份额', value: hasShareData(fund) ? formatShareValue(fund.shareChange) : '暂无数据', className: shareChangeClass(fund.shareChange), note: hasShareData(fund) ? fund.shareTime || '暂无数据' : '' },
        { label: '成交额', value: amountText(fund.turnover ?? fund.amount) },
        { label: '成交量', value: amountText(fund.volume) },
        { label: '申购状态', value: purchaseText(fund), pillClass: `limit-${purchaseState(fund)}` },
        { label: '估值校验', value: fund.estimateWarning || fund.premiumNote || '暂无数据' }
      ],
      liveFields: [
        { label: '代码', value: fund.code },
        { label: '名称', value: fund.name },
        { label: '现价', value: formatNumber(fund.marketPrice ?? fund.price), className: valueClass(fund.changeRate ?? fund.changePercent) },
        { label: '涨跌幅', value: percentText(fund.changeRate ?? fund.changePercent, { sign: true }), className: valueClass(fund.changeRate ?? fund.changePercent) },
        { label: '实时溢价率', value: percentText(fund.premiumRate), className: valueClass(fund.premiumRate) },
        { label: '官方净值', value: officialNavText(fund.lastNav ?? fund.nav), note: sourceText(navSource(fund)) },
        { label: '净值日期', value: fund.navDate || '暂无数据' },
        { label: '更新时间', value: fund.updateTime || '暂无数据' },
        { label: '上日净值涨幅', value: percentText(latestHistory.navGrowthRate, { sign: true }), className: valueClass(latestHistory.navGrowthRate) },
        { label: '估算净值', value: formatNumber(fund.estimatedNav ?? fund.estimatedValue), note: sourceText(estimatedSource(fund)) },
        { label: '估值时间', value: fund.estimatedNavTime || fund.navQuoteTime || fund.navDate || fund.quoteTime || '暂无数据' },
        { label: '场内份额', value: formatShareValue(fund.shareAmount), note: current.shareSourceText },
        { label: '较上一日份额', value: hasShareData(fund) ? formatShareValue(fund.shareChange) : '暂无数据', className: shareChangeClass(fund.shareChange), note: hasShareData(fund) ? fund.shareTime || '暂无数据' : '' },
        { label: '成交额', value: amountText(fund.turnover ?? fund.amount) },
        { label: '成交量', value: amountText(fund.volume) },
        { label: '申购状态', value: purchaseText(fund), pillClass: `limit-${purchaseState(fund)}` },
        { label: '估值校验', value: fund.estimateWarning || fund.premiumNote || '暂无数据', wide: true }
      ],
      auditRows: [
        { label: '行情', source: sourceText(fund.quoteSource || fund.source), time: fund.quoteTime || fund.updateTime || '暂无数据' },
        { label: '官方净值', source: sourceText(navSource(fund)), time: fund.navDate || fund.navQuoteTime || fund.updateTime || '暂无数据' },
        { label: '估算净值', source: sourceText(estimatedSource(fund)), time: fund.estimatedNavTime || fund.navQuoteTime || fund.updateTime || '暂无数据' },
        { label: '申购状态', source: sourceText(fund.subscriptionSource), time: fund.subscriptionTime || '暂无数据' }
      ]
    });
  },

  handleBack() {
    wx.navigateBack();
  },

  scrollToTop() {
    wx.pageScrollTo({
      scrollTop: 0,
      duration: 220
    });
    this.setData({ showBackTop: false });
  }
});

function decorateHistoryRow(row) {
  const cells = HISTORY_COLUMNS.map((column) => {
    const value = row[column.value];
    return {
      key: column.key,
      text: historyCellText(value, column),
      className: column.kind === 'percent' ? valueClass(value) : ''
    };
  });
  return Object.assign({}, row, { cells });
}

function historyCellText(value, column) {
  if (column.kind === 'amount') return amountText(value);
  if (column.kind === 'percent') return percentText(value, { sign: column.key === 'changeRate' || column.key === 'navGrowthRate' });
  if (column.kind === 'number') return formatNumber(value, column.key === 'unitNav' ? 4 : 3);
  return value || '暂无数据';
}

function navSource(fund) {
  return fund.navSource || fund.source || '';
}

function estimatedSource(fund) {
  return fund.estimatedNavSource || '';
}

function sourceText(source) {
  return sourceLabel(source) || '暂无数据';
}

function purchaseText(fund) {
  const rawLabel = fund.purchaseLimit && (fund.purchaseLimit.label || fund.purchaseLimit.limitText) || fund.subscriptionStatus || '';
  const label = !rawLabel || /^(未知|--|-|N\/A)$/i.test(rawLabel) ? '暂无数据' : rawLabel;
  const state = fund.purchaseLimit && fund.purchaseLimit.state || fund.subscriptionState || 'unavailable';
  if (state === 'open' && (/无限额|不限额/.test(label) || /开放/.test(label))) return '不限额';
  if (/开放申购\s*\/\s*无限额|开放申购.*不限额/.test(label)) return '不限额';
  return label;
}

function purchaseState(fund) {
  const state = fund.purchaseLimit && fund.purchaseLimit.state || fund.subscriptionState;
  return !state || state === 'unknown' ? 'unavailable' : state;
}

function hasShareData(fund) {
  return Boolean(fund.shareAmount || fund.shareChange);
}
