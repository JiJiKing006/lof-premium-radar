export type AdaptiveColumnType =
  | 'amount'
  | 'code'
  | 'date'
  | 'fund'
  | 'number'
  | 'percent'
  | 'status'
  | 'text';

export type AdaptiveColumnPriority = 'high' | 'medium' | 'low';

export interface AdaptiveColumnConfig<Row = Record<string, unknown>> {
  key: string;
  title: string;
  type: AdaptiveColumnType;
  priority: AdaptiveColumnPriority;
  minWidth: number;
  preferredWidth: number;
  maxWidth: number;
  value?: (row: Row) => unknown;
  nowrap?: boolean;
  ellipsis?: boolean;
  clamp?: number;
}

export interface AdaptiveColumnWidth {
  key: string;
  width: number;
  nowrap?: boolean;
  ellipsis?: boolean;
  clamp?: number;
}

export type AdaptiveColumnWidthMap = Record<string, AdaptiveColumnWidth>;
export type ColumnWidthVars = Record<`--${string}`, string>;

const TYPE_PADDING: Record<AdaptiveColumnType, number> = {
  amount: 18,
  code: 14,
  date: 18,
  fund: 20,
  number: 16,
  percent: 18,
  status: 16,
  text: 18,
};

const PRIORITY_BIAS: Record<AdaptiveColumnPriority, number> = {
  high: 8,
  medium: 0,
  low: -8,
};

export function computeSmartColumnWidths<Row>(
  columns: Array<AdaptiveColumnConfig<Row>>,
  rows: Row[],
): AdaptiveColumnWidthMap {
  return columns.reduce<AdaptiveColumnWidthMap>((acc, column) => {
    const sampleWidths = rows.map((row) => estimateCellWidth(readColumnValue(column, row), column.type));
    sampleWidths.push(estimateCellWidth(column.title, column.type));

    const p80 = percentile(sampleWidths, 80);
    const p90 = percentile(sampleWidths, 90);
    const preferredFloor = column.preferredWidth * (column.priority === 'high' ? 0.92 : 0.82);
    const distributionWidth = Math.max(p80, preferredFloor);
    const cappedDistribution = Math.min(distributionWidth, Math.max(column.preferredWidth, p90));
    const width = clamp(Math.round(cappedDistribution + PRIORITY_BIAS[column.priority]), column.minWidth, column.maxWidth);

    acc[column.key] = {
      key: column.key,
      width,
      nowrap: column.nowrap,
      ellipsis: column.ellipsis,
      clamp: column.clamp,
    };

    return acc;
  }, {});
}

export function createColumnWidthVars(widths: AdaptiveColumnWidthMap): ColumnWidthVars {
  const vars: ColumnWidthVars = {};
  let totalWidth = 0;

  Object.values(widths).forEach((column) => {
    totalWidth += column.width;
    vars[`--col-${toKebabCase(column.key)}-width`] = `${column.width}px`;
  });

  vars['--table-min-width'] = `${totalWidth}px`;
  return vars;
}

export function stabilizeColumnWidths(
  previous: AdaptiveColumnWidthMap,
  next: AdaptiveColumnWidthMap,
  threshold = 6,
): AdaptiveColumnWidthMap {
  return Object.entries(next).reduce<AdaptiveColumnWidthMap>((acc, [key, column]) => {
    const previousColumn = previous[key];
    const width =
      previousColumn && Math.abs(previousColumn.width - column.width) < threshold
        ? previousColumn.width
        : column.width;

    acc[key] = {
      ...column,
      width,
    };

    return acc;
  }, {});
}

export function estimateCellWidth(value: unknown, type: AdaptiveColumnType = 'text'): number {
  const text = formatCellContent(value, type);
  if (!text) return TYPE_PADDING[type] + 32;

  let width = TYPE_PADDING[type];
  for (const char of text) {
    if (/[\u3400-\u9fff]/u.test(char)) {
      width += type === 'fund' ? 13 : 12;
    } else if (/[0-9]/u.test(char)) {
      width += 7;
    } else if (/[.%+\-:]/u.test(char)) {
      width += 5;
    } else if (/\s/u.test(char)) {
      width += 4;
    } else {
      width += 7;
    }
  }

  return width;
}

export function formatCellContent(value: unknown, type: AdaptiveColumnType = 'text'): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);

  if (type === 'amount') {
    const abs = Math.abs(value);
    if (abs >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`;
    if (abs >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
    return value.toFixed(0);
  }

  if (type === 'percent') return `${value.toFixed(2)}%`;
  if (type === 'number') return String(value);
  return String(value);
}

function readColumnValue<Row>(column: AdaptiveColumnConfig<Row>, row: Row): unknown {
  if (column.value) return column.value(row);
  return (row as Record<string, unknown>)[column.key];
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.ceil((p / 100) * sorted.length) - 1, 0, sorted.length - 1);
  return sorted[index];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toKebabCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase();
}
