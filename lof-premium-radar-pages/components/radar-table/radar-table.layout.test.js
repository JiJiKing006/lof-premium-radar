import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(import.meta.dirname, '../..');

describe('首页表格滚动与页面刷新', () => {
  it('表头和表体共用一个双向滚动容器', () => {
    const template = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.wxml'), 'utf8');
    const horizontalScrollViews = template.match(/<scroll-view[\s\S]*?scroll-x[\s\S]*?>/g) || [];

    expect(horizontalScrollViews).toHaveLength(1);
    expect(template).not.toContain('table-head-scroll');
    expect(template).not.toContain('class="table-body-scroll"');
    expect(template).toContain('scroll-y');
    expect(template).toContain('bindscroll="handleTableScroll"');
  });

  it('首页使用小程序原生下拉刷新且不保留自定义触摸刷新', () => {
    const pageConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, 'pages/index/index.json'), 'utf8'));
    const pageScript = fs.readFileSync(path.join(projectRoot, 'pages/index/index.js'), 'utf8');
    const pageTemplate = fs.readFileSync(path.join(projectRoot, 'pages/index/index.wxml'), 'utf8');

    expect(pageConfig.enablePullDownRefresh).toBe(true);
    expect(pageConfig.disableScroll).not.toBe(true);
    expect(pageScript).toContain('onPullDownRefresh()');
    expect(pageScript).toContain('stopPullDownRefreshSafely()');
    expect(pageTemplate).not.toContain('bindtouchmove="handlePageTouchMove"');
  });

  it('用原生 sticky 冻结自选列，不通过滚动事件逐帧追位', () => {
    const styles = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.wxss'), 'utf8');
    const script = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.js'), 'utf8');
    const template = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.wxml'), 'utf8');

    expect(styles).toMatch(/\.frozen-favorite-column\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?left:\s*0;/);
    expect(script).not.toContain('frozenColumnStyle');
    expect(template).not.toContain('frozenColumnStyle');
    expect(template.match(/frozen-favorite-column/g)).toHaveLength(3);
  });

  it('用户主动刷新请求期间显示带遮罩的 loading', () => {
    const pageScript = fs.readFileSync(path.join(projectRoot, 'pages/index/index.js'), 'utf8');

    expect(pageScript).toContain("showLoadingSafely('加载数据中')");
    expect(pageScript).toContain('wx.showLoading({ title, mask: true })');
    expect(pageScript).toContain('hideLoadingSafely()');
  });

  it('分页追加不弹出全局 loading，并使用独立超时窗口', () => {
    const pageScript = fs.readFileSync(path.join(projectRoot, 'pages/index/index.js'), 'utf8');
    const loadMoreHandler = pageScript.slice(
      pageScript.indexOf('handleLoadMoreFunds()'),
      pageScript.indexOf('async fetchNextFundsPage()'),
    );

    expect(loadMoreHandler).not.toContain('showLoadingSafely');
    expect(loadMoreHandler).not.toContain('hideLoadingSafely');
    expect(pageScript).toContain("requestMode: 'page'");
    expect(pageScript).toContain('timeoutMs: 3000');
  });

  it('首页整表刷新和分页追加使用不同接口', () => {
    const api = fs.readFileSync(path.join(projectRoot, 'utils/fund-api.js'), 'utf8');
    const pageScript = fs.readFileSync(path.join(projectRoot, 'pages/index/index.js'), 'utf8');

    expect(api).toContain("'/api/funds/quotes/refresh'");
    expect(api).toContain("'/api/funds/quotes/page'");
    expect(pageScript).toContain("requestMode: 'refresh'");
    expect(pageScript).toContain("requestMode: 'page'");
  });

  it('首页表格使用 flex 占满筛选区下方的剩余高度', () => {
    const pageStyles = fs.readFileSync(path.join(projectRoot, 'pages/index/index.wxss'), 'utf8');
    const tableStyles = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.wxss'), 'utf8');

    expect(pageStyles).toMatch(/\.home-table-frame\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex:\s*1 1 auto;/);
    expect(pageStyles).toMatch(/radar-table\s*\{[\s\S]*?flex:\s*1 1 0;/);
    expect(tableStyles).toMatch(/\.table-scroll\s*\{[\s\S]*?flex:\s*1 1 0;[\s\S]*?height:\s*0;/);
  });

  it('申购状态完整显示且分页提供可点击入口', () => {
    const styles = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.wxss'), 'utf8');
    const template = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.wxml'), 'utf8');
    const script = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.js'), 'utf8');

    const pillRule = styles.slice(styles.indexOf('.limit-pill'), styles.indexOf('.limit-open'));
    expect(pillRule).toContain('max-width: none');
    expect(pillRule).toContain('overflow: visible');
    expect(pillRule).not.toContain('text-overflow: ellipsis');
    expect(template).toContain('class="load-more-button"');
    expect(template).toContain('bindtap="handleLoadMore"');
    expect(template).toContain('class="load-more-sentinel"');
    expect(template).toContain("loading=\"{{loadingMore}}\"");
    expect(script).toContain('createIntersectionObserver');
  });

  it('搜索、排序和暂停申购过滤共用快照交互接口', () => {
    const pageScript = fs.readFileSync(path.join(projectRoot, 'pages/index/index.js'), 'utf8');

    expect(pageScript).toContain('fetchInteractiveSnapshot()');
    expect(pageScript).toMatch(/fetchInteractiveSnapshot\(\)\s*\{[\s\S]*?requestMode:\s*'page'/);
  });
});
