const { formatNumber, officialNavText, percentText, amountText, premiumClass, priceClass, valueClass } = require('./format');
const { sourceLabel } = require('./source-links');

function decorateFund(fund) {
  const navSource = fund.navSource || fund.source || '';
  const estimatedSource = fund.estimatedNavSource || '';
  return Object.assign(fund, {
    display: {
      premiumRate: percentText(fund.premiumRate),
      officialPremiumRate: percentText(fund.officialPremiumRate),
      marketPrice: formatNumber(fund.marketPrice ?? fund.price),
      changeRate: percentText(fund.changeRate ?? fund.changePercent, { sign: true }),
      lastNav: officialNavText(fund.lastNav ?? fund.nav),
      estimatedNav: formatNumber(fund.estimatedNav ?? fund.estimatedValue, 4),
      turnover: amountText(fund.turnover ?? fund.amount),
      volume: amountText(fund.volume),
      marketValue: amountText(fund.marketValue),
      navSource: sourceLabel(navSource) || '暂无数据',
      estimatedSource: sourceLabel(estimatedSource) || '暂无数据',
      navDate: fund.navDate || fund.navQuoteTime || fund.quoteTime || '暂无数据',
      estimatedTime: fund.estimatedNavTime || fund.navQuoteTime || fund.navDate || fund.quoteTime || '',
      updateTime: fund.updateTime || fund.quoteTime || '暂无数据'
    },
    classes: {
      premiumRate: premiumClass(fund.premiumRate),
      price: priceClass(fund.changeRate ?? fund.changePercent),
      changeRate: valueClass(fund.changeRate ?? fund.changePercent),
      shareChange: ''
    }
  });
}

module.exports = { decorateFund };
