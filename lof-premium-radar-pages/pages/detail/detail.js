const { fetchFundDetail, fetchFundHistory } = require('../../utils/fund-api');
const { formatNumber, officialNavText, percentText, amountText, formatShareValue, shareChangeClass, valueClass } = require('../../utils/format');
const { sourceLabel } = require('../../utils/source-links');
const { purchaseText, purchaseState } = require('../../utils/fund-display');

const HISTORY_COLUMNS = [
  historyColumn('date', '日期', 'date', 'date', 168),
  historyColumn('premiumRate', '历史溢价率', 'premiumRate', 'percent', 178),
  historyColumn('changeRate', '涨跌幅', 'changeRate', 'percent', 154),
  historyColumn('unitNav', '单位净值', 'unitNav', 'number', 154),
  historyColumn('navGrowthRate', '净值增长率', 'navGrowthRate', 'percent', 178),
  historyColumn('volume', '成交量', 'volume', 'amount', 164),
  historyColumn('turnover', '成交额', 'turnover', 'amount', 176)
];

Page({
  data: {
    code: '',
    section: '',
    current: null,
    summaryCards: [],
    liveFields: [],
    estimateExplanation: null,
    summarySkeletonCards: Array.from({ length: 4 }, (_, index) => index),
    liveSkeletonFields: Array.from({ length: 8 }, (_, index) => index),
    trendPoints: [],
    trendSegments: [],
    trendAxis: [],
    trendZeroStyle: 'top:80%;',
    trendAreaStyle: '',
    trendRangeText: '近6个交易日',
    historyColumns: HISTORY_COLUMNS,
    historyGridStyle: `min-width:${HISTORY_COLUMNS.reduce((sum, item) => sum + item.preferredWidth, 0)}rpx;`,
    historyRows: [],
    historySkeletonRows: Array.from({ length: 7 }, (_, index) => index),
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
      const fund = await fetchFundDetail(this.data.code, { section: this.data.section, force: options.force, showLoading: false });
      this.applyFund(fund);
    } catch (error) {
      this.setData({ error: error && error.message ? error.message : '详情数据加载失败' });
    } finally {
      this.setData({ detailLoading: false });
    }

    try {
      const snapshot = await fetchFundHistory(this.data.code, { limit: 40, force: options.force, showLoading: false });
      const rows = (snapshot.rows || []).map((row) => decorateHistoryRow(row));
      this.setData({ historyRows: rows });
    } catch (error) {
      this.setData({ historyError: error && error.message ? error.message : '历史数据加载失败' });
    } finally {
      this.setData({ historyLoading: false });
      if (this.data.current) this.applyFund(this.data.current);
    }
  },

  onPageScroll(event) {
    const showBackTop = Number(event.scrollTop || 0) > 360;
    if (showBackTop !== this.data.showBackTop) {
      this.setData({ showBackTop });
    }
  },

  applyFund(fund) {
    const displayCode = fund.code || this.data.code || '暂无数据';
    wx.setNavigationBarTitle({
      title: displayCode
    });

    const analysis = buildHistoryAnalysis(this.data.historyRows, fund);
    const current = Object.assign({}, fund, {
      titleText: displayCode,
      purchaseText: purchaseText(fund),
      purchaseState: purchaseState(fund),
      showPurchase: hasDisplayText(purchaseText(fund)),
      showUpdateTime: hasDisplayText(fund.updateTime || fund.quoteTime),
      settlementCycleText: settlementCycleText(fund.settlementCycle),
      settlementState: fund.settlementCycle === 'T+2' ? 'short' : fund.settlementCycle === 'T+3' ? 'long' : 'unknown',
      shareChangeClass: shareChangeClass(fund.shareChange)
    });

    const changeValue = fund.changeRate ?? fund.changePercent;
    const premiumValue = fund.premiumRate;
    const priceValue = fund.marketPrice ?? fund.price;
    const estimatedNav = fund.estimatedNav ?? fund.estimatedValue;
    const verifiedScale = hasVerifiedFundScale(fund);
    const verifiedTurnoverRate = hasVerifiedTurnoverRate(fund);
    const hasShareTrace = hasDisplayText(fund.shareSource) && hasDisplayText(fund.shareTime);
    const summaryCards = [
      hasPositiveNumber(priceValue) ? {
        key: 'price',
        label: '实时价格',
        icon: '/images/icons/detail-price.svg',
        value: formatNumber(priceValue),
        className: valueClass(changeValue),
        note: hasDisplayText(fund.quoteTime) ? fund.quoteTime : '',
        sideLabel: hasFiniteNumber(changeValue) ? '涨跌幅' : '',
        sideValue: hasFiniteNumber(changeValue) ? percentText(changeValue, { sign: true }) : '',
        sideClass: valueClass(changeValue),
        toneClass: ''
      } : null,
      hasFiniteNumber(premiumValue) ? {
        key: 'premium',
        label: '实时溢价率',
        icon: '/images/icons/detail-premium.svg',
        value: percentText(premiumValue),
        className: valueClass(premiumValue),
        note: this.data.historyLoading ? '' : analysis.streakNote,
        noteClass: analysis.streakClass,
        noteLoading: this.data.historyLoading,
        toneClass: premiumTone(premiumValue)
      } : null,
      hasPositiveNumber(estimatedNav) ? {
        key: 'estimated-nav',
        label: '今日估算净值',
        icon: '/images/icons/detail-estimate.svg',
        value: formatNumber(estimatedNav, 4),
        className: '',
        note: hasDisplayText(fund.estimatedNavTime) ? fund.estimatedNavTime : '',
        toneClass: ''
      } : null,
      {
        key: 'fund-scale',
        label: '总规模',
        icon: '/images/icons/detail-turnover.svg',
        value: verifiedScale ? amountText(fund.fundScale) : '暂无数据',
        className: '',
        note: verifiedScale ? (fund.fundScaleDate || fund.fundScaleTime) : '',
        toneClass: ''
      }
    ].filter(Boolean);

    const officialNav = fund.lastNav ?? fund.nav;
    const liveFields = [
      optionalPositiveNumberField('官方净值', officialNav, '/images/icons/detail-nav.svg', officialNavText, '', officialNavTimeText(fund)),
      hasShareTrace ? optionalDetailField('总份额', fund.shareAmount, '/images/icons/detail-share.svg', '', fund.shareTime) : null,
      hasShareTrace ? optionalDetailField('较上一日份额', fund.shareChange, '/images/icons/detail-share-change.svg', shareChangeClass(fund.shareChange)) : null,
      optionalNumberField('成交量', fund.volume, '/images/icons/detail-volume.svg', amountText),
      optionalNumberField('成交额', fund.turnover ?? fund.amount, '/images/icons/detail-turnover.svg', amountText),
      verifiedTurnoverRate ? optionalNumberField('换手率', fund.turnoverRate, '/images/icons/detail-change.svg', percentText, '', fund.turnoverRateTime) : null
    ].filter(Boolean);

    const estimateExplanation = buildEstimateExplanation(fund, estimatedNav);

    this.setData({
      current,
      summaryCards,
      liveFields,
      estimateExplanation,
      trendPoints: analysis.trend.points,
      trendSegments: analysis.trend.segments,
      trendAxis: analysis.trend.axis,
      trendZeroStyle: analysis.trend.zeroStyle,
      trendAreaStyle: analysis.trend.areaStyle,
      trendRangeText: analysis.trend.rangeText
    });
  },

  copyFundCode() {
    const code = String(this.data.current && this.data.current.code || this.data.code || '').trim();
    if (!code) return;
    wx.setClipboardData({
      data: code,
      success() {
        wx.showToast({ title: '代码已复制', icon: 'success' });
      }
    });
  },

  scrollToTop() {
    wx.pageScrollTo({
      scrollTop: 0,
      duration: 220
    });
    this.setData({ showBackTop: false });
  }
});

function historyColumn(key, label, value, kind, preferredWidth) {
  return {
    key,
    label,
    value,
    kind,
    preferredWidth,
    style: `flex:0 0 ${preferredWidth}rpx;width:${preferredWidth}rpx;`
  };
}

function detailField(label, value, icon, className = '', note = '') {
  return { label, value, icon, className, note };
}

function optionalDetailField(label, value, icon, className = '', note = '') {
  if (!hasDisplayText(value)) return null;
  return detailField(label, formatShareValue(value), icon, className, hasDisplayText(note) ? note : '');
}

function optionalNumberField(label, value, icon, formatter, className = '', note = '') {
  if (!hasFiniteNumber(value)) return null;
  return detailField(label, formatter(value), icon, className, hasDisplayText(note) ? note : '');
}

function optionalPositiveNumberField(label, value, icon, formatter, className = '', note = '') {
  if (!hasPositiveNumber(value)) return null;
  return detailField(label, formatter(value), icon, className, hasDisplayText(note) ? note : '');
}

function hasFiniteNumber(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function hasPositiveNumber(value) {
  return hasFiniteNumber(value) && Number(value) > 0;
}

function hasDisplayText(value) {
  const text = String(value ?? '').trim();
  return Boolean(text) && !['暂无数据', '净值未公布', '--', 'N/A'].includes(text);
}

function hasVerifiedFundScale(fund = {}) {
  return hasPositiveNumber(fund.fundScale)
    && hasDisplayText(fund.fundScaleSource)
    && hasDisplayText(fund.fundScaleTime)
    && hasDisplayText(fund.fundScaleDate);
}

function hasVerifiedTurnoverRate(fund = {}) {
  return hasFiniteNumber(fund.turnoverRate)
    && Number(fund.turnoverRate) >= 0
    && fund.turnoverRateBasis === 'volumeShares/exchangeShare'
    && ['share', 'lot'].includes(fund.turnoverRateVolumeUnit)
    && hasDisplayText(fund.turnoverRateSource)
    && hasDisplayText(fund.turnoverRateTime);
}

function officialNavTimeText(fund = {}) {
  const time = String(fund.navQuoteTime || '').trim();
  if (time) return time;
  const date = String(fund.navDate || '').trim();
  return date;
}

function buildEstimateExplanation(fund = {}, estimatedNav) {
  if (!hasPositiveNumber(estimatedNav)) return null;
  const provider = sourceLabel(fund.estimatedNavSource).replace(/基金/g, '').trim() || '第三方数据源';
  return {
    text: `数据来自${provider}，依据已披露持仓和相关市场行情测算，盘中会随行情变化，仅供参考，不代表官方净值。`,
    time: hasDisplayText(fund.estimatedNavTime) ? fund.estimatedNavTime : ''
  };
}

function settlementCycleText(value) {
  return hasDisplayText(value) ? value : '';
}

function decorateHistoryRow(row) {
  const cells = HISTORY_COLUMNS.map((column) => {
    const value = row[column.value];
    return {
      key: column.key,
      text: historyCellText(value, column),
      className: column.kind === 'percent' ? valueClass(value) : '',
      style: column.style
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

function buildHistoryAnalysis(rows, fund = {}) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const premiumRows = sourceRows.filter((row) => Number.isFinite(Number(row.premiumRate)));
  const latestPremium = premiumRows[0] ? Number(premiumRows[0].premiumRate) : null;
  const direction = latestPremium === null ? 'missing' : latestPremium > 0 ? 'premium' : latestPremium < 0 ? 'discount' : 'flat';
  let streak = 0;
  if (direction !== 'missing') {
    for (const row of premiumRows) {
      const value = Number(row.premiumRate);
      const matches = direction === 'premium' ? value > 0 : direction === 'discount' ? value < 0 : value === 0;
      if (!matches) break;
      streak += 1;
    }
  }

  const directionText = direction === 'premium' ? '溢价' : direction === 'discount' ? '折价' : direction === 'flat' ? '平价' : '';
  const turnoverRows = sourceRows.filter((row) => Number.isFinite(Number(row.turnover)));
  const currentTurnover = Number(fund.turnover ?? fund.amount);
  const currentQuoteDate = datePart(fund.quoteTime || '');
  const previousTurnoverRow = turnoverRows.find((row) => !currentQuoteDate || row.date !== currentQuoteDate);
  const turnoverChange = Number.isFinite(currentTurnover) && previousTurnoverRow
    ? currentTurnover - Number(previousTurnoverRow.turnover)
    : null;

  return {
    streakLabel: directionText ? `连续${directionText}天数` : '',
    streakValue: streak ? `${streak}天` : '',
    streakClass: direction === 'premium' ? 'value-up' : direction === 'discount' ? 'value-down' : 'value-flat',
    streakNote: streak ? `连续${directionText} ${streak} 天` : '',
    turnoverChangeText: signedAmountText(turnoverChange),
    turnoverChangeClass: valueClass(turnoverChange),
    turnoverChangeDate: currentQuoteDate || '暂无数据',
    trend: buildPremiumTrend(premiumRows.slice(0, 6).reverse())
  };
}

function buildPremiumTrend(rows) {
  if (!rows.length) {
    return {
      points: [],
      segments: [],
      axis: [50, 40, 30, 20, 10, 0].map((value, index) => ({ label: `${value}%`, style: `top:${10 + (index * 14)}%;` })),
      zeroStyle: 'top:80%;',
      areaStyle: '',
      rangeText: '近6个交易日'
    };
  }

  const values = rows.map((row) => Number(row.premiumRate));
  const highest = Math.max(0, ...values);
  const lowest = Math.min(0, ...values);
  let max = Math.ceil((highest + Math.max(2, Math.abs(highest) * 0.12)) / 10) * 10;
  let min = Math.floor((lowest - (lowest < 0 ? Math.max(2, Math.abs(lowest) * 0.12) : 0)) / 10) * 10;
  if (max <= min) max = min + 10;
  if (max === 0) max = 10;

  const plotTop = 10;
  const plotBottom = 80;
  const plotLeft = 14;
  const plotRight = 94;
  const range = max - min;
  const xStep = rows.length > 1 ? (plotRight - plotLeft) / (rows.length - 1) : 0;
  const points = rows.map((row, index) => {
    const x = rows.length === 1 ? 53 : plotLeft + (xStep * index);
    const y = plotTop + ((max - Number(row.premiumRate)) / range) * (plotBottom - plotTop);
    const isLatest = index === rows.length - 1;
    return {
      key: `${row.date}-${index}`,
      date: shortDate(row.date),
      value: percentText(row.premiumRate),
      x: round(x),
      y: round(y),
      pointStyle: `left:${round(x)}%;top:${round(y)}%;`,
      dateStyle: `left:${round(x)}%;top:86%;`,
      isLatest,
      isRecent: index >= Math.max(0, rows.length - 3)
    };
  });

  const segments = points.slice(1).map((point, index) => {
    const previous = points[index];
    const dx = ((point.x - previous.x) / 100) * 600;
    const dy = ((point.y - previous.y) / 100) * 240;
    const width = (Math.sqrt((dx * dx) + (dy * dy)) / 600) * 100;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    return {
      key: `${previous.key}-${point.key}`,
      style: `left:${previous.x}%;top:${previous.y}%;width:${round(width)}%;transform:rotate(${round(angle)}deg);`
    };
  });

  const polygon = [
    ...points.map((point) => `${point.x}% ${point.y}%`),
    `${points[points.length - 1].x}% ${plotBottom}%`,
    `${points[0].x}% ${plotBottom}%`
  ].join(',');
  const axis = Array.from({ length: 6 }, (_, index) => {
    const value = max - ((range / 5) * index);
    const y = plotTop + ((plotBottom - plotTop) / 5) * index;
    return { label: axisPercent(value), style: `top:${round(y)}%;` };
  });
  const zeroY = plotTop + ((max - 0) / range) * (plotBottom - plotTop);

  return {
    points,
    segments,
    axis,
    zeroStyle: `top:${round(zeroY)}%;`,
    areaStyle: `clip-path:polygon(${polygon});-webkit-clip-path:polygon(${polygon});`,
    rangeText: `近${rows.length}个交易日`
  };
}

function signedAmountText(value) {
  if (!Number.isFinite(value)) return '暂无数据';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${amountText(Math.abs(value))}`;
}

function axisPercent(value) {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function shortDate(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text.slice(5) : text || '暂无数据';
}

function datePart(value) {
  const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function premiumTone(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return 'premium-tone-flat';
  return number > 0 ? 'premium-tone-up' : 'premium-tone-down';
}
