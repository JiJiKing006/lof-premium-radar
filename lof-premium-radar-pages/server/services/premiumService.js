export function calculatePremium({ marketPrice, estimatedNav, lastNav }) {
  const price = toPositiveNumber(marketPrice);
  const estimateResult = resolveEstimatedNav(arguments[0]);
  const estimate = estimateResult.estimatedNav;
  const nav = toPositiveNumber(lastNav);

  if (!price) return { premiumRate: null, basis: 'none', note: 'price 缺失' };

  if (estimate) {
    return {
      premiumRate: ((price / estimate) - 1) * 100,
      basis: 'estimatedNav',
      note: estimateResult.note,
      ...estimateResult,
    };
  }

  if (nav) {
    return {
      premiumRate: ((price / nav) - 1) * 100,
      basis: 'lastNav',
      note: '基于已公布净值，非实时估算',
      estimatedNav: null,
      selectedNavSource: '',
      selectedNavTime: '',
      estimateConfidence: 'none',
      estimateDeviationRate: null,
      estimateWarning: '',
      estimateSources: [],
    };
  }

  return { premiumRate: null, basis: 'none', note: 'nav 缺失' };
}

function resolveEstimatedNav(input) {
  const candidates = [
    buildCandidate({
      value: input.estimatedNav,
      source: input.estimatedNavSource || input.quoteSource || input.source || 'primary',
      time: input.estimatedNavTime || input.navQuoteTime || input.quoteTime || '',
      role: 'primary',
    }),
    buildCandidate({
      value: input.supplementalEstimatedNav,
      source: input.supplementalNavSource || 'supplemental',
      time: input.supplementalNavTime || '',
      role: 'supplemental',
    }),
  ].filter(Boolean);

  if (!candidates.length) {
    return {
      estimatedNav: null,
      selectedNavSource: '',
      selectedNavTime: '',
      estimateConfidence: 'none',
      estimateDeviationRate: null,
      estimateWarning: '',
      estimateSources: [],
      note: '基于估算净值',
    };
  }

  const selected = candidates.slice().sort(compareCandidateQuality)[0];
  const deviation = maxDeviationRate(candidates);
  const confidence = estimateConfidence(deviation, candidates.length);
  const warning = confidence === 'low' ? `估算净值多源偏差 ${deviation.toFixed(2)}%` : '';

  return {
    estimatedNav: selected.value,
    selectedNavSource: selected.source,
    selectedNavTime: selected.time,
    estimateConfidence: confidence,
    estimateDeviationRate: deviation,
    estimateWarning: warning,
    estimateSources: candidates.map(({ role, source, value, time }) => ({ role, source, value, time })),
    note: warning || (candidates.length > 1 ? '基于多源估算净值' : '基于估算净值'),
  };
}

function buildCandidate({ value, source, time, role }) {
  const number = toPositiveNumber(value);
  if (!number) return null;
  return {
    value: number,
    source: String(source || ''),
    time: String(time || ''),
    role,
    sourcePriority: sourcePriority(source),
    timestamp: parseShanghaiTime(time),
  };
}

function compareCandidateQuality(left, right) {
  if (right.sourcePriority !== left.sourcePriority) return right.sourcePriority - left.sourcePriority;
  if (right.timestamp !== left.timestamp) return right.timestamp - left.timestamp;
  return left.role === 'primary' ? -1 : 1;
}

function sourcePriority(source) {
  const text = String(source || '').toLowerCase();
  if (text.includes('tiantian')) return 95;
  if (text.includes('jisilu')) return 90;
  if (text.includes('haoetf')) return 85;
  if (text.includes('palmmicro')) return 80;
  if (text === 'lof') return 75;
  return 70;
}

function maxDeviationRate(candidates) {
  if (candidates.length < 2) return 0;
  let max = 0;
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      const midpoint = (candidates[left].value + candidates[right].value) / 2;
      if (!midpoint) continue;
      max = Math.max(max, Math.abs(candidates[left].value - candidates[right].value) / midpoint * 100);
    }
  }
  return max;
}

function estimateConfidence(deviation, sourceCount) {
  if (sourceCount < 2) return 'single';
  if (deviation <= 0.5) return 'high';
  if (deviation <= 1.5) return 'medium';
  return 'low';
}

function parseShanghaiTime(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  const normalized = text.replace(' ', 'T');
  const time = new Date(`${normalized}+08:00`).getTime();
  return Number.isFinite(time) ? time : 0;
}

function toPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
