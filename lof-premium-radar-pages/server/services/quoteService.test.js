import { describe, expect, it } from 'vitest';
import { filterRowsForCategory, sourcePlan } from './quoteService.js';

describe('quoteService', () => {
  it('keeps complete category feeds before broad quote fallbacks', () => {
    expect(sourcePlan('LOF').map((source) => source.name)).toEqual(['palmmicro', 'eastmoney', 'sina', 'akshare']);
    expect(sourcePlan('ETF').map((source) => source.name)).toEqual(['haoetf', 'eastmoney', 'sina', 'akshare']);
    expect(sourcePlan('QDII').map((source) => source.name)).toEqual(['haoetf', 'eastmoney', 'sina', 'akshare']);
  });

  it('filters source rows by requested category before accepting a fallback source', () => {
    const rows = [
      { code: '513100', name: '纳指ETF', category: 'QDII' },
      { code: '588000', name: '科创ETF', category: 'ETF' },
      { code: '160916', name: '优选LOF', category: 'LOF' },
    ];

    expect(filterRowsForCategory(rows, 'LOF').map((row) => row.code)).toEqual(['160916']);
    expect(filterRowsForCategory(rows, 'ALL')).toHaveLength(3);
  });
});
