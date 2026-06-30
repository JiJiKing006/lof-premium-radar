export function calculatePremium({ marketPrice, estimatedNav, lastNav }) {
  const input = arguments[0] || {};
  const price = toPositiveNumber(marketPrice);
  const estimateResult = resolveEstimatedNav(input);
  const nav = toPositiveNumber(lastNav);
  const officialPremiumRate = price && nav ? ((price / nav) - 1) * 100 : null;

  if (!price) return {
    ...estimateResult,
    premiumRate: null,
    realtimePremiumRate: null,
    officialPremiumRate: null,
    basis: 'none',
    note: 'price 缺失',
  };

  const iopv = toPositiveNumber(input.iopv);
  if (iopv && input.iopvStale !== true && String(input.iopvSource || '').trim()
    && isEstimateCurrentForQuote(input.iopvTime, { now: input.now, quoteTime: input.quoteTime })) {
    const realtimePremiumRate = ((price / iopv) - 1) * 100;
    return {
      ...estimateResult,
      premiumRate: realtimePremiumRate,
      realtimePremiumRate,
      officialPremiumRate,
      basis: 'iopv',
      estimatedNav: iopv,
      selectedNavSource: String(input.iopvSource || ''),
      selectedNavTime: String(input.iopvTime || ''),
      note: '基于交易所IOPV',
    };
  }

  const realtimeReferenceNav = toPositiveNumber(input.realtimeReferenceNav);
  if (isEligibleRealtimeReference(realtimeReferenceNav, input)) {
    const realtimePremiumRate = ((price / realtimeReferenceNav) - 1) * 100;
    return {
      premiumRate: realtimePremiumRate,
      realtimePremiumRate,
      officialPremiumRate,
      basis: 'estimatedNav',
      ...estimateResult,
      estimatedNav: realtimeReferenceNav,
      selectedNavSource: String(input.realtimeReferenceSource || ''),
      selectedNavTime: String(input.realtimeReferenceTime || ''),
      estimateConfidence: input.realtimeReferenceKind === 'realtime' ? 'source-realtime' : 'source-estimate',
      estimateWarning: '',
      estimateSources: [{
        role: 'realtimeReference',
        source: String(input.realtimeReferenceSource || ''),
        value: realtimeReferenceNav,
        time: String(input.realtimeReferenceTime || ''),
      }],
      note: '基于目标网站估值（非官方净值）',
    };
  }

  if (estimateResult.estimatedNav && estimateResult.selectedIsCurrent) {
    const realtimePremiumRate = ((price / estimateResult.estimatedNav) - 1) * 100;
    return {
      ...estimateResult,
      premiumRate: realtimePremiumRate,
      realtimePremiumRate,
      officialPremiumRate,
      basis: 'estimatedNav',
      note: estimateResult.note || '基于今日估算净值（非官方净值）',
    };
  }

  return {
    ...estimateResult,
    premiumRate: null,
    realtimePremiumRate: null,
    officialPremiumRate,
    basis: 'none',
    note: '今日估算净值暂无数据',
  };
}

function isEligibleRealtimeReference(value, input) {
  if (!value || input.realtimeReferenceStale === true) return false;
  if (!String(input.realtimeReferenceSource || '').trim()) return false;
  if (!isEstimateCurrentForQuote(input.realtimeReferenceTime, { now: input.now, quoteTime: input.quoteTime })) return false;
  if (!isPlausibleEstimatedNav(value, input)) return false;

  return true;
}

function resolveEstimatedNav(input) {
  const rejected = [];
  const candidates = [
    buildCandidate({
      value: input.estimatedNav,
      source: input.estimatedNavSource || input.quoteSource || input.source || 'primary',
      time: input.estimatedNavTime || input.navQuoteTime || input.quoteTime || '',
      role: 'primary',
      input,
      rejected,
    }),
    buildCandidate({
      value: input.supplementalEstimatedNav,
      source: input.supplementalNavSource || 'supplemental',
      time: input.supplementalNavTime || '',
      role: 'supplemental',
      input,
      rejected,
    }),
    ...(Array.isArray(input.estimateCandidates) ? input.estimateCandidates.map((candidate, index) => buildCandidate({
      value: candidate?.value ?? candidate?.estimatedNav,
      source: candidate?.source ?? candidate?.estimatedNavSource,
      time: candidate?.time ?? candidate?.estimatedNavTime,
      role: candidate?.role || `source-${index + 1}`,
      input,
      rejected,
    })) : []),
  ].filter(Boolean);

  const dedupedCandidates = dedupeCandidates(candidates);

  if (!dedupedCandidates.length) {
    return {
      estimatedNav: null,
      selectedNavSource: '',
      selectedNavTime: '',
      selectedIsCurrent: false,
      estimateConfidence: 'none',
      estimateDeviationRate: null,
      estimateWarning: rejected.length ? '估算净值量级异常，已改用官方净值' : '',
      estimateSources: [],
      note: '基于估算净值',
    };
  }

  const selected = dedupedCandidates.slice().sort(compareCandidateQuality)[0];
  const currentCandidates = dedupedCandidates.filter((candidate) => candidate.isCurrent);
  const comparisonCandidates = currentCandidates.length ? currentCandidates : dedupedCandidates;
  const deviation = maxDeviationRate(comparisonCandidates);
  const confidence = estimateConfidence(deviation, comparisonCandidates.length);
  const warning = confidence === 'low' ? `估算净值多源偏差 ${deviation.toFixed(2)}%` : '';

  return {
    estimatedNav: selected.value,
    selectedNavSource: selected.source,
    selectedNavTime: selected.time,
    selectedIsCurrent: selected.isCurrent,
    estimateConfidence: confidence,
    estimateDeviationRate: deviation,
    estimateWarning: warning,
    estimateSources: dedupedCandidates.map(({ role, source, value, time, isCurrent }) => ({ role, source, value, time, isCurrent })),
    note: warning || (comparisonCandidates.length > 1 ? '基于多源今日估算净值（非官方净值）' : '基于今日估算净值（非官方净值）'),
  };
}

function buildCandidate({ value, source, time, role, input, rejected }) {
  const number = toPositiveNumber(value);
  if (!number) return null;
  if (!isPlausibleEstimatedNav(number, input)) {
    rejected?.push({ role, source, value: number, time });
    return null;
  }
  return {
    value: number,
    source: String(source || ''),
    time: String(time || ''),
    role,
    isCurrent: isEstimateCurrentForQuote(time, { now: input.now, quoteTime: input.quoteTime }),
    sourcePriority: sourcePriority(source),
    timestamp: parseShanghaiTime(time),
  };
}

function isPlausibleEstimatedNav(value, input = {}) {
  const nav = toPositiveNumber(input.lastNav);
  if (nav) return Math.abs((value / nav) - 1) <= 0.35;
  const price = toPositiveNumber(input.marketPrice);
  if (price) return Math.abs((value / price) - 1) <= 0.5;
  return true;
}

function compareCandidateQuality(left, right) {
  if (right.isCurrent !== left.isCurrent) return Number(right.isCurrent) - Number(left.isCurrent);
  if (right.sourcePriority !== left.sourcePriority) return right.sourcePriority - left.sourcePriority;
  if (right.timestamp !== left.timestamp) return right.timestamp - left.timestamp;
  return left.role === 'primary' ? -1 : 1;
}

function sourcePriority(source) {
  const text = String(source || '').toLowerCase();
  if (text.includes('akshare-eastmoney')) return 99;
  if (text.includes('tiantian')) return 100;
  if (text.includes('lof8')) return 98;
  if (text.includes('eastmoney')) return 96;
  if (text.includes('sina')) return 94;
  if (text.includes('jisilu')) return 82;
  if (text.includes('haoetf')) return 78;
  if (text.includes('sse') || text.includes('szse')) return 76;
  if (text.includes('palmmicro')) return 75;
  if (text === 'lof') return 72;
  return 70;
}

function dedupeCandidates(candidates) {
  const byObservation = new Map();
  for (const candidate of candidates) {
    // LOF8 explicitly republishes Tiantian estimates. Treat both as one source
    // family so a mirrored value cannot falsely become "multi-source" evidence.
    const family = /lof8|tiantian|akshare-eastmoney/i.test(candidate.source) ? 'eastmoney-estimate-family' : candidate.source;
    const key = `${family}:${candidate.time}:${candidate.value}`;
    const previous = byObservation.get(key);
    if (!previous || candidate.sourcePriority > previous.sourcePriority) {
      byObservation.set(key, candidate);
    }
  }
  return [...byObservation.values()];
}

export function isEstimateCurrentForQuote(value, { now = new Date(), quoteTime = '' } = {}) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}(:\d{2})?$/);
  if (!match) return false;
  const current = now instanceof Date ? now : new Date(now || Date.now());
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(current);
  if (match[1] > today) return false;
  const quoteDate = timestampDate(quoteTime);
  return quoteDate ? match[1] >= quoteDate : match[1] === today;
}

function timestampDate(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}(:\d{2})?$/);
  return match ? match[1] : '';
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
