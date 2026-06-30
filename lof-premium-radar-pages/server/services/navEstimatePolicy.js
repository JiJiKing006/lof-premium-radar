import { toNumber } from './fundNormalizer.js';
import { selectLatestOfficialNav } from './officialNavResolver.js';

export function mergeEstimateCandidate(existing = {}, candidate) {
  const candidates = normalizeEstimateCandidates(existing);
  const value = toNumber(candidate?.value);
  const source = String(candidate?.source || '').trim();
  const time = normalizeEstimateTimestamp(candidate?.time);
  if (value !== null && value > 0 && source && time) {
    const key = `${source}:${time}`;
    const next = { value, source, time };
    const index = candidates.findIndex((item) => `${item.source}:${item.time}` === key);
    if (index >= 0) candidates[index] = next;
    else candidates.push(next);
  }
  const selected = candidates.slice().sort(compareEstimateCandidate)[0] || null;
  return {
    ...existing,
    estimatedNav: selected?.value ?? null,
    estimatedNavSource: selected?.source || '',
    estimatedNavTime: selected?.time || '',
    estimateCandidates: candidates,
  };
}

export function normalizeEstimateCandidates(existing) {
  const candidates = Array.isArray(existing?.estimateCandidates)
    ? existing.estimateCandidates.map((item) => ({
        value: toNumber(item?.value),
        source: String(item?.source || '').trim(),
        time: normalizeEstimateTimestamp(item?.time),
      })).filter((item) => item.value !== null && item.value > 0 && item.source && item.time)
    : [];
  const existingValue = toNumber(existing?.estimatedNav);
  const existingSource = String(existing?.estimatedNavSource || '').trim();
  const existingTime = normalizeEstimateTimestamp(existing?.estimatedNavTime || existing?.navQuoteTime);
  if (existingValue !== null && existingValue > 0 && existingSource && existingTime
    && !candidates.some((item) => item.source === existingSource && item.time === existingTime)) {
    candidates.push({ value: existingValue, source: existingSource, time: existingTime });
  }
  return candidates;
}

export function compareEstimateCandidate(left, right) {
  const timeDelta = parseShanghaiTime(right.time) - parseShanghaiTime(left.time);
  if (timeDelta !== 0) return timeDelta;
  return estimateSourcePriority(right.source) - estimateSourcePriority(left.source);
}

function estimateSourcePriority(source) {
  const text = String(source || '').toLowerCase();
  if (text.includes('akshare-eastmoney')) return 99;
  if (text === 'tiantian') return 100;
  if (text.includes('lof8')) return 98;
  if (text.includes('jisilu')) return 90;
  if (text.includes('haoetf')) return 85;
  if (text === 'lof' || text.includes('palmmicro')) return 80;
  return 70;
}

export function normalizeEstimateTimestamp(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)) return `${text}:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) return text;
  return '';
}

export function hasCurrentEstimate(row, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return normalizeEstimateCandidates(row).some((item) => item.time.startsWith(today));
}

export function applyOfficialNav(base, candidates) {
  const selected = selectLatestOfficialNav(candidates);
  if (!selected) {
    return {
      ...base,
      lastNav: null,
      navDate: '',
      navQuoteTime: '',
      navSource: '',
    };
  }
  return {
    ...base,
    lastNav: selected.lastNav,
    navDate: selected.navDate,
    navQuoteTime: selected.navQuoteTime,
    navSource: selected.navSource,
    navFetchedAt: selected.navFetchedAt,
  };
}

export function parseShanghaiTime(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  const time = new Date(`${text.replace(' ', 'T')}+08:00`).getTime();
  return Number.isFinite(time) ? time : 0;
}
