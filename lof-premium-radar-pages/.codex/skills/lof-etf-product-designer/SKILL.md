---
name: lof-etf-product-designer
description: Mobile-first financial product design guidance for LOF, ETF, QDII, REITs, and exchange-traded fund premium/discount tools. Use when Codex designs, reviews, or modifies pages, Vue/Vite components, mobile layouts, WeChat WebView or mini-program migration plans, card lists, search/filter flows, fund detail pages, loading states, or UI hierarchy for fund premium dashboards.
---

# LOF ETF Product Designer

Use this skill when designing or changing the product experience for a LOF / ETF / QDII / exchange-traded fund premium tool.

Core priority:

```text
mobile first > WeChat mini-program ready > desktop enhancement
```

The product must help a normal user quickly answer:

- Is this fund trading at a premium or discount?
- How large is the premium or discount?
- When was the data updated?
- Is it worth opening the details?

## Product Positioning

Treat the product as a mobile financial tool, not an admin dashboard, marketing site, or compressed PC table.

Reference the interaction density and tone of:

- Xueqiu
- Tencent Portfolio / 自选股
- Alipay Fund
- Tiantian Fund
- Eastmoney App

Do not make the first screen decorative. Within 3 seconds, users must see core fund data.

## Page Structure

Prefer this home page structure:

1. top search bar
2. LOF / ETF / QDII tabs
3. market filter: 全部 / 沪市 / 深市
4. premium/discount ranking
5. unusual movement alerts
6. fund card list
7. data update/source note

Mobile pages should prefer:

- card lists
- light grouping
- collapsible details
- horizontal scroll only as a secondary aid

Do not make a wide table the primary mobile interaction.

## First-Screen Fund Card

Every fund card must show:

- fund name
- fund code
- current price
- change rate
- latest NAV
- premium/discount rate
- update time

Make the premium/discount rate visually dominant.

Visual hierarchy:

1. premium/discount rate
2. real-time price
3. fund name
4. latest NAV
5. change rate
6. update time
7. data source

## Mobile UI Rules

Optimize first for 375px, 390px, 414px, and 430px widths.

Use font sizes in these ranges:

- primary numbers: 24px-32px
- premium/discount rate: 20px-28px
- fund name: 16px-18px
- body text: 14px-16px
- helper text: 12px-13px

Do not use tiny text or dense unscannable rows.

Use financial colors consistently:

- rising / premium: red
- falling / discount: green
- neutral: gray
- background: clean light surface
- cards: white or weak gray

Avoid large gradients, excessive accent colors, and decorative palettes that reduce data readability.

## Card Design

Fund cards should include:

- clear title
- main number area
- premium/discount label
- update time
- secondary data in a compact or collapsible area

Cards should have:

- rounded corners
- subtle shadow or border
- enough whitespace
- aligned numbers
- obvious tap area

The full card can open details or expand more data.

## Interaction Rules

Design for one-handed use.

- Tap targets must be at least 44px.
- Frequent actions belong in thumb-friendly areas.
- Search, filters, and tab switching must feel direct.
- Avoid deep navigation for core data.
- Avoid requiring multiple taps before users see premium, price, NAV, or update time.

Allowed motion:

- skeleton loading
- tab transition
- number-change feedback
- pull-to-refresh
- lightweight tap feedback

Forbidden motion:

- showpiece animation
- large decorative motion
- performance-heavy animation
- animation unrelated to data comprehension

## WeChat Mini-Program Readiness

Design so the page can migrate to WeChat mini-programs.

Require:

- mini-program-friendly page structure
- portable bottom tab patterns
- portable search box
- portable card list
- pull-to-refresh compatibility
- safe-area support
- notch support
- home indicator spacing
- dark-mode extensibility

Avoid PC hover dependencies.

## Filters And Search

Primary category tabs:

- LOF
- ETF
- QDII

Market filters:

- 全部
- 沪市
- 深市

Sort options:

- premium high to low
- discount low to high
- turnover high to low
- change rate high to low

Do not overload users with too many filters.

Search must be obvious and support:

- fund code
- fund name
- pinyin initials when available

No-result states must be friendly and actionable.

## Detail Page

Recommended detail content:

- fund name
- fund code
- current price
- latest NAV
- premium/discount rate
- NAV date
- turnover
- volume
- historical premium trend
- data source
- update time

Do not fill the detail page with unrelated information.

## Empty And Loading States

When no data exists, display:

```text
暂无数据
```

Also explain the reason when known:

- 数据源暂不可用
- 当前基金未公布净值
- 当前筛选条件无结果

Use:

- skeleton screens
- loading states
- error messages
- retry buttons

Do not leave a blank page.

Do not show fake, random, or zero-filled data.

## Output Workflow

When asked to design or modify a page, provide these before or along with code:

1. page structure recommendation
2. mobile interaction plan
3. UI hierarchy explanation
4. component split recommendation
5. executable code-change plan

Do not only provide code.

Do not only change CSS.

Explain why the design improves mobile financial usability.

## Default Technical Direction

Use Vue3, Vite, TypeScript, Pinia, and CSS/SCSS unless the project already uses a different local pattern.

Prefer small mobile-friendly components over heavy UI frameworks.

Before finishing, verify at mobile widths and check that important text does not overlap or shrink below usable size.

## Hard Stops

Do not:

- turn the page into an admin system
- compress a PC table into mobile
- use tiny fonts
- overload cards with dense data
- add complex filters upfront
- abuse animation
- abuse gradients
- hide core financial data
- sacrifice readability for decoration
