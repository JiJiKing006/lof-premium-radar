---
name: lof-etf-data-guardian
description: Enforce strict financial data authenticity, source attribution, timestamp precision, fallback-source design, and premium/discount calculation rules for LOF, ETF, QDII, REITs, and exchange-traded fund dashboards or APIs. Use when Codex builds, reviews, fixes, or designs fund data features, Vue/Vite fund dashboards, real-time premium-rate logic, financial data APIs, source fallback mechanisms, or data quality validation for Chinese exchange-traded funds.
---

# LOF ETF Data Guardian

Use this skill as a hard data-quality gate for LOF, ETF, QDII, REITs, and exchange-traded fund systems.

Core priority:

```text
truthfulness > timeliness > completeness > page appearance
```

Do not improve UI, animations, ranking, or presentation at the cost of data authenticity.

## Non-Negotiable Rules

Never create, display, or commit:

- simulated financial data
- fake data
- random generated data
- demo data presented as real data
- hardcoded market price, NAV, premium rate, turnover, or volume
- manually inferred NAV
- manually inferred premium or discount rate
- historical data presented as real-time data
- estimated NAV presented as official NAV
- previous-day NAV presented as latest NAV

If a real value cannot be fetched or verified, display exactly:

```text
暂无数据
```

For official NAV that has not been published, display exactly:

```text
净值未公布
```

Do not display `0`, `--`, `N/A`, placeholder values, random numbers, or estimated substitutes for missing financial values.

## Required Data Contract

Every API response row for a fund must include these canonical fields, even when the value is unavailable:

```json
{
  "fundCode": "",
  "fundName": "",
  "price": "",
  "nav": "",
  "premiumRate": "",
  "market": "",
  "fundType": "",
  "source": "",
  "updateTime": ""
}
```

Do not omit `source` or `updateTime`.

Prefer also supporting:

- `changeRate`
- `navDate`
- `discountRate`
- `iopv`
- `turnover`
- `volume`
- `dataStatus`
- `sourceStatus`
- `fallbackLevel`

All update times must be precise to seconds:

```text
2026-05-29 15:36:25
```

Do not use fuzzy labels such as `刚刚更新`, `1分钟前`, `实时`, or `最新`.

## Source Requirements

Every displayed financial number must have a traceable source and timestamp.

Preferred source order:

1. 东方财富
2. 天天基金
3. 新浪财经
4. 集思录
5. 交易所公开数据

Implement source fallback as automatic, server-side degradation:

- Try the primary source first.
- If it fails, times out, returns empty data, or misses required fields, switch to the next source.
- Keep the service available while marking the row/source status.
- Do not silently mix stale cached data into real-time fields unless it is labeled as stale and not presented as current.

## Premium And Discount Rules

Use only real official NAV for official premium/discount calculations:

```text
premiumRate = (realTimePrice - latestOfficialNav) / latestOfficialNav * 100%
discountRate = -premiumRate when premiumRate is negative
```

Rules:

- Use `price` from a real market quote source.
- Use `nav` only from official published NAV data.
- Check `navDate` and display it.
- Never replace official NAV with estimated NAV.
- Never calculate official premium from estimated NAV.
- If official NAV is unavailable, set official premium/discount to `暂无数据`.

Estimated NAV may be displayed only as a separate field such as `estimatedNav`.

For QDII funds, always distinguish:

- latest official NAV
- official NAV publication date
- estimated NAV, if provided by a source

If official QDII NAV has not been published, display `净值未公布`; do not substitute estimated NAV.

## Data Validation Gate

Before writing or finalizing financial feature code, verify:

1. Each financial value comes from a real source.
2. Each row includes source and update time precise to seconds.
3. Official NAV and estimated NAV are separate fields.
4. Premium/discount uses only official NAV.
5. Missing values render as `暂无数据` or `净值未公布`.
6. Fallback logic exists and records which source was used.
7. Stale cache is labeled and never presented as current data.
8. Tests cover source failure, missing NAV, stale timestamps, and premium calculation.

If any item fails, fix data integrity before improving UI.

## Frontend Guidance

Build mobile-first for iPhone, Android, and WeChat WebView.

First-screen priority:

1. fund code
2. fund name
3. real-time price
4. premium/discount rate
5. official NAV
6. update time
7. data source

Recommended table fields:

- fund code
- fund name
- market
- fund type
- real-time price
- change rate
- latest official NAV
- NAV date
- premium/discount rate
- turnover
- update time
- source

Support search, sorting, and filtering.

Use tabs for `LOF`, `ETF`, and `QDII`. Add filters for `沪市`, `深市`, and `全部`.

Avoid prioritizing decorative animations, complex visual effects, or promotional UI over data quality.

## Development Workflow

When modifying fund-data code:

1. Trace the data path from external source to API response to UI display.
2. Identify all financial fields and their source/timestamp.
3. Remove any hardcoded, inferred, simulated, or placeholder financial value.
4. Add or update validation tests before changing behavior.
5. Implement fallback source handling and status reporting.
6. Verify API payloads contain `source` and `updateTime`.
7. Verify UI renders missing data as `暂无数据` or `净值未公布`.
8. Run tests, type checks, and a real data smoke test when network access is available.

When reviewing code, lead with data-integrity findings: fake data, stale data, missing source, missing timestamp, NAV substitution, premium formula errors, and fallback gaps.
