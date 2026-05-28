export function calculatePremium({ marketPrice, estimatedNav, lastNav }) {
  const price = toPositiveNumber(marketPrice);
  const estimate = toPositiveNumber(estimatedNav);
  const nav = toPositiveNumber(lastNav);

  if (!price) return { premiumRate: null, basis: 'none', note: 'price 缺失' };

  if (estimate) {
    return {
      premiumRate: ((price / estimate) - 1) * 100,
      basis: 'estimatedNav',
      note: '基于估算净值',
    };
  }

  if (nav) {
    return {
      premiumRate: ((price / nav) - 1) * 100,
      basis: 'lastNav',
      note: '基于已公布净值，非实时估算',
    };
  }

  return { premiumRate: null, basis: 'none', note: 'nav 缺失' };
}

function toPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
