# 单人 + AI Codex 开发工作流

这个项目的工作流目标是把零散想法变成可执行任务，并在每次开发后留下记录。

## 核心流程

1. 想到需求：直接在 `docs/todo.md` 对应优先级下面用有序列表写一句话，例如 `1. [待开发] 优化数据来源`。
2. 生成提示：运行 `npm run workflow:prompt`，脚本会自动补项目结构、数据口径和收尾要求。
3. AI 优化：Codex 先把一句话需求扩展成完整开发规格，说明要改哪些模块和为什么。
4. Codex 开发：确认数据口径没有问题后再改代码。
5. 按需测试：普通 UI/文案改动只有你明确要求测试或验证时，Codex 才运行测试命令、接口冒烟或页面检查；基金数据链路改动默认至少执行轻量数据契约检查，除非你明确说不要测试。
6. 更新记录：完成后把 `docs/todo.md` 中对应需求改成 `[已开发]`，并追加 `docs/changelog.md`。
7. 提交上线：再执行 git commit、push、部署。

## 日常命令

```bash
npm run workflow:next
npm run workflow:prompt
npm run workflow:check
npm run workflow:complete -- --title "ETF类型添加纳斯达克科技数据"
npm run workflow:changelog -- --title "ETF类型添加纳斯达克科技数据" --files "server/config/sources.js,components/filter-tabs/filter-tabs.js" --tests "npm run test,npm run check:server" --status "待上线"
```

## 和 Codex 协作的固定说法

```text
请运行 npm run workflow:prompt，读取 docs/todo.md 的下一个未完成任务。
我只在 todo.md 里写了简单需求，你先根据项目结构优化成完整开发提示，再实现。
完成后更新 docs/todo.md 和 docs/changelog.md。只有我明确说测试或验证时，才运行测试命令、接口冒烟或页面检查。
最后更新 docs/todo.md 和 docs/changelog.md。
```

## 基金数据硬规则

- 不伪造、不硬编码、不模拟基金行情、净值、溢价率、成交额、份额。
- 官方净值和估算净值必须分离。
- 官方溢价/折价只能用真实场内价格和官方净值计算。
- 每个金融数据字段必须有来源和秒级更新时间。
- 数据缺失显示 `暂无数据`；官方净值未公布显示 `净值未公布`。
- 源站失败时可以降级，但必须标记 sourceStatus、stale 或错误原因。

## 数据源优先级

默认优先级：

1. 天天基金
2. 东方财富
3. 集思录
4. HaoETF
5. 上交所 / 深交所公开数据
6. Codex 查找并验证的其他真实来源

如果数据不全，先判断缺失字段属于行情、官方净值、估算净值、申购状态、成交额、成交量、份额还是走势。新增来源必须说明 URL、字段映射、更新时间、失败处理和 sourceStatus。

## 测试执行规则

普通 UI/文案改动默认不自动运行测试。只有你明确说“测试”“验证”“跑一下”等类似指令时，再按需求执行下面这些检查。

如果改动涉及基金数据源、字段归一化、筛选、排序、溢价率、净值、行情、缓存、部署接口或 `/api/funds/quotes`，默认至少执行轻量数据契约检查：

- LOF/QDII/ETF 三类 `/api/funds/quotes` 返回合法 JSON。
- 核心字段不丢：代码/名称、现价、官方净值、估算净值、溢价率、source、quoteTime/updateTime。
- 新增基金必须复用 `server/sources/* -> quoteService -> fundAggregator -> utils/fund-api.js -> pages/components` 的原有链路。
- 不允许为了新增数据改掉旧字段含义，例如 `marketPrice/price`、`lastNav/nav`、`estimatedNav/estimatedValue`、`turnover/amount`。
- `/api/funds/quotes` 首页接口普通未缓存请求目标控制在 3 秒内；慢补充数据必须降级并标记，不阻塞首屏。

完整检查清单：

- `npm run test`
- `npm run check:server`
- 微信开发者工具预览或真机预览
- 真实接口冒烟：检查 `/api/funds/quotes`、`/api/funds/hot-arbitrage`、`/api/health/data-sources`
- 页面验证：检查 LOF/QDII/ETF tab、搜索、排序、详情页、移动端横向滚动
- 数据完整性：检查是否出现大面积 `暂无数据` 或 `净值未公布`
- 数据真实性：确认没有 mock、随机数、硬编码行情、旧缓存冒充实时数据

即使不运行测试，开发时仍必须遵守基金数据硬规则，不能伪造或硬编码金融数据。

## 任务字段说明

你可以只写一行 `1. [待开发] 简单需求`。下面这些字段是 Codex 完成需求优化后可以补回来的，不需要你手写：

- 原始想法：最初想到的粗略需求。
- 优化状态：`待AI优化` 或 `已优化`。
- 开发状态：`未开始`、`开发中`、`测试中`、`已完成`。
- 优先级：`P0`、`P1`、`P2`。
- 需求目标：用户能看到或完成什么。
- 数据口径：金融数据从哪里来，不能怎么处理。
- 验收标准：完成后如何判断可交付。

## 推荐演示需求

建议用 `ETF类型添加纳斯达克科技数据` 做第一次演示。它足够具体，能覆盖需求记录、AI 优化、数据源设计、前端筛选和 changelog 更新，但范围又不会大到失控。
