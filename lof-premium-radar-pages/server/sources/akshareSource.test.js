import { describe, expect, it, vi } from 'vitest';

import { fetchAkshareEstimatedNavs, normalizeAkshareEstimate } from './akshareSource.js';

describe('AKShare-compatible estimated NAV source', () => {
  it('maps the real AKShare upstream fields without Python', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        Data: {
          gxrq: '2026-06-30',
          list: [
            { bzdm: '161631', gsz: '3.4630', gxrq: '2026-06-30' },
            { bzdm: '000001', gsz: '1.0000', gxrq: '2026-06-30' },
          ],
        },
      }),
    });

    const rows = await fetchAkshareEstimatedNavs({
      codes: ['161631'],
      now: new Date('2026-06-30T11:22:33+08:00'),
      fetchImpl,
    });

    expect(rows).toEqual([expect.objectContaining({
      code: '161631',
      estimatedNav: 3.463,
      estimatedNavSource: 'akshare-eastmoney',
      estimatedNavTime: '2026-06-30 11:22:33',
      estimateDate: '2026-06-30',
      upstreamSource: 'eastmoney-fund-guzhi',
    })]);
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/FundGuZhi/GetFundGZList');
    expect(String(fetchImpl.mock.calls[0][0])).toContain('type=8');
  });

  it('rejects a previous-day payload instead of presenting it as today', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ Data: { gxrq: '2026-06-29', list: [] } }),
    });
    await expect(fetchAkshareEstimatedNavs({
      now: new Date('2026-06-30T11:22:33+08:00'),
      fetchImpl,
    })).rejects.toThrow('不是今日数据');
  });

  it('drops missing, non-positive, or mismatched-date estimates', () => {
    const options = {
      requestedCodes: new Set(['161631']),
      estimateDate: '2026-06-30',
      retrievedAt: '2026-06-30 11:22:33',
    };
    expect(normalizeAkshareEstimate({ bzdm: '161631', gsz: '0', gxrq: '2026-06-30' }, options)).toBeNull();
    expect(normalizeAkshareEstimate({ bzdm: '161631', gsz: '3.4', gxrq: '2026-06-29' }, options)).toBeNull();
    expect(normalizeAkshareEstimate({ bzdm: '000001', gsz: '3.4', gxrq: '2026-06-30' }, options)).toBeNull();
  });
});
