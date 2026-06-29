const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';

export function selectLatestOfficialNav(candidates, { now = new Date() } = {}) {
  const clock = shanghaiClock(now);
  const normalized = (Array.isArray(candidates) ? candidates : [])
    .map((candidate, candidateIndex) => normalizeCandidate(candidate, candidateIndex, clock))
    .filter(Boolean);

  if (!normalized.length) return null;
  return normalized.slice().sort(compareCandidates)[0];
}

function normalizeCandidate(candidate, candidateIndex, clock) {
  if (!candidate || typeof candidate !== 'object') return null;
  const lastNav = Number(candidate.lastNav ?? candidate.nav);
  if (!Number.isFinite(lastNav) || lastNav <= 0) return null;
  const navSource = String(candidate.navSource || candidate.source || '').trim();
  if (/palmmicro|^lof$/i.test(navSource)) return null;

  const rawDate = String(candidate.navDate || '').trim();
  const navDate = normalizeDate(rawDate);
  if (rawDate && (!navDate || navDate > clock.today)) return null;
  if (navDate === clock.today && clock.minutes < 15 * 60) return null;

  return {
    lastNav,
    navDate,
    navSource,
    navQuoteTime: String(candidate.navQuoteTime || '').trim(),
    navFetchedAt: String(candidate.navFetchedAt || candidate.updateTime || '').trim(),
    candidateIndex,
  };
}

function compareCandidates(left, right) {
  const leftDated = Boolean(left.navDate);
  const rightDated = Boolean(right.navDate);
  if (leftDated !== rightDated) return leftDated ? -1 : 1;
  if (left.navDate !== right.navDate) return right.navDate.localeCompare(left.navDate);
  if (!leftDated) return left.candidateIndex - right.candidateIndex;

  const priorityDelta = sourcePriority(right.navSource) - sourcePriority(left.navSource);
  if (priorityDelta !== 0) return priorityDelta;
  return left.candidateIndex - right.candidateIndex;
}

function sourcePriority(source) {
  const text = String(source || '').toLowerCase();
  if (/fund-company|基金公司|管理人/.test(text)) return 110;
  if (text.includes('eastmoney')) return 100;
  if (text.includes('tiantian')) return 96;
  if (text.includes('sina')) return 94;
  if (text.includes('jisilu')) return 82;
  if (text.includes('sse') || text.includes('szse') || text.includes('exchange')) return 80;
  if (text.includes('haoetf')) return 76;
  return 70;
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return text;
}

function shanghaiClock(value) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    today: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}
