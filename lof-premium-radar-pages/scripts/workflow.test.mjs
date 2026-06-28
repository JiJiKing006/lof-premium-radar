import { describe, expect, it } from 'vitest';
import {
  appendChangelogEntry,
  buildCodexPrompt,
  completeTask,
  findNextTask,
  parseTodo,
  validateTodo,
} from './workflow.mjs';

const sampleTodo = `# 待开发需求清单

## P0（立即开发）

- [ ] 首页新增场内份额字段
  - 原始想法：首页表格增加“场内份额”
  - 优化状态：待AI优化
  - 开发状态：未开始
  - 优先级：P0

- [x] 修复更新时间展示
  - 原始想法：时间不清晰
  - 优化状态：已优化
  - 开发状态：已完成
  - 优先级：P0

## P1（后续开发）

- [ ] ETF类型添加纳斯达克科技数据
  - 原始想法：ETF里面想看到纳斯达克科技相关基金
  - 优化状态：已优化
  - 开发状态：未开始
  - 优先级：P1
  - 验收标准：ETF tab 可筛选出纳斯达克科技相关真实数据
`;

const simpleTodo = `# 待开发需求清单

## P0（立即开发）

- [ ] 优化纳斯达克科技数据来源，天天基金和东方财富优先，其次集思录、HaoETF、上交所和深交所，数据不全时继续找真实来源
`;

const orderedTodo = `# 待开发需求清单

## P0（立即开发）

1. [已开发] 建立工作流自动化
2. [待开发] 优化纳斯达克科技数据来源
3. [开发中] 首页增加热门套利榜入口
`;

describe('workflow automation', () => {
  it('parses grouped tasks from todo markdown', () => {
    const tasks = parseTodo(sampleTodo);

    expect(tasks).toHaveLength(3);
    expect(tasks[0]).toMatchObject({
      title: '首页新增场内份额字段',
      done: false,
      priority: 'P0',
      section: 'P0（立即开发）',
      fields: {
        原始想法: '首页表格增加“场内份额”',
        优化状态: '待AI优化',
        开发状态: '未开始',
        优先级: 'P0',
      },
    });
  });

  it('selects the first unfinished task by priority order', () => {
    const next = findNextTask(parseTodo(sampleTodo));

    expect(next?.title).toBe('首页新增场内份额字段');
    expect(next?.priority).toBe('P0');
  });

  it('builds a Codex handoff prompt with data-integrity rules', () => {
    const next = findNextTask(parseTodo(sampleTodo));
    const prompt = buildCodexPrompt(next);

    expect(prompt).toContain('请处理 docs/todo.md 中的下一个未完成任务');
    expect(prompt).toContain('首页新增场内份额字段');
    expect(prompt).toContain('不要伪造、硬编码或模拟基金行情、净值、溢价率、成交额、份额数据');
    expect(prompt).toContain('完成后更新 docs/todo.md 和 docs/changelog.md');
  });

  it('accepts one-line user demands in todo markdown', () => {
    const result = validateTodo(simpleTodo);

    expect(result.ok).toBe(true);
    expect(result.tasks[0]).toMatchObject({
      title: '优化纳斯达克科技数据来源，天天基金和东方财富优先，其次集思录、HaoETF、上交所和深交所，数据不全时继续找真实来源',
      priority: 'P0',
      fields: {},
    });
  });

  it('parses ordered status tasks and skips developed tasks', () => {
    const tasks = parseTodo(orderedTodo);
    const next = findNextTask(tasks);

    expect(tasks).toHaveLength(3);
    expect(tasks[0]).toMatchObject({
      title: '建立工作流自动化',
      status: '已开发',
      done: true,
    });
    expect(next?.title).toBe('优化纳斯达克科技数据来源');
  });

  it('expands a one-line demand into a project-aware Codex prompt', () => {
    const prompt = buildCodexPrompt(findNextTask(parseTodo(simpleTodo)));

    expect(prompt).toContain('用户原始需求：优化纳斯达克科技数据来源');
    expect(prompt).toContain('请先根据项目结构把这句需求优化成完整开发规格');
    expect(prompt).toContain('server/config/sources.js');
    expect(prompt).toContain('server/services/fundAggregator.js');
    expect(prompt).toContain('优先级顺序：天天基金 / 东方财富 -> 集思录 -> HaoETF -> 上交所 / 深交所 -> 继续查找可验证真实来源');
    expect(prompt).toContain('默认不自动运行 npm run test、npm run check:server、微信开发者工具预览或接口冒烟验证');
    expect(prompt).toContain('只有用户明确要求“测试”“验证”“跑一下”时');
    expect(prompt).toContain('检查是否出现大面积 暂无数据 或 净值未公布');
  });

  it('marks a task complete without changing other tasks', () => {
    const updated = completeTask(sampleTodo, '首页新增场内份额字段');

    expect(updated).toContain('- [x] 首页新增场内份额字段');
    expect(updated).toContain('- [ ] ETF类型添加纳斯达克科技数据');
  });

  it('marks ordered status tasks as developed', () => {
    const updated = completeTask(orderedTodo, '优化纳斯达克科技数据来源');

    expect(updated).toContain('2. [已开发] 优化纳斯达克科技数据来源');
    expect(updated).toContain('3. [开发中] 首页增加热门套利榜入口');
  });

  it('appends a changelog entry under the current date', () => {
    const changelog = '# 变更记录\n\n';
    const updated = appendChangelogEntry(changelog, {
      date: '2026-06-02',
      title: '首页新增场内份额字段',
      files: ['pages/index/index.js', 'components/radar-table/radar-table.js'],
      tests: ['npm run test'],
      status: '待上线',
    });

    expect(updated).toContain('## 2026-06-02');
    expect(updated).toContain('- 功能：首页新增场内份额字段');
    expect(updated).toContain('- 修改文件：pages/index/index.js, components/radar-table/radar-table.js');
    expect(updated).toContain('- 测试结果：npm run test');
    expect(updated).toContain('- 上线状态：待上线');
  });
});
