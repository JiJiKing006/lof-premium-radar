---
name: adaptive-financial-table-designer
description: Use when Codex designs, reviews, fixes, or implements LOF, ETF, QDII, REIT, fund premium/discount, real-time quote, or other financial data tables that need adaptive column widths, stable row heights, readable mobile layouts, Vue3/Vite/TypeScript table components, reusable column-width algorithms, or prevention of fixed-width and longest-content-driven table layouts.
---

# Adaptive Financial Table Designer

Apply this skill as a frontend table-layout specialist for financial data tables. The goal is to keep LOF, ETF, QDII, fund premium/discount, real-time quote, and related fund tables clear, stable, and readable on both desktop and mobile.

## Core Principles

- Base column widths on content distribution, not arbitrary fixed values.
- Do not assign equal widths to every column.
- Do not let the single longest value decide the whole column width.
- Do not widen a table for a few extreme long values.
- Do not compress normal data until it becomes unreadable.
- Prioritize majority content, core fields, mobile readability, and refresh stability.
- Treat `minWidth` and `maxWidth` as safety boundaries, not hard-coded final widths.

## First Inspection

When asked to optimize or fix a table, inspect these issues before editing:

1. Fixed `width` values on columns or cells.
2. `table-layout: fixed` usage.
3. Equal column distribution such as every column using `flex: 1`.
4. Core fields being squeezed.
5. Long text expanding the table.
6. Row-height instability caused by uncontrolled wrapping.
7. Mobile layout problems.
8. Missing shared adaptive column-width logic.

Then present or implement:

1. Current table problems.
2. Adaptive column-width approach.
3. Field priorities.
4. Column-width calculation logic.
5. Concrete code changes.

Do not only patch CSS. Establish or reuse a shared table-column rule.

## Majority-First Width Rule

For each column, estimate the visible width of the current data distribution. Consider:

- Most common content widths.
- Whether long values are rare or common.
- Field priority.
- Screen width.
- Mobile fallback behavior.

Use percentiles:

- `P50`: ordinary content width.
- `P75`: most slightly long content.
- `P80`: recommended base width.
- `P90`: upper reference.
- `P95` or `P99`: anomaly detection only.

Default to `P75` or `P80` as the base width. Use `P90` as a cap reference. Never use the maximum value directly as column width.

If only a few values are much longer, keep the majority-friendly width and handle those values with ellipsis, tooltip, click-to-expand, row detail, or a mobile detail panel.

If most values in a column are long, allocate more space, but still respect `minWidth`, `maxWidth`, priority, and mobile constraints.

## Field Priority

High-priority fields must remain readable:

- Fund name.
- Fund code.
- Real-time price.
- Premium rate.
- Discount rate.
- Latest NAV.
- Update time.
- Trading status.
- Subscription suspension status.

Medium-priority fields can be moderately compressed:

- Change percentage.
- Turnover amount.
- Volume.
- Market.
- Type.
- NAV date.
- Estimated NAV.

Low-priority fields can be collapsed, omitted, or moved into details:

- Data source.
- Notes.
- Tags.
- Long explanations.
- Calculation notes.
- API error messages.
- Non-core status descriptions.

Low-priority fields must yield space to high-priority fields.

## Mobile Rules

For screens below `768px`, do not force the full desktop table into the viewport. Prefer:

- Horizontal scrolling.
- Sticky left core column.
- Card-style list.
- Collapsed row details.
- Important fields first.

On mobile, the first view should make these clear:

- Fund name.
- Fund code.
- Real-time price.
- Premium rate.
- Latest NAV.
- Update time.
- Trading status.

Avoid tiny fonts, arbitrary number wrapping, large row-height differences, and direct compression of a desktop table into a mobile table.

## Row Height Rules

Keep row height stable:

- Numeric fields: no wrapping.
- Percentage fields: no wrapping.
- Date/time fields: at most two lines.
- Fund name: at most two lines.
- Long explanation fields: ellipsis by default; full text in details.

Recommended single-line truncation:

```css
white-space: nowrap;
overflow: hidden;
text-overflow: ellipsis;
```

Recommended two-line clamp:

```css
display: -webkit-box;
-webkit-line-clamp: 2;
-webkit-box-orient: vertical;
overflow: hidden;
```

## Content-Type Rules

Numeric values such as `2.0591`, `10.39%`, `-3.25%`, and `11.35亿`:

- Do not wrap.
- Align right or center.
- Keep compact.
- Show complete values.

Text values such as fund names:

- Allow fund names to use up to two lines.
- Ellipsize long names.
- Show the full name on hover, click, or in mobile details.

Date/time values such as `2026-05-30 19:51:53`:

- Show fully on desktop when practical.
- Split into two lines on mobile when useful:

```text
2026-05-30
19:51:53
```

Status values such as `暂停申购`, `场内交易`, `未公布`, and `暂无数据`:

- Use compact tag styling.
- Do not let status text expand a column.
- Ellipsize or move long status text into details.

## Adaptive Algorithm

Implement one shared column-width calculation method, such as:

```ts
getAdaptiveColumnWidth()
computeSmartColumnWidths()
useAdaptiveTableColumns()
```

Recommended flow:

1. Read the column configuration.
2. Read the current `dataSource`.
3. Estimate each cell's content width by field type.
4. Calculate width distribution for each column.
5. Calculate `P50`, `P75`, `P80`, and `P90`.
6. Use `P75` or `P80` as the base width.
7. Use `P90` as an upper reference.
8. Clamp with `minWidth` and `maxWidth`.
9. Adjust by field `priority`.
10. Handle extreme long values with truncation or expansion.
11. Output final column configs.

Do not force a fixed total table width. Do not scatter column-width logic across pages.

## Column Config Shape

Use or migrate toward column configs that support:

```ts
{
  key: 'premiumRate',
  title: '实时溢价率',
  type: 'percent',
  priority: 'high',
  minWidth: 88,
  preferredWidth: 100,
  maxWidth: 120,
  nowrap: true,
  align: 'right',
  ellipsis: false
}
```

Useful fields:

- `key`: field name.
- `title`: header label.
- `type`: field type.
- `priority`: importance.
- `minWidth`: lower width boundary.
- `preferredWidth`: normal target width.
- `maxWidth`: upper width boundary.
- `nowrap`: whether wrapping is forbidden.
- `align`: cell alignment.
- `ellipsis`: whether to truncate.
- `clamp`: maximum text lines.

## Layout Strategy

Desktop:

- Use normal tables when appropriate.
- Support horizontal scrolling.
- Support sticky first column.
- Support sorting and filtering.

Mobile priority order:

1. Show core fields directly.
2. Put secondary fields in horizontal scroll.
3. Move low-priority fields to collapsed details.
4. Ellipsize long fields.
5. Let users expand rows for full information.

Headers:

- Do not let long header titles expand columns.
- Allow headers to wrap.
- Keep numeric data from wrapping.
- Apply `maxWidth` and priority constraints to headers too.

Sticky columns:

- Prefer fixing only `基金名称`, or `自选` plus `基金名称`.
- Do not fix too many columns, especially on mobile.

## Refresh Stability

Table widths must not jump on every data refresh. Prefer:

- Calculating from recent batches.
- Applying a minimum change threshold.
- Ignoring small width changes.
- Preserving reading stability during real-time updates.

## Defaults

When code is involved, assume:

- Vue 3.
- Vite.
- TypeScript.
- CSS or SCSS.

Prefer shared helpers and components named:

- `useAdaptiveTableColumns`.
- `computeColumnWidth`.
- `getTextWidth`.
- `formatCellContent`.
- `SmartTable`.
- `SmartTableCell`.

The final result should make important data visible at a glance, prevent content compression and row disorder, and reuse the same intelligent column-width rules for future fund tables.
