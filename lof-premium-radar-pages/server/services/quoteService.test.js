import { describe, expect, it } from 'vitest';
import { sourcePlan } from './quoteService.js';

describe('quoteService', () => {
  it('keeps market-data fallbacks for ETF and QDII when HaoETF is unavailable', () => {
    expect(sourcePlan('LOF').map((source) => source.name)).toEqual(['palmmicro', 'eastmoney', 'sina', 'akshare']);
    expect(sourcePlan('ETF').map((source) => source.name)).toEqual(['haoetf', 'eastmoney', 'sina', 'akshare']);
    expect(sourcePlan('QDII').map((source) => source.name)).toEqual(['haoetf', 'eastmoney', 'sina', 'akshare']);
  });
});
