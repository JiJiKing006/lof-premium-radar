import { describe, expect, it } from 'vitest';
import { parseSinaQuoteResponse } from './sinaSupplementSource.js';

describe('sinaSupplementSource', () => {
  it('parses direct Sina exchange quotes by code', () => {
    const text = 'var hq_str_sh501312="海外科技LOF,2.420,2.449,2.419,2.437,2.412,2.419,2.420,87741918,212587107.000,72611,2.419,466582,2.418,207200,2.417,584120,2.416,520700,2.415,36204,2.420,20117,2.421,319049,2.422,131597,2.423,358719,2.424,2026-06-03,11:30:00,00,";';

    const [row] = parseSinaQuoteResponse(text);

    expect(row).toMatchObject({
      code: '501312',
      name: '海外科技LOF',
      marketPrice: 2.419,
      volume: 87741918,
      turnover: 212587107,
      quoteTime: '2026-06-03 11:30:00',
      source: 'sina',
    });
    expect(row.changeRate).toBeCloseTo(-1.2249897917517384, 8);
  });
});
