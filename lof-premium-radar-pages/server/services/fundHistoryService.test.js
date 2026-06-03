import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateHistoricalPremium, getFundHistory } from './fundHistoryService.js';

const navHtml = `
  <table>
    <tbody>
      <tr>
        <td>2026-06-02</td>
        <td>6.8982</td>
        <td>6.8982</td>
        <td>6.06%</td>
        <td>开放申购</td>
        <td>开放赎回</td>
      </tr>
    </tbody>
  </table>
`;

function response(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

describe('fundHistoryService', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const href = String(url);
      if (href.includes('F10DataApi.aspx')) {
        return response(`var apidata={content:${JSON.stringify(navHtml)}};`);
      }
      if (href.includes('push2his.eastmoney.com')) {
        return response(JSON.stringify({ data: { klines: [] } }));
      }
      if (href.includes('q.stock.sohu.com')) {
        return response('', { ok: false, status: 500 });
      }
      if (href.includes('CN_MarketData.getKLineData')) {
        return response(JSON.stringify([
          {
            day: '2026-06-01',
            open: '6.300',
            high: '6.500',
            low: '6.250',
            close: '6.471',
            volume: '1000000',
          },
          {
            day: '2026-06-02',
            open: '6.471',
            high: '6.799',
            low: '6.471',
            close: '6.745',
            volume: '1269896',
          },
        ]));
      }
      throw new Error(`unexpected fetch ${href}`);
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to Sina historical kline when Eastmoney price history is empty', async () => {
    const history = await getFundHistory('168401', { limit: 20, force: true });

    expect(history.meta).toMatchObject({
      code: '168401',
      navCount: 1,
      priceCount: 2,
      priceSource: 'sina-kline',
      sourceProvider: 'eastmoney,sina',
    });
    expect(history.rows[0]).toMatchObject({
      date: '2026-06-02',
      unitNav: 6.8982,
      closePrice: 6.745,
      openPrice: 6.471,
      highPrice: 6.799,
      lowPrice: 6.471,
      volume: 12698.96,
      priceSource: 'sina-kline',
    });
    expect(history.rows[0].changeRate).toBeCloseTo(4.2343, 4);
    expect(history.rows[0].premiumRate).toBeCloseTo(-2.2209, 4);
  });

  it('falls back to Sohu historical kline with turnover when Eastmoney price history is empty', async () => {
    let sohuAttempts = 0;
    vi.mocked(fetch).mockImplementation(async (url) => {
      const href = String(url);
      if (href.includes('F10DataApi.aspx')) {
        return response(`var apidata={content:${JSON.stringify(navHtml)}};`);
      }
      if (href.includes('push2his.eastmoney.com')) {
        return response(JSON.stringify({ data: { klines: [] } }));
      }
      if (href.includes('q.stock.sohu.com')) {
        sohuAttempts += 1;
        if (sohuAttempts === 1) return response('', { ok: false, status: 503 });
        return response('historySearchHandler([{"status":0,"hq":[["2026-06-02","6.471","6.745","0.274","4.23%","6.471","6.799","12698","856.59","1.02%"]],"code":"cn_168401"}])');
      }
      throw new Error(`unexpected fetch ${href}`);
    });

    const history = await getFundHistory('168401', { limit: 20, force: true });

    expect(history.meta).toMatchObject({
      priceCount: 1,
      priceSource: 'sohu-kline',
      sourceProvider: 'eastmoney,sohu',
    });
    expect(history.rows[0]).toMatchObject({
      date: '2026-06-02',
      closePrice: 6.745,
      changeRate: 4.23,
      volume: 12698,
      turnover: 8_565_900,
      priceSource: 'sohu-kline',
    });
    expect(sohuAttempts).toBe(2);
  });

  it('fills missing Eastmoney historical change rate and turnover from Sohu by date', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => {
      const href = String(url);
      if (href.includes('F10DataApi.aspx')) {
        return response(`var apidata={content:${JSON.stringify(navHtml)}};`);
      }
      if (href.includes('push2his.eastmoney.com')) {
        return response(JSON.stringify({
          data: {
            klines: ['2026-06-02,6.471,6.745,6.799,6.471,12698,,0,,'],
          },
        }));
      }
      if (href.includes('q.stock.sohu.com')) {
        return response('historySearchHandler([{"status":0,"hq":[["2026-06-02","6.471","6.745","0.274","4.23%","6.471","6.799","12698","856.59","1.02%"]],"code":"cn_168401"}])');
      }
      throw new Error(`unexpected fetch ${href}`);
    });

    const history = await getFundHistory('168401', { limit: 20, force: true });

    expect(history.meta).toMatchObject({
      priceCount: 1,
      priceSource: 'eastmoney-kline',
      sourceProvider: 'eastmoney,sohu',
    });
    expect(history.rows[0]).toMatchObject({
      date: '2026-06-02',
      closePrice: 6.745,
      changeRate: 4.23,
      turnover: 8_565_900,
      priceSource: 'eastmoney-kline',
    });
  });

  it('does not calculate historical premium when price and nav scales are incompatible', () => {
    expect(calculateHistoricalPremium({ close: 100, unitNav: 0.2604 })).toBeNull();
    expect(calculateHistoricalPremium({ close: 0.863, unitNav: 0.8635 })).toBeCloseTo(-0.0579, 4);
  });
});
