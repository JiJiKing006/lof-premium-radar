import { describe, expect, it } from 'vitest';
import { computeSmartColumnWidths, createColumnWidthVars, stabilizeColumnWidths } from './adaptiveTableColumns';

describe('adaptive financial table columns', () => {
  const rows = [
    { code: '160216', name: '国泰商品', premiumRate: 1.23, price: 1.023, turnover: 5800000 },
    { code: '161116', name: '易方达黄金', premiumRate: -0.82, price: 0.997, turnover: 24000000 },
    { code: '162411', name: '华宝油气', premiumRate: 3.18, price: 0.681, turnover: 120000000 },
    { code: '501018', name: '南方原油', premiumRate: 2.43, price: 1.218, turnover: 87000000 },
    { code: '513100', name: '纳指ETF', premiumRate: 0.91, price: 1.543, turnover: 310000000 },
    { code: '513500', name: '标普500ETF', premiumRate: -1.32, price: 2.059, turnover: 96000000 },
    { code: '159941', name: '纳斯达克ETF', premiumRate: 4.6, price: 1.418, turnover: 156000000 },
    { code: '164824', name: '印度基金LOF', premiumRate: 6.74, price: 1.132, turnover: 45000000 },
    { code: '161125', name: '标普500LOF', premiumRate: -2.11, price: 1.909, turnover: 65000000 },
    {
      code: '999999',
      name: '这是一条异常长的基金名称用于验证不能撑爆整列宽度',
      premiumRate: 12.34,
      price: 9.876,
      turnover: 999999999,
    },
  ];

  it('uses majority content rather than the longest outlier for text columns', () => {
    const widths = computeSmartColumnWidths(
      [
        {
          key: 'security',
          title: '基金',
          type: 'fund',
          priority: 'high',
          minWidth: 112,
          preferredWidth: 132,
          maxWidth: 190,
          value: (row) => `${row.name} ${row.code}`,
          clamp: 2,
        },
      ],
      rows,
    );

    expect(widths.security.width).toBeGreaterThanOrEqual(112);
    expect(widths.security.width).toBeLessThan(170);
    expect(widths.security.clamp).toBe(2);
  });

  it('keeps numeric and percent columns compact and non-wrapping', () => {
    const widths = computeSmartColumnWidths(
      [
        {
          key: 'premiumRate',
          title: '实时溢价率',
          type: 'percent',
          priority: 'high',
          minWidth: 88,
          preferredWidth: 100,
          maxWidth: 124,
          value: (row) => `${row.premiumRate.toFixed(2)}%`,
          nowrap: true,
        },
        {
          key: 'turnover',
          title: '成交额',
          type: 'amount',
          priority: 'medium',
          minWidth: 72,
          preferredWidth: 86,
          maxWidth: 108,
          value: (row) => row.turnover,
          nowrap: true,
        },
      ],
      rows,
    );

    expect(widths.premiumRate.width).toBeGreaterThanOrEqual(88);
    expect(widths.premiumRate.width).toBeLessThanOrEqual(124);
    expect(widths.premiumRate.nowrap).toBe(true);
    expect(widths.turnover.width).toBeGreaterThanOrEqual(72);
    expect(widths.turnover.width).toBeLessThanOrEqual(108);
    expect(widths.turnover.nowrap).toBe(true);
  });

  it('exports stable CSS width variables including total table width', () => {
    const vars = createColumnWidthVars({
      favorite: { key: 'favorite', width: 36, nowrap: true },
      security: { key: 'security', width: 128, clamp: 2 },
      premiumRate: { key: 'premiumRate', width: 96, nowrap: true },
    });

    expect(vars['--col-favorite-width']).toBe('36px');
    expect(vars['--col-security-width']).toBe('128px');
    expect(vars['--col-premium-rate-width']).toBe('96px');
    expect(vars['--table-min-width']).toBe('260px');
  });

  it('keeps previous widths when refresh changes are below the stability threshold', () => {
    const stable = stabilizeColumnWidths(
      {
        premiumRate: { key: 'premiumRate', width: 104, nowrap: true },
        turnover: { key: 'turnover', width: 90, nowrap: true },
      },
      {
        premiumRate: { key: 'premiumRate', width: 108, nowrap: true },
        turnover: { key: 'turnover', width: 102, nowrap: true },
      },
      6,
    );

    expect(stable.premiumRate.width).toBe(104);
    expect(stable.turnover.width).toBe(102);
  });

  it('supports compact fund table columns without squeezing numeric values', () => {
    const widths = computeSmartColumnWidths(
      [
        {
          key: 'price',
          title: '现价',
          type: 'number',
          priority: 'high',
          minWidth: 56,
          preferredWidth: 64,
          maxWidth: 72,
          value: (row) => row.price,
          nowrap: true,
        },
        {
          key: 'premiumRate',
          title: '实时溢价率',
          type: 'percent',
          priority: 'high',
          minWidth: 78,
          preferredWidth: 90,
          maxWidth: 104,
          value: (row) => row.premiumRate,
          nowrap: true,
        },
      ],
      rows,
    );

    expect(widths.price.width).toBeGreaterThanOrEqual(56);
    expect(widths.price.width).toBeLessThanOrEqual(72);
    expect(widths.price.nowrap).toBe(true);
    expect(widths.premiumRate.width).toBeGreaterThanOrEqual(78);
    expect(widths.premiumRate.width).toBeLessThanOrEqual(104);
    expect(widths.premiumRate.nowrap).toBe(true);
  });
});
