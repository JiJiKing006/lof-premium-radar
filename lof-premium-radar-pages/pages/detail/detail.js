const { fetchFundDetail, fetchFundHistory } = require('../../utils/fund-api');
const { formatNumber, officialNavText, percentText, amountText, formatShareValue, shareChangeClass, valueClass } = require('../../utils/format');

const HISTORY_COLUMNS = [
  historyColumn('date', '日期', 'date', 'date', 168),
  historyColumn('premiumRate', '历史溢价率', 'premiumRate', 'percent', 178),
  historyColumn('changeRate', '日变化', 'changeRate', 'percent', 154),
  historyColumn('unitNav', '单位值', 'unitNav', 'number', 154),
  historyColumn('navGrowthRate', '公布值变化', 'navGrowthRate', 'percent', 178),
  historyColumn('volume', '数量', 'volume', 'amount', 164),
  historyColumn('turnover', '金额', 'turnover', 'amount', 176)
];

Page({
  data: {
    code: '',
    section: '',
    current: null,
    summaryCards: [],
    leftFields: [],
    rightFields: [],
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
      if (this.data.current) this.applyFund(this.data.current);
    } catch (error) {
      this.setData({ historyError: error && error.message ? error.message : '历史数据加载失败' });
    } finally {
      this.setData({ historyLoading: false });
    }
  },

  onPageScroll(event) {
    const showBackTop = Number(event.scrollTop || 0) > 360;
    if (showBackTop !== this.data.showBackTop) {
      this.setData({ showBackTop });
    }
  },

  applyFund(fund) {
    wx.setNavigationBarTitle({
      title: `${fund.name || '数据详情'}（${fund.code || this.data.code}）`
    });

    const analysis = buildHistoryAnalysis(this.data.historyRows, fund);
    const current = Object.assign({}, fund, {
      titleText: `${fund.name || '数据详情'}（${fund.code || this.data.code}）`,
      purchaseText: purchaseText(fund),
      purchaseState: purchaseState(fund),
      settlementCycleText: fund.settlementCycle || '暂无数据',
      settlementState: fund.settlementCycle === 'T+2' ? 'short' : fund.settlementCycle === 'T+3' ? 'long' : 'unknown',
      shareChangeClass: shareChangeClass(fund.shareChange)
    });

    const changeValue = fund.changeRate ?? fund.changePercent;
    const premiumValue = fund.premiumRate;
    this.setData({
      current,
      summaryCards: [
        {
          key: 'price',
          label: '当前值',
          icon: '/images/icons/detail-price.svg',
          value: formatNumber(fund.marketPrice ?? fund.price),
          className: valueClass(changeValue),
          sideLabel: '较上日变化',
          sideValue: percentText(changeValue, { sign: true }),
          sideClass: valueClass(changeValue),
          toneClass: ''
        },
        {
          key: 'premium',
          label: '实时溢价率',
          icon: '/images/icons/detail-premium.svg',
          value: percentText(premiumValue),
          className: valueClass(premiumValue),
          note: Number.isFinite(Number(premiumValue)) ? '基于已公布数据' : '暂无数据',
          toneClass: premiumTone(premiumValue)
        },
        {
          key: 'streak',
          label: analysis.streakLabel,
          icon: '/images/icons/detail-streak.svg',
          value: analysis.streakValue,
          className: analysis.streakClass,
          note: analysis.streakNote,
          toneClass: ''
        },
        {
          key: 'turnover-change',
          label: '日金额变化',
          icon: '/images/icons/detail-turnover.svg',
          value: analysis.turnoverChangeText,
          className: analysis.turnoverChangeClass,
          note: analysis.turnoverChangeDate,
          toneClass: ''
        }
      ],
      leftFields: [
        detailField('代码', fund.code || '暂无数据', '/images/icons/detail-code.svg'),
        detailField('当前值', formatNumber(fund.marketPrice ?? fund.price), '/images/icons/detail-price.svg', valueClass(changeValue)),
        detailField('实时溢价率', percentText(premiumValue), '/images/icons/detail-premium.svg', valueClass(premiumValue)),
        detailField('公布值', officialNavText(fund.lastNav ?? fund.nav), '/images/icons/detail-nav.svg'),
        detailField('数量', amountText(fund.volume), '/images/icons/detail-volume.svg'),
        detailField('份额', formatShareValue(fund.shareAmount), '/images/icons/detail-share.svg')
      ],
      rightFields: [
        detailField('名称', fund.name || '暂无数据', '/images/icons/detail-name.svg'),
        detailField('日变化', percentText(changeValue, { sign: true }), '/images/icons/detail-change.svg', valueClass(changeValue)),
        detailField(analysis.streakLabel, analysis.streakValue, '/images/icons/detail-streak.svg', analysis.streakClass),
        detailField('参考值', formatNumber(fund.estimatedNav ?? fund.estimatedValue, 4), '/images/icons/detail-estimate.svg'),
        detailField('金额', amountText(fund.turnover ?? fund.amount), '/images/icons/detail-turnover.svg'),
        detailField('份额变化', hasShareData(fund) ? formatShareValue(fund.shareChange) : '暂无数据', '/images/icons/detail-share-change.svg', shareChangeClass(fund.shareChange))
      ],
      trendPoints: analysis.trend.points,
      trendSegments: analysis.trend.segments,
      trendAxis: analysis.trend.axis,
      trendZeroStyle: analysis.trend.zeroStyle,
      trendAreaStyle: analysis.trend.areaStyle,
      trendRangeText: analysis.trend.rangeText
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
    streakLabel: directionText ? `连续${directionText}天数` : '连续溢价/折价天数',
    streakValue: streak ? `${streak}天` : '暂无数据',
    streakClass: direction === 'premium' ? 'value-up' : direction === 'discount' ? 'value-down' : 'value-flat',
    streakNote: streak ? `近${streak}个交易日连续${directionText}` : '暂无数据',
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

function purchaseText(fund) {
  const limit = fund && fund.purchaseLimit || {};
  const label = String(limit.label || limit.limitText || fund && fund.subscriptionStatus || '').trim();
  const state = String(limit.state || fund && fund.subscriptionState || '').toLowerCase();
  const explicitAmount = purchaseLimitAmount(limit, label);

  if (state === 'paused' || /暂停|停止/.test(label)) return '暂停';
  if (state === 'open' || /不限额|无限额|不限|开放/.test(label) || explicitAmount !== null && explicitAmount >= 800_000_000) return '不限';
  if (state === 'limited' || /限|大额/.test(label)) {
    return explicitAmount === null ? '暂无数据' : `限 ${formatPurchaseAmount(explicitAmount)}`;
  }
  return '暂无数据';
}

function purchaseLimitAmount(limit, label) {
  const value = limit.dailyLimit ?? limit.limitAmount ?? limit.amountYuan;
  if (value !== null && value !== undefined && value !== '') {
    const amount = Number(value);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  const match = String(label || '').match(/(\d+(?:\.\d+)?)\s*(亿|万|元)/);
  if (!match) return null;
  const scale = match[2] === '亿' ? 100_000_000 : match[2] === '万' ? 10_000 : 1;
  const amount = Number(match[1]) * scale;
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function formatPurchaseAmount(amount) {
  if (amount > 10_000) return `${trimPurchaseDecimal(amount / 10_000, 4)} 万`;
  return `${trimPurchaseDecimal(amount, 2)} 元`;
}

function trimPurchaseDecimal(value, precision) {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(precision).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
}

function purchaseState(fund) {
  const state = fund.purchaseLimit && fund.purchaseLimit.state || fund.subscriptionState;
  return !state || state === 'unknown' ? 'unavailable' : state;
}

function hasShareData(fund) {
  return Boolean(fund.shareAmount || fund.shareChange);
}
