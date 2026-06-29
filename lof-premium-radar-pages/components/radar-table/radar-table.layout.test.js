import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(import.meta.dirname, '../..');

describe('首页表格滚动与页面刷新', () => {
  it('首页表格只允许纵向滚动且表头独立于滚动容器', () => {
    const template = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.wxml'), 'utf8');
    const styles = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.wxss'), 'utf8');

    expect(template).not.toContain('scroll-x');
    expect(template).toContain('scroll-y');
    expect(template).toContain('bindscroll="handleTableScroll"');
    expect(template).not.toContain('table-scroll-hint');
    expect(template.indexOf('class="thead"')).toBeLessThan(template.indexOf('<scroll-view'));
    expect(styles).not.toMatch(/\.thead\s*\{[\s\S]*?position:\s*sticky;/);
  });

  it('首页关闭页面手势刷新并使用数据区刷新按钮', () => {
    const pageConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, 'pages/index/index.json'), 'utf8'));
    const pageScript = fs.readFileSync(path.join(projectRoot, 'pages/index/index.js'), 'utf8');
    const pageTemplate = fs.readFileSync(path.join(projectRoot, 'pages/index/index.wxml'), 'utf8');

    const tableTemplate = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.wxml'), 'utf8');
    const tableStyles = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.wxss'), 'utf8');
    expect(pageConfig.enablePullDownRefresh).toBe(false);
    expect(pageConfig.disableScroll).not.toBe(true);
    expect(pageScript).not.toContain('onPullDownRefresh()');
    expect(pageTemplate).toContain('bind:refresh="handleManualRefresh"');
    expect(tableTemplate).toContain('/images/icons/refresh-cycle.svg');
    expect(tableTemplate).toContain("refreshing ? 'spinning' : ''");
    expect(tableStyles).toContain('@keyframes refresh-spin');
    expect(pageTemplate).not.toContain('bindtouchmove="handlePageTouchMove"');
  });

  it('单屏展示四个数据字段加自选列且不展示涨跌幅', () => {
    const styles = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.wxss'), 'utf8');
    const script = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.js'), 'utf8');
    const template = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.wxml'), 'utf8');

    expect(script).toContain("buildColumn('turnover', '成交额')");
    expect(script).toContain("buildColumn('favorite', '自选'");
    expect(script).not.toContain("buildColumn('changeRate'");
    expect(script).not.toContain("buildColumn('lastNav'");
    expect(script).not.toContain("buildColumn('estimatedNav'");
    expect(template).toContain('item.display.turnover');
    expect(template).not.toContain('item.display.changeRate');
    expect(template).toContain('cycle-{{item.settlementState}}');
    expect(styles).not.toContain('position: sticky;\n  left: 0');
  });

  it('排序、提醒铃铛和弹窗关闭均使用本地图标', () => {
    const tableTemplate = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.wxml'), 'utf8');
    const pageTemplate = fs.readFileSync(path.join(projectRoot, 'pages/index/index.wxml'), 'utf8');

    expect(tableTemplate).toContain('src="/images/icons/sort.svg"');
    expect(tableTemplate).not.toContain("'↑'");
    expect(tableTemplate).not.toContain("'↓'");
    expect(pageTemplate).toContain("'/images/icons/bell.svg'");
    expect(pageTemplate).toContain('src="/images/icons/close.svg"');
    expect(fs.existsSync(path.join(projectRoot, 'images/icons/sort.svg'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'images/icons/bell.svg'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'images/icons/close.svg'))).toBe(true);
  });

  it('排序只保留一个活动列并按默认、倒序和顺序使用不同颜色资源', () => {
    const tableTemplate = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.wxml'), 'utf8');
    const pageScript = fs.readFileSync(path.join(projectRoot, 'pages/index/index.js'), 'utf8');

    expect(tableTemplate).toContain('activeSortKey === item.key');
    expect(tableTemplate).toContain('/images/icons/sort-desc.svg');
    expect(tableTemplate).toContain('/images/icons/sort-asc.svg');
    expect(pageScript).toContain("currentMode === 'default' ? 'desc' : currentMode === 'desc' ? 'asc' : 'default'");
    expect(pageScript).not.toContain('sortStates');
    expect(pageScript).toContain("activeSortKey: 'premiumRate'");
  });

  it('表头点击不使用按压动画且滚动时不逐帧回写位置', () => {
    const tableTemplate = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.wxml'), 'utf8');
    const tableScript = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.js'), 'utf8');
    const tableStyles = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.wxss'), 'utf8');

    expect(tableTemplate).toContain('class="head-button" hover-class="none"');
    expect(tableStyles).not.toContain('head-button-pressed');
    expect(tableTemplate).not.toContain('scroll-top="{{tableScrollTop}}"');
    expect(tableScript).not.toContain('patch.tableScrollTop');
    expect(tableTemplate).toContain('scroll-into-view="{{scrollIntoView}}"');
  });

  it('切换首页 Tab 时清空搜索词', () => {
    const pageScript = fs.readFileSync(path.join(projectRoot, 'pages/index/index.js'), 'utf8');
    const sectionHandler = pageScript.slice(
      pageScript.indexOf('handleSectionChange(event)'),
      pageScript.indexOf('showAllFunds()'),
    );

    expect(sectionHandler).toContain("this.setData({ query: '' })");
    expect(sectionHandler.indexOf('this.rememberCurrentSectionState()')).toBeLessThan(sectionHandler.indexOf("this.setData({ query: '' })"));
    expect(pageScript).toContain("if (String(state.query || '').trim()) return false");
    expect(pageScript).toMatch(/restoreSectionState\(section\)[\s\S]*?query:\s*''/);
    expect(sectionHandler).toContain('this.refreshFavoriteCodes()');
    expect(sectionHandler).toContain('this.fetchSectionSnapshot({ section, force: true })');
  });

  it('搜索允许真实空结果且不会回退显示整表缓存', () => {
    const pageScript = fs.readFileSync(path.join(projectRoot, 'pages/index/index.js'), 'utf8');

    expect(pageScript).toContain("Boolean(String(this.data.query || '').trim())");
    expect(pageScript).toContain('!fetchedSnapshot.rows.length && !allowsEmptyResult');
    expect(pageScript).toContain('query: this.data.query');
  });

  it('表格点击、自选、Tab 和返回顶部均提供动效', () => {
    const tableTemplate = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.wxml'), 'utf8');
    const tableStyles = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.wxss'), 'utf8');
    const pageTemplate = fs.readFileSync(path.join(projectRoot, 'pages/index/index.wxml'), 'utf8');
    const pageStyles = fs.readFileSync(path.join(projectRoot, 'pages/index/index.wxss'), 'utf8');

    expect(tableTemplate).toContain('scroll-with-animation');
    expect(tableTemplate).toContain('hover-class="data-row-pressed"');
    expect(tableTemplate).toContain('hover-class="watch-button-pressed"');
    expect(tableTemplate).toContain('hover-class="back-top-pressed"');
    expect(pageTemplate).toContain('hover-class="action-button-pressed"');
    expect(tableStyles).toContain('@keyframes watch-burst');
    expect(pageStyles).toContain('@keyframes tab-select-pop');
  });

  it('首页默认展示全部数据并将更新时间规范到秒', () => {
    const pageScript = fs.readFileSync(path.join(projectRoot, 'pages/index/index.js'), 'utf8');

    expect(pageScript).toContain("const DEFAULT_SECTION = 'ALL'");
    expect(pageScript).toContain("const DEFAULT_MARKET_FILTER = 'ALL'");
    expect(pageScript).toContain('formatUpdateTime(meta.updateTime || meta.latestQuoteTime || \'\')');
    expect(pageScript).toContain("settlementCycle: settlementCycle(fund)");
  });

  it('提醒弹窗发起一次性订阅并在控制台输出真实 Top1 预览', () => {
    const pageTemplate = fs.readFileSync(path.join(projectRoot, 'pages/index/index.wxml'), 'utf8');
    const pageScript = fs.readFileSync(path.join(projectRoot, 'pages/index/index.js'), 'utf8');

    expect(pageTemplate).toContain('开启每日机会提醒');
    expect(pageTemplate).toContain('立即提醒');
    expect(pageTemplate).toContain('TOP1');
    expect(pageTemplate).not.toContain('TOP3');
    expect(pageScript).toContain("const SUBSCRIBE_TEMPLATE_ID = 'nChCRD1ljtNdWE20NSZIogo5tYX5sX4xP4UPEdZVLyM'");
    expect(pageScript).toContain('wx.requestSubscribeMessage({');
    expect(pageScript).toContain('tmplIds: [templateId]');
    expect(pageScript).toContain("status !== 'accept'");
    expect(pageScript).toContain("console.log('[订阅消息模板内容]'");
    expect(pageScript).toContain("excludePausedPurchase: true");
    expect(pageScript).toContain("sortKey: 'premiumRate'");
    expect(pageScript).toContain("sortDirection: 'desc'");
    expect(pageScript).toContain("state === 'paused'");
    expect(pageScript).toContain("state === 'exchange'");
    expect(pageScript).toContain("const SUBSCRIBE_NOTE = '仅供参考，不做投资建议'");
    expect(pageScript).toContain('await registerSubscription({ testMode: isDevelopmentMiniProgram() })');
    expect(fs.readFileSync(path.join(projectRoot, 'utils/subscription.js'), 'utf8')).toContain("postJson('/api/subscriptions/register'");
  });

  it('全项目使用统一自定义 loading，并关闭请求层原生 loading toast', () => {
    const requestScript = fs.readFileSync(path.join(projectRoot, 'utils/request.js'), 'utf8');
    const pageScript = fs.readFileSync(path.join(projectRoot, 'pages/index/index.js'), 'utf8');
    const pageTemplate = fs.readFileSync(path.join(projectRoot, 'pages/index/index.wxml'), 'utf8');
    const loadingTemplate = fs.readFileSync(path.join(projectRoot, 'components/app-loading/app-loading.wxml'), 'utf8');
    const loadingStyles = fs.readFileSync(path.join(projectRoot, 'components/app-loading/app-loading.wxss'), 'utf8');
    const pageConfigs = ['index', 'detail', 'watch'].map((page) => JSON.parse(
      fs.readFileSync(path.join(projectRoot, `pages/${page}/${page}.json`), 'utf8')
    ));

    expect(requestScript).not.toContain('wx.showToast');
    expect(requestScript).not.toContain("icon: 'loading'");
    expect(requestScript).not.toContain('beginRequestToast');
    expect(pageScript).toContain('showLoading: false');
    expect(pageTemplate).toContain('<app-loading');
    expect(pageTemplate).toContain("operationLoading ? loadingTitle : '加载行情中'");
    expect(pageScript).toContain("this.showOperationLoading('刷新数据中'");
    expect(pageScript).toContain("this.showOperationLoading('添加提醒中'");
    expect(pageScript).toContain("this.showOperationLoading('取消提醒中'");
    expect(loadingTemplate).toContain('/images/icons/refresh-cycle.svg');
    expect(loadingTemplate).toContain('{{title}}');
    expect(loadingStyles).toContain('.app-loading-mask');
    expect(loadingStyles).toContain('z-index: 200');
    pageConfigs.forEach((config) => {
      expect(config.usingComponents['app-loading']).toBe('/components/app-loading/app-loading');
    });
  });

  it('用户进入首页默认按溢价率倒序展示', () => {
    const pageScript = fs.readFileSync(path.join(projectRoot, 'pages/index/index.js'), 'utf8');
    const tableScript = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.js'), 'utf8');

    expect(pageScript).toContain("sortKey: 'premiumRate'");
    expect(pageScript).toContain("sortDirection: 'desc'");
    expect(pageScript).toContain("activeSortKey: 'premiumRate'");
    expect(pageScript).toContain("sortMode: 'desc'");
    expect(tableScript).toContain("sortKey: { type: String, value: 'premiumRate' }");
    expect(tableScript).toContain("sortDirection: { type: String, value: 'desc' }");
  });

  it('手动刷新先回到表格顶部并从第一页重新加载', () => {
    const pageScript = fs.readFileSync(path.join(projectRoot, 'pages/index/index.js'), 'utf8');
    const handler = pageScript.slice(
      pageScript.indexOf('async handleManualRefresh()'),
      pageScript.indexOf('handleSearchChange(event)'),
    );

    expect(handler).toContain('this.visiblePage = 1');
    expect(handler).toContain('this.resetTableScroll()');
    expect(handler.indexOf('this.resetTableScroll()')).toBeLessThan(handler.indexOf('await this.fetchSectionSnapshot'));
  });

  it('首页全部点击入口统一使用 2 秒防重复守卫', () => {
    const pageScript = fs.readFileSync(path.join(projectRoot, 'pages/index/index.js'), 'utf8');
    const tableScript = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.js'), 'utf8');
    const guardScript = fs.readFileSync(path.join(projectRoot, 'utils/action-guard.js'), 'utf8');

    expect(guardScript).toContain('const DEFAULT_GUARD_MS = 2000');
    expect(pageScript).toContain("allowAction(this, 'manual-refresh')");
    expect(pageScript).toContain('allowAction(this, `section:${section}`)');
    expect(pageScript).toContain("allowAction(this, 'exclude-paused')");
    expect(pageScript).toContain('allowAction(this, `favorite:${fund.code}`)');
    expect(tableScript).toContain("allowAction(this, 'refresh')");
    expect(tableScript).toContain('allowAction(this, `sort:${key}`)');
    expect(tableScript).toContain('allowAction(this, `select:${fund.code}`)');
    expect(tableScript).toContain("allowAction(this, 'back-top')");
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
    expect(pageScript).toContain('timeoutMs: 5000');
  });

  it('触底分页使用三重触发并固定第一页服务端快照', () => {
    const pageScript = fs.readFileSync(path.join(projectRoot, 'pages/index/index.js'), 'utf8');
    const tableScript = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.js'), 'utf8');
    const tableTemplate = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.wxml'), 'utf8');
    const tableStyles = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.wxss'), 'utf8');
    const apiScript = fs.readFileSync(path.join(projectRoot, 'utils/fund-api.js'), 'utf8');

    expect(tableTemplate).toContain('bindscrolltolower="handleLoadMore"');
    expect(tableTemplate).toContain('lower-threshold="240"');
    expect(tableScript).toContain('scrollHeight - scrollTop - this.tableViewportHeight < 240');
    expect(tableScript).toContain("event.type === 'tap' && !allowAction(this, 'load-more')");
    expect(tableScript).toContain("observe('.load-more-sentinel'");
    expect(tableStyles).toContain('height: 48rpx');
    expect(pageScript).toContain('for (let attempt = 0; attempt < 2; attempt += 1)');
    expect(pageScript).toContain('pagination.snapshotId');
    expect(pageScript).toContain('pagination.snapshotReset');
    expect(pageScript).toContain('ensurePaginationSnapshot');
    expect(pageScript).toContain('expectedSnapshotId');
    expect(pageScript).toContain('currentSnapshotId !== expectedSnapshotId');
    expect(apiScript).toContain('params.snapshotId = String(options.snapshotId)');
  });

  it('首页整表刷新和分页追加使用不同接口', () => {
    const api = fs.readFileSync(path.join(projectRoot, 'utils/fund-api.js'), 'utf8');
    const pageScript = fs.readFileSync(path.join(projectRoot, 'pages/index/index.js'), 'utf8');

    expect(api).toContain("'/api/funds/quotes/refresh'");
    expect(api).toContain("'/api/funds/quotes/page'");
    expect(api).toContain('postJson(endpoint, params');
    expect(pageScript).toContain("requestMode: 'refresh'");
    expect(pageScript).toContain("requestMode: 'page'");
  });

  it('刷新或分页失败后停止自动重试链路', () => {
    const pageScript = fs.readFileSync(path.join(projectRoot, 'pages/index/index.js'), 'utf8');
    const tableScript = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.js'), 'utf8');
    const manualRefresh = pageScript.slice(
      pageScript.indexOf('async handleManualRefresh()'),
      pageScript.indexOf('handleSearchChange(event)'),
    );
    const recoveryStart = pageScript.indexOf('  schedulePurchaseStatusRecovery(funds) {');
    const recovery = pageScript.slice(
      recoveryStart,
      pageScript.indexOf('  clearPurchaseStatusRecoveryTimer() {', recoveryStart),
    );
    const loadingMoreObserver = tableScript.slice(
      tableScript.indexOf('loadingMore(value)'),
      tableScript.indexOf('\n  },\n\n  lifetimes:'),
    );

    expect(pageScript).toContain('const PURCHASE_STATUS_RECOVERY_MAX_ATTEMPTS = 1');
    expect(pageScript).toContain('skipRecovery: true');
    expect(manualRefresh).not.toContain('schedulePostRefreshSnapshot');
    expect(manualRefresh).toContain('skipRecovery: true');
    expect(pageScript).not.toContain('schedulePostRefreshSnapshot()');
    expect(recovery).toContain('this.purchaseStatusRecoveryAttempts >= PURCHASE_STATUS_RECOVERY_MAX_ATTEMPTS');
    expect(loadingMoreObserver).not.toContain('queueLoadMoreObserver()');
    expect(tableScript).toMatch(/requestLoadMore\(\)\s*\{[\s\S]*?this\.loadMoreObserver\.disconnect\(\)/);
  });

  it('首页表格使用 flex 占满筛选区下方的剩余高度', () => {
    const pageStyles = fs.readFileSync(path.join(projectRoot, 'pages/index/index.wxss'), 'utf8');
    const tableStyles = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.wxss'), 'utf8');

    expect(pageStyles).toMatch(/\.home-table-frame\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex:\s*1 1 auto;/);
    expect(pageStyles).toMatch(/radar-table\s*\{[\s\S]*?flex:\s*1 1 0;/);
    expect(tableStyles).toMatch(/\.table-scroll\s*\{[\s\S]*?flex:\s*1 1 0;[\s\S]*?height:\s*0;/);
  });

  it('申购状态完整显示且分页提供轻量文字入口', () => {
    const styles = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.wxss'), 'utf8');
    const template = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.wxml'), 'utf8');
    const script = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.js'), 'utf8');

    const pillRule = styles.slice(styles.indexOf('.limit-pill'), styles.indexOf('.limit-open'));
    expect(pillRule).toContain('max-width: none');
    expect(pillRule).toContain('overflow: visible');
    expect(pillRule).not.toContain('text-overflow: ellipsis');
    expect(template).not.toContain('class="load-more-button"');
    expect(template).toContain('class="load-more-text"');
    expect(template).toContain('bindtap="handleLoadMore"');
    expect(template).toContain('class="load-more-sentinel"');
    expect(script).toContain('createIntersectionObserver');
  });

  it('隐藏溢价率说明、更新时间刷新图标并保持圆形返回顶部按钮', () => {
    const styles = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.wxss'), 'utf8');
    const template = fs.readFileSync(path.join(projectRoot, 'components/radar-table/radar-table.wxml'), 'utf8');

    expect(template).not.toContain('item.premiumNote');
    expect(template).not.toContain('refresh-glyph');
    expect(styles).toMatch(/\.table-back-top-button\s*\{[\s\S]*?width:\s*66rpx;[\s\S]*?height:\s*66rpx;[\s\S]*?border-radius:\s*50%;/);
  });

  it('首页始终渲染隐藏暂停申购与提醒入口', () => {
    const pageTemplate = fs.readFileSync(path.join(projectRoot, 'pages/index/index.wxml'), 'utf8');
    const pageStyles = fs.readFileSync(path.join(projectRoot, 'pages/index/index.wxss'), 'utf8');

    expect(pageTemplate).toContain('隐藏暂停申购');
    expect(pageTemplate).toContain('添加提醒');
    expect(pageTemplate).toContain('已添加提醒');
    expect(pageTemplate).toContain('/images/icons/bell-off.svg');
    expect(pageTemplate).toContain('取消每日提醒？');
    expect(pageTemplate).not.toContain('监控');
    expect(pageStyles).toMatch(/\.home-actions\s*\{[\s\S]*?display:\s*flex;/);
  });

  it('搜索、排序和暂停申购过滤共用快照交互接口', () => {
    const pageScript = fs.readFileSync(path.join(projectRoot, 'pages/index/index.js'), 'utf8');

    expect(pageScript).toContain('fetchInteractiveSnapshot()');
    expect(pageScript).toMatch(/fetchInteractiveSnapshot\(\)\s*\{[\s\S]*?requestMode:\s*'page'/);
  });
});
