import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cache } from '../services/cacheService.js';
import { fetchSinaFundScale, parseSinaFundScalePage } from './sinaFundScaleSource.js';

beforeEach(() => {
  cache.items.clear();
  cache.lastValid.clear();
  cache.lastObserved.clear();
  vi.restoreAllMocks();
});

describe('sinaFundScaleSource', () => {
  it('parses the latest fund scale and its explicit cutoff date', () => {
    const row = parseSinaFundScalePage(`
      <th>截止日期:<span class="date">2026/6/26</span></th>
      <th>最新规模:<span class="scale">8.63亿元</span></th>
    `, { code: '501225', fetchedAt: '2026-07-01 01:20:30' });

    expect(row).toEqual({
      code: '501225',
      fundScale: 863_000_000,
      fundScaleSource: 'sina',
      fundScaleDate: '2026-06-26',
      fundScaleTime: '2026-07-01 01:20:30',
      fundScaleStatus: 'fresh',
      fundScaleStale: false,
    });
  });

  it('rejects missing values instead of inventing a scale', () => {
    expect(parseSinaFundScalePage('<span class="scale">--</span>', { code: '501225' })).toBeNull();
  });

  it('keeps a traceable stale value when Sina temporarily fails', async () => {
    const cached = parseSinaFundScalePage(`
      截止日期:<span class="date">2026/6/26</span>
      最新规模:<span class="scale">8.63亿元</span>
    `, { code: '501225', fetchedAt: '2026-07-01 01:20:30' });
    cache.set('sina:fund-scale:501225', cached, 0);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));

    await expect(fetchSinaFundScale('501225', { force: true })).resolves.toMatchObject({
      fundScale: 863_000_000,
      fundScaleSource: 'sina',
      fundScaleStatus: 'stale',
      fundScaleStale: true,
    });
  });
});
