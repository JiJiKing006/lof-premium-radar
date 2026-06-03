# 变更记录

## 2026-06-03

- 功能：优化 LOF 条目名单和 QDII 黄金类基金过滤
- 修改文件：server/services/quoteService.js, server/services/quoteService.test.js, docs/todo.md
- 测试结果：npx vitest run server/services/quoteService.test.js, 真实 LOF/QDII 数据冒烟, npm run workflow:check, npm test, npm run typecheck, npm run build
- 上线状态：未上线

- 功能：新增用户访问埋点和后台管理系统
- 修改文件：server/index.js, server/services/visitorAnalytics.js, server/services/visitorAnalytics.test.js, src/App.vue, src/api/analytics.ts, src/views/HomeView.vue, src/views/AdminView.vue, src/styles/app.css, scripts/deploy.sh, scripts/deploy.test.mjs, docs/todo.md
- 测试结果：npx vitest run server/services/visitorAnalytics.test.js, npx vitest run server/services/visitorAnalytics.test.js scripts/deploy.test.mjs, npm run typecheck, npm test, npm run build, 本地 API 冒烟, /admin 页面登录冒烟
- 上线状态：未上线

## 2026-06-02

- 功能：建立单人 + AI Codex 开发工作流
- 修改文件：docs/ai-workflow.md, docs/todo.md, docs/changelog.md, scripts/workflow.mjs, scripts/workflow.test.mjs, package.json
- 测试结果：npx vitest run scripts/workflow.test.mjs, npm run workflow:check, npm run test, npm run typecheck, npm run build
- 上线状态：未上线

- 功能：优化 todo 简单需求输入工作流
- 修改文件：docs/ai-workflow.md, docs/todo.md, docs/changelog.md, scripts/workflow.mjs, scripts/workflow.test.mjs
- 测试结果：npx vitest run scripts/workflow.test.mjs, npm run workflow:check, npm run workflow:next, npm run workflow:prompt, npm run test, npm run typecheck, npm run build
- 上线状态：未上线

- 功能：新增纳斯达克科技数据来源优先级与真实数据补全
- 修改文件：server/services/quoteService.js, server/services/navService.js, server/services/premiumService.js, server/services/quoteService.test.js, server/services/navService.test.js, server/services/premiumService.test.js, docs/todo.md
- 测试结果：npx vitest run scripts/workflow.test.mjs server/services/quoteService.test.js server/services/navService.test.js server/services/premiumService.test.js server/services/hotArbitrageService.test.js, npm run workflow:check, npm run workflow:next, npm run test, npm run typecheck, npm run build, 真实 QDII 数据烟测 15 条纳指/标普科技记录关键字段缺失 0
- 上线状态：未上线

- 功能：todo 改为有序列表和已开发状态格式
- 修改文件：docs/todo.md, docs/ai-workflow.md, scripts/workflow.mjs, scripts/workflow.test.mjs
- 测试结果：npx vitest run scripts/workflow.test.mjs, npm run workflow:check, npm run workflow:next, npm run test, npm run typecheck, npm run build
- 上线状态：未上线

- 功能：修复详情页从首页滚动状态进入后返回按钮隐藏
- 修改文件：src/views/HomeView.vue, src/views/HomeViewScroll.test.js
- 测试结果：用户已取消默认自动测试要求；未继续运行测试命令
- 上线状态：未上线

- 功能：调整基金数据源优先级并过滤溢价率为空的基金条目
- 修改文件：server/services/quoteService.js, server/services/fundAggregator.js, server/services/quoteService.test.js, server/services/fundAggregator.test.js, docs/todo.md
- 测试结果：用户已取消默认自动测试要求；未运行测试命令
- 上线状态：未上线

- 功能：取消每个需求完成后默认自动测试的工作流规则
- 修改文件：docs/ai-workflow.md, scripts/workflow.mjs, scripts/workflow.test.mjs
- 测试结果：按用户要求未运行测试命令
- 上线状态：未上线

- 功能：首页剔除实时溢价率显示为暂无数据的基金
- 修改文件：src/composables/useFilters.ts, src/composables/useFilters.test.ts
- 测试结果：按用户要求未运行测试命令
- 上线状态：未上线

- 功能：基金列表按代码去重并按 LOF、QDII、ETF 优先级展示
- 修改文件：server/services/fundAggregator.js, server/services/fundAggregator.test.js
- 测试结果：按用户要求未运行测试命令
- 上线状态：未上线
