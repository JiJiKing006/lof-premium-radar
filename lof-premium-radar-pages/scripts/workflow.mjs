import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const todoPath = path.join(root, 'docs', 'todo.md');
const changelogPath = path.join(root, 'docs', 'changelog.md');

const priorityRank = new Map([
  ['P0', 0],
  ['P1', 1],
  ['P2', 2],
]);
const completedStatuses = new Set(['已开发', '已完成']);

export function parseTodo(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const tasks = [];
  let section = '';
  let current = null;

  lines.forEach((line, index) => {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      section = heading[1].trim();
      return;
    }

    const orderedTask = line.match(/^\s*\d+\.\s+\[(待开发|开发中|测试中|已开发|已完成)\]\s+(.+?)\s*$/);
    const checkboxTask = line.match(/^-\s+\[([ xX])\]\s+(.+?)\s*$/);
    if (orderedTask || checkboxTask) {
      const status = orderedTask ? orderedTask[1] : (checkboxTask[1].toLowerCase() === 'x' ? '已开发' : '待开发');
      current = {
        title: (orderedTask ? orderedTask[2] : checkboxTask[2]).trim(),
        status,
        done: completedStatuses.has(status),
        section,
        line: index,
        priority: priorityFromSection(section),
        fields: {},
      };
      tasks.push(current);
      return;
    }

    const field = line.match(/^\s+-\s+([^:：]+)[:：]\s*(.+?)\s*$/);
    if (current && field) {
      const key = field[1].trim();
      current.fields[key] = field[2].trim();
      if (key === '优先级') current.priority = current.fields[key];
    }
  });

  return tasks;
}

export function findNextTask(tasks) {
  return [...tasks]
    .filter((task) => !task.done)
    .sort((left, right) => {
      const leftRank = priorityRank.get(left.priority) ?? 99;
      const rightRank = priorityRank.get(right.priority) ?? 99;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.line - right.line;
    })[0] || null;
}

export function buildCodexPrompt(task) {
  if (!task) return 'docs/todo.md 中暂无未完成任务。';

  const fieldLines = Object.entries(task.fields)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join('\n');
  const hasStructuredFields = Object.keys(task.fields).length > 0;

  return [
    '请处理 docs/todo.md 中的下一个未完成任务。',
    '',
    `任务标题：${task.title}`,
    `用户原始需求：${task.fields.原始想法 || task.title}`,
    `优先级：${task.priority || '未标注'}`,
    `分组：${task.section || '未分组'}`,
    '',
    '第一步：需求优化',
    '- 请先根据项目结构把这句需求优化成完整开发规格。',
    '- 输出需求目标、影响范围、数据口径、实现方案、验收标准。',
    '- 如果涉及基金数据源，先追踪现有数据链路，再决定改哪里。',
    '',
    '用户补充字段：',
    fieldLines || '- 用户只输入了一句需求，请按项目上下文补全开发提示。',
    '',
    '项目结构提示：',
    '- server/config/sources.js：数据源配置入口。',
    '- server/services/fundAggregator.js：行情、净值、申购状态、走势、份额聚合。',
    '- server/services/quoteService.js：主行情数据源选择与缓存。',
    '- server/services/navService.js：官方净值和估算净值补充。',
    '- server/sources/*：东方财富、天天基金、集思录、HaoETF、新浪、交易所等来源实现。',
    '- src/api/funds.ts：前端接口归一化。',
    '- src/views/HomeView.vue、src/components/RadarTable.vue、src/components/DetailPanel.vue：移动端展示和交互。',
    '',
    '数据源优先级要求：',
    '- 优先级顺序：天天基金 / 东方财富 -> 集思录 -> HaoETF -> 上交所 / 深交所 -> 继续查找可验证真实来源。',
    '- 如果现有来源字段不全，先确认缺的是行情、官方净值、估算净值、申购状态、成交额、份额还是走势。',
    '- 新增来源必须能说明 URL、字段来源、时间字段、失败处理和 sourceStatus。',
    '- 不要把历史数据、缓存数据或估算净值伪装成实时数据或官方净值。',
    '',
    '项目规则：',
    '- 先阅读 docs/ai-workflow.md 和 docs/todo.md。',
    '- 不要伪造、硬编码或模拟基金行情、净值、溢价率、成交额、份额数据。',
    '- 官方净值和估算净值必须分离；没有真实值时显示 暂无数据 或 净值未公布。',
    '- 每个金融数据字段必须保留来源和秒级更新时间。',
    '- 先给出实现方案，确认没有数据口径问题后再改代码。',
    '',
    '测试执行规则：',
    '- 默认不自动运行 npm run test、npm run typecheck、npm run build 或页面/接口冒烟验证。',
    '- 只有用户明确要求“测试”“验证”“跑一下”时，才执行对应测试或冒烟验证命令。',
    '- 即使不运行测试，开发时仍必须遵守数据真实性规则：不能 mock、随机数、硬编码基金行情、旧缓存冒充实时数据。',
    '- 如果涉及金融数据口径，代码层面仍要保留 source、updateTime、sourceStatus、stale 或错误原因，缺失值显示 暂无数据 或 净值未公布。',
    '- 金融数据验证时，检查是否出现大面积 暂无数据 或 净值未公布。',
    '',
    '收尾要求：',
    '- 完成后更新 docs/todo.md 和 docs/changelog.md。',
    hasStructuredFields
      ? '- 保留用户已有结构化字段；必要时补充优化后的需求说明。'
      : '- 用户只有一句需求时，请在完成后给该任务补充优化后的需求目标、数据口径和验收结果。',
  ].join('\n');
}

export function completeTask(markdown, title) {
  const escapedTitle = escapeRegExp(String(title || '').trim());
  if (!escapedTitle) throw new Error('completeTask requires a task title');
  const orderedPattern = new RegExp(`^(\\s*\\d+\\.\\s+)\\[(待开发|开发中|测试中)\\]\\s+(${escapedTitle})\\s*$`, 'm');
  if (orderedPattern.test(markdown)) return markdown.replace(orderedPattern, '$1[已开发] $3');

  const checkboxPattern = new RegExp(`^- \\[ \\] (${escapedTitle})\\s*$`, 'm');
  if (checkboxPattern.test(markdown)) return markdown.replace(checkboxPattern, '- [x] $1');

  throw new Error(`未找到未完成任务：${title}`);
}

export function appendChangelogEntry(markdown, entry) {
  const date = entry.date || shanghaiDate();
  const block = [
    `## ${date}`,
    '',
    `- 功能：${entry.title}`,
    `- 修改文件：${listText(entry.files)}`,
    `- 测试结果：${listText(entry.tests)}`,
    `- 上线状态：${entry.status || '未上线'}`,
    '',
  ].join('\n');

  const input = String(markdown || '# 变更记录\n\n');
  const heading = `## ${date}`;
  if (input.includes(heading)) {
    return input.replace(`${heading}\n`, `${heading}\n\n${block.split('\n').slice(2).join('\n')}`);
  }
  return input.trimEnd() + '\n\n' + block;
}

export function validateTodo(markdown) {
  const tasks = parseTodo(markdown);
  const errors = [];

  tasks.forEach((task) => {
    if (!task.title) errors.push(`第 ${task.line + 1} 行任务标题为空`);
    if (!task.priority) errors.push(`${task.title} 未放入 P0/P1/P2 分组`);
  });

  return { ok: errors.length === 0, errors, tasks };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === 'help') {
    printHelp();
    return;
  }

  if (command === 'next') {
    const task = findNextTask(parseTodo(await readFile(todoPath, 'utf8')));
    console.log(task ? `${task.priority} [${task.status || '待开发'}] ${task.title}` : '暂无未完成任务');
    return;
  }

  if (command === 'prompt') {
    const task = findNextTask(parseTodo(await readFile(todoPath, 'utf8')));
    console.log(buildCodexPrompt(task));
    return;
  }

  if (command === 'check') {
    const result = validateTodo(await readFile(todoPath, 'utf8'));
    if (!result.ok) {
      console.error(result.errors.join('\n'));
      process.exitCode = 1;
      return;
    }
    console.log(`todo.md 校验通过：${result.tasks.length} 个任务`);
    return;
  }

  if (command === 'complete') {
    const title = readArg(args, '--title');
    const markdown = await readFile(todoPath, 'utf8');
    await writeFile(todoPath, completeTask(markdown, title));
    console.log(`已标记完成：${title}`);
    return;
  }

  if (command === 'changelog') {
    const title = readArg(args, '--title');
    const files = splitArg(readArg(args, '--files', ''));
    const tests = splitArg(readArg(args, '--tests', ''));
    const status = readArg(args, '--status', '未上线');
    const markdown = await readFile(changelogPath, 'utf8').catch(() => '# 变更记录\n\n');
    await writeFile(changelogPath, appendChangelogEntry(markdown, { title, files, tests, status }));
    console.log(`已追加变更记录：${title}`);
    return;
  }

  throw new Error(`未知命令：${command}`);
}

function priorityFromSection(section) {
  return String(section || '').match(/P[0-2]/)?.[0] || '';
}

function listText(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ') || '未记录';
  return value || '未记录';
}

function readArg(args, name, fallback = '') {
  const index = args.indexOf(name);
  if (index === -1) {
    if (fallback !== '') return fallback;
    throw new Error(`缺少参数：${name}`);
  }
  return args[index + 1] || fallback;
}

function splitArg(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function shanghaiDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function printHelp() {
  console.log(`基金套利项目工作流

用法：
  node scripts/workflow.mjs next
  node scripts/workflow.mjs prompt
  node scripts/workflow.mjs check
  node scripts/workflow.mjs complete --title "任务标题"
  node scripts/workflow.mjs changelog --title "任务标题" --files "a,b" --tests "npm run test" --status "待上线"
`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
