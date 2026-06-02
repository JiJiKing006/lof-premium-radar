import type { FundHistoryRow } from '../types/fund';

export type HistoryColumnKey =
  | 'date'
  | 'premiumRate'
  | 'changeRate'
  | 'openPrice'
  | 'closePrice'
  | 'unitNav'
  | 'navGrowthRate'
  | 'volume'
  | 'turnover'
  | 'highPrice'
  | 'lowPrice';

export interface HistoryColumn {
  key: HistoryColumnKey;
  label: string;
  value: keyof FundHistoryRow;
  kind: 'amount' | 'date' | 'number' | 'percent';
}

export const HISTORY_COLUMNS: HistoryColumn[] = [
  { key: 'date', label: '日期', value: 'date', kind: 'date' },
  { key: 'premiumRate', label: '历史溢价率', value: 'premiumRate', kind: 'percent' },
  { key: 'changeRate', label: '场内涨幅', value: 'changeRate', kind: 'percent' },
  { key: 'openPrice', label: '开盘价', value: 'openPrice', kind: 'number' },
  { key: 'closePrice', label: '收盘价', value: 'closePrice', kind: 'number' },
  { key: 'unitNav', label: '单位净值', value: 'unitNav', kind: 'number' },
  { key: 'navGrowthRate', label: '净值涨幅', value: 'navGrowthRate', kind: 'percent' },
  { key: 'volume', label: '成交量', value: 'volume', kind: 'amount' },
  { key: 'turnover', label: '成交额', value: 'turnover', kind: 'amount' },
  { key: 'highPrice', label: '最高价', value: 'highPrice', kind: 'number' },
  { key: 'lowPrice', label: '最低价', value: 'lowPrice', kind: 'number' },
];
