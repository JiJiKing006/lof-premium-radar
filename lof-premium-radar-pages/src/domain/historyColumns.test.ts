import { describe, expect, it } from 'vitest';
import { HISTORY_COLUMNS } from './historyColumns';

describe('fund history table columns', () => {
  it('keeps the mobile detail history columns in decision-first order', () => {
    expect(HISTORY_COLUMNS.map((column) => column.label)).toEqual([
      '日期',
      '历史溢价率',
      '场内涨幅',
      '开盘价',
      '收盘价',
      '单位净值',
      '净值涨幅',
      '成交量',
      '成交额',
      '最高价',
      '最低价',
    ]);
  });
});
