import { cache, cacheTtl } from './cacheService.js';
import { normalizeCode, toNumber } from './fundNormalizer.js';
import { recordSourceFailure, recordSourceSuccess } from './sourceHealth.js';
import { fetchJisiluQdiiSnapshot } from '../sources/jisiluQdiiProvider.js';
import { fetchLofSnapshot } from '../sources/lofProvider.js';
import { fetchTiantianNav } from '../sources/tiantianSource.js';

const NAV_KEY = 'nav:map';
const TIANTIAN_LIMIT = 100;
let navInFlight = null;

export async function getNavMap(quotes, { force = false } = {}) {
  if (!force) {
    const cached = cache.get(NAV_KEY);
    if (cached) return cached;
  }

  if (navInFlight) return navInFlight;

  navInFlight = fetchFreshNavMap(quotes).finally(() => {
    navInFlight = null;
  });

  return navInFlight;
}

export async function getSingleNav(code) {
  const normalizedCode = normalizeCode(code);
  const cachedMap = cache.get(NAV_KEY) || cache.getStale(NAV_KEY);
  const cached = cachedMap?.get(normalizedCode);
  if (cached?.lastNav || cached?.estimatedNav) return cached;

  const startedAt = Date.now();
  try {
    const row = await fetchTiantianNav(normalizedCode);
    recordSourceSuccess('tiantian', Date.now() - startedAt);
    if (cachedMap) {
      cachedMap.set(normalizedCode, row);
      cache.set(NAV_KEY, cachedMap, cacheTtl.nav);
    }
    return row;
  } catch (error) {
    recordSourceFailure('tiantian', error, Date.now() - startedAt);
    return cached || null;
  }
}

async function fetchFreshNavMap(quotes) {
  const previous = cache.getStale(NAV_KEY);

  const navMap = new Map();
  if (previous) {
    for (const [code, row] of previous.entries()) navMap.set(code, row);
  }

  await Promise.allSettled([loadJisilu(navMap), loadLof(navMap)]);
  await loadTiantian(navMap, selectTiantianCodes(quotes));

  return cache.set(NAV_KEY, navMap, cacheTtl.nav);
}

async function loadJisilu(navMap) {
  const startedAt = Date.now();
  try {
    const snapshot = await fetchJisiluQdiiSnapshot({ section: 'qdii' });
    for (const row of snapshot.rows || []) {
      const code = normalizeCode(row.code);
      if (!code) continue;
      navMap.set(code, {
        code,
        lastNav: toNumber(row.officialEstValue ?? row.officialEst),
        estimatedNav: toNumber(row.realtimeEstValue ?? row.realtimeEst ?? row.referenceEstValue ?? row.referenceEst),
        navDate: row.estDate || '',
        navQuoteTime: row.quoteDate && row.quoteTime ? `${row.quoteDate} ${row.quoteTime}` : '',
        navSource: 'jisilu',
        subscriptionStatus: row.purchaseLimit?.limitText || '',
      });
    }
    recordSourceSuccess('jisilu', Date.now() - startedAt);
  } catch (error) {
    recordSourceFailure('jisilu', error, Date.now() - startedAt);
  }
}

async function loadLof(navMap) {
  const startedAt = Date.now();
  try {
    const snapshot = await fetchLofSnapshot();
    for (const row of snapshot.rows || []) {
      const code = normalizeCode(row.code);
      if (!code) continue;
      const existing = navMap.get(code) || {};
      navMap.set(code, {
        ...existing,
        code,
        lastNav: existing.lastNav ?? toNumber(row.officialEstValue ?? row.officialEst),
        estimatedNav: existing.estimatedNav ?? toNumber(row.realtimeEstValue ?? row.realtimeEst),
        navDate: existing.navDate || row.estDate || '',
        navQuoteTime: existing.navQuoteTime || (row.quoteDate && row.quoteTime ? `${row.quoteDate} ${row.quoteTime}` : ''),
        navSource: existing.navSource || 'lof',
        subscriptionStatus: existing.subscriptionStatus || row.purchaseLimit?.limitText || '',
      });
    }
    recordSourceSuccess('lof', Date.now() - startedAt);
  } catch (error) {
    recordSourceFailure('lof', error, Date.now() - startedAt);
  }
}

async function loadTiantian(navMap, codes) {
  const startedAt = Date.now();
  let success = 0;
  try {
    for (const group of chunk(codes, 8)) {
      const results = await Promise.allSettled(group.map((code) => fetchTiantianNav(code)));
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const row = result.value;
        const existing = navMap.get(row.code) || {};
        navMap.set(row.code, {
          ...existing,
          ...row,
          lastNav: row.lastNav ?? existing.lastNav ?? null,
          estimatedNav: row.estimatedNav ?? existing.estimatedNav ?? null,
          navDate: row.navDate || existing.navDate || '',
          navQuoteTime: row.navQuoteTime || existing.navQuoteTime || '',
          navSource: 'tiantian',
        });
        success += 1;
      }
    }
    if (!success) throw new Error('天天基金未返回有效净值');
    recordSourceSuccess('tiantian', Date.now() - startedAt);
  } catch (error) {
    recordSourceFailure('tiantian', error, Date.now() - startedAt);
  }
}

function selectTiantianCodes(quotes) {
  return quotes
    .filter((row) => row.category === 'QDII' || row.category === 'LOF')
    .sort((left, right) => (right.turnover || 0) - (left.turnover || 0))
    .map((row) => row.code)
    .slice(0, TIANTIAN_LIMIT);
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}
