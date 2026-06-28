import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(import.meta.dirname, '../..');

describe('详情页加载与来源审计', () => {
  it('详情数据返回前展示占位骨架屏', () => {
    const template = fs.readFileSync(path.join(projectRoot, 'pages/detail/detail.wxml'), 'utf8');
    const styles = fs.readFileSync(path.join(projectRoot, 'pages/detail/detail.wxss'), 'utf8');

    expect(template).toContain('detailLoading && !current');
    expect(template).toContain('detail-skeleton-hero');
    expect(template).toContain('detail-skeleton-section');
    expect(styles).toContain('@keyframes detail-skeleton-shimmer');
  });

  it('来源审计每项明确分为来源和时间两行', () => {
    const template = fs.readFileSync(path.join(projectRoot, 'pages/detail/detail.wxml'), 'utf8');
    const styles = fs.readFileSync(path.join(projectRoot, 'pages/detail/detail.wxss'), 'utf8');

    expect(template).toContain('class="audit-content"');
    expect(template).toContain('class="audit-source"');
    expect(template).toContain('class="audit-time"');
    expect(styles).toContain('grid-template-rows: repeat(2, minmax(0, auto))');
  });

  it('详情请求不在 1.5 秒主动中断', () => {
    const api = fs.readFileSync(path.join(projectRoot, 'utils/fund-api.js'), 'utf8');

    expect(api).toContain('timeoutMs: 60000');
    expect(api).not.toContain('详情加载超过 1.5 秒');
  });

  it('使用简洁的详情字段和公式标题', () => {
    const script = fs.readFileSync(path.join(projectRoot, 'pages/detail/detail.js'), 'utf8');
    const template = fs.readFileSync(path.join(projectRoot, 'pages/detail/detail.wxml'), 'utf8');

    expect(script).toContain("{ label: '代码', value: fund.code }");
    expect(script).toContain("{ label: '名称', value: fund.name }");
    expect(script).not.toContain("label: '基金代码'");
    expect(script).not.toContain("label: '基金名称'");
    expect(template).toContain('>计算公式</text>');
  });
});
