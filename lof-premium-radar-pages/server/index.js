import express from 'express';
import dns from 'node:dns';
import { getDataSourceHealth } from './services/sourceHealth.js';
import { formatFundQuoteResponse, getFundDetail, getFundList, getFundQuotePage, getFundQuotes, hydratePersistentFundSnapshots, startFundSnapshotScheduler } from './services/fundAggregator.js';
import { getFundHistory } from './services/fundHistoryService.js';
import { getHotArbitrageList } from './services/hotArbitrageService.js';
import { fetchMarketIndices } from './sources/marketIndexSource.js';
import { isAdminPasswordValid, visitorAnalytics } from './services/visitorAnalytics.js';
import { warmQuoteCaches } from './services/quoteService.js';
import { createWechatSubscriptionService, startWechatSubscriptionScheduler } from './services/wechatSubscriptionService.js';

const port = Number(process.env.PORT || 4173);

dns.setDefaultResultOrder('ipv4first');

const app = express();
const apiRouter = express.Router();
const wechatSubscriptionService = createWechatSubscriptionService();

hydratePersistentFundSnapshots();

app.use(express.json());

apiRouter.get('/funds', async (request, response) => {
  try {
    const snapshot = await getFundList({
      category: String(request.query.category || ''),
      force: request.query.force === '1',
    });
    response.setHeader('Cache-Control', 'no-store');
    response.json(snapshot);
  } catch (error) {
    response.status(503).json({
      meta: { status: error.message || '行情服务不可用', stale: true },
      rows: [],
    });
  }
});

apiRouter.get('/funds/quotes', handleFundQuotes);
apiRouter.post('/funds/quotes', handleFundQuotes);

async function handleFundQuotes(request, response) {
  const input = quoteRequestInput(request);
  try {
    const snapshot = await getFundQuotes({
      category: String(input.category || ''),
      force: isTrueFlag(input.force),
      includeTrends: includeTrends(input),
      waitForFresh: false,
    });
    response.setHeader('Cache-Control', 'no-store');
    response.json(formatFundQuoteResponse(snapshot, quoteResponseOptions(input)));
  } catch (error) {
    response.status(503).json({
      meta: { status: error.message || '行情服务不可用', stale: true },
      rows: [],
    });
  }
}

apiRouter.get('/funds/quotes/refresh', handleFundQuotesRefresh);
apiRouter.post('/funds/quotes/refresh', handleFundQuotesRefresh);

async function handleFundQuotesRefresh(request, response) {
  const input = quoteRequestInput(request);
  try {
    const snapshot = await getFundQuotes({
      category: String(input.category || ''),
      force: true,
      waitForFresh: false,
      includeTrends: includeTrends(input),
    });
    response.setHeader('Cache-Control', 'no-store');
    response.json(formatFundQuoteResponse(snapshot, quoteResponseOptions(input)));
  } catch (error) {
    response.status(503).json({
      meta: { status: error.message || '首页数据刷新失败', stale: true },
      rows: [],
    });
  }
}

apiRouter.get('/funds/quotes/page', handleFundQuotesPage);
apiRouter.post('/funds/quotes/page', handleFundQuotesPage);

async function handleFundQuotesPage(request, response) {
  const input = quoteRequestInput(request);
  try {
    const pageOptions = {
      category: String(input.category || ''),
      includeTrends: includeTrends(input),
      snapshotId: String(input.snapshotId || ''),
    };
    let snapshot;
    let resetPagination = false;
    try {
      if (Number(input.page || 1) > 1 && !pageOptions.snapshotId) {
        const error = new Error('分页缺少首页快照，请从第一页继续');
        error.code = 'PAGE_SNAPSHOT_NOT_READY';
        throw error;
      }
      snapshot = getFundQuotePage(pageOptions);
    } catch (error) {
      if (!['PAGE_SNAPSHOT_NOT_READY', 'PAGE_SNAPSHOT_EXPIRED'].includes(error.code)) throw error;
      snapshot = await getFundQuotes({
        category: pageOptions.category,
        includeTrends: pageOptions.includeTrends,
      });
      resetPagination = true;
    }
    response.setHeader('Cache-Control', 'no-store');
    response.json(formatFundQuoteResponse(snapshot, {
      ...quoteResponseOptions(input),
      ...(resetPagination ? { page: 1, snapshotReset: true } : {}),
    }));
  } catch (error) {
    response.status(503).json({
      meta: { status: error.message || '分页数据不可用', stale: true },
      rows: [],
    });
  }
}

apiRouter.get('/funds/hot-arbitrage', async (request, response) => {
  try {
    const snapshot = await getHotArbitrageList({
      category: String(request.query.category || 'ALL'),
      limit: Number(request.query.limit || 20),
      force: request.query.force === '1',
    });
    response.setHeader('Cache-Control', 'no-store');
    response.json(snapshot);
  } catch (error) {
    response.status(503).json({
      meta: { status: error.message || '热门套利榜不可用', stale: true },
      rows: [],
    });
  }
});

apiRouter.get('/funds/:code/history', async (request, response) => {
  try {
    const history = await getFundHistory(request.params.code, {
      limit: Number(request.query.limit || 60),
      force: request.query.force === '1',
    });
    response.setHeader('Cache-Control', 'no-store');
    response.json(history);
  } catch (error) {
    response.status(503).json({
      meta: { status: error.message || '历史数据不可用', stale: true },
      rows: [],
    });
  }
});

apiRouter.get('/funds/:code', async (request, response) => {
  try {
    const fund = await getFundDetail(request.params.code, {
      category: String(request.query.category || ''),
      force: request.query.force === '1',
    });
    if (!fund) {
      const normalizedCode = String(request.params.code || '').replace(/^(SZ|SH)/i, '');
      response.status(/^\d{6}$/.test(normalizedCode) ? 503 : 400).json({
        error: /^\d{6}$/.test(normalizedCode) ? '基金详情数据源暂不可用，请稍后重试' : '基金代码格式错误',
      });
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    response.json(fund);
  } catch (error) {
    response.status(503).json({ error: error.message || '基金详情不可用' });
  }
});

apiRouter.get('/market/indices', async (request, response) => {
  try {
    const snapshot = await fetchMarketIndices({ force: request.query.force === '1' });
    response.setHeader('Cache-Control', 'no-store');
    response.json(snapshot);
  } catch (error) {
    response.status(503).json({
      meta: { source: 'eastmoney', sourceStatus: 'error', stale: true, error: error.message || '指数行情不可用' },
      rows: [],
    });
  }
});

apiRouter.get('/health/data-sources', (_request, response) => {
  response.json(getDataSourceHealth());
});

apiRouter.get('/health', (_request, response) => {
  response.json({ ok: true, at: new Date().toISOString() });
});

apiRouter.post('/analytics/visit', async (request, response) => {
  try {
    const stats = await visitorAnalytics.recordVisit({
      deviceId: request.body?.deviceId,
      project: request.body?.project,
      path: request.body?.path || request.originalUrl || request.path,
      userAgent: request.get('user-agent') || '',
      ip: clientIp(request),
    });
    response.setHeader('Cache-Control', 'no-store');
    response.json({ ok: true, totalVisitors: stats.totalVisitors });
  } catch (error) {
    response.status(400).json({ ok: false, error: error.message || '访问记录失败' });
  }
});

apiRouter.post('/subscriptions/register', async (request, response) => {
  try {
    const result = await wechatSubscriptionService.registerByLoginCode(request.body?.code);
    response.setHeader('Cache-Control', 'no-store');
    response.json(result);
  } catch (error) {
    response.status(400).json({ ok: false, error: error.message || '订阅登记失败' });
  }
});

apiRouter.post('/subscriptions/status', async (request, response) => {
  try {
    response.setHeader('Cache-Control', 'no-store');
    response.json(await wechatSubscriptionService.getStatusByLoginCode(request.body?.code));
  } catch (error) {
    response.status(400).json({ ok: false, error: error.message || '提醒状态查询失败' });
  }
});

apiRouter.post('/subscriptions/cancel', async (request, response) => {
  try {
    response.setHeader('Cache-Control', 'no-store');
    response.json(await wechatSubscriptionService.cancelByLoginCode(request.body?.code));
  } catch (error) {
    response.status(400).json({ ok: false, error: error.message || '取消提醒失败' });
  }
});

apiRouter.post('/admin/login', (request, response) => {
  if (!isAdminPasswordValid(request.body?.password)) {
    response.status(401).json({ ok: false, error: '密码错误' });
    return;
  }
  response.setHeader('Cache-Control', 'no-store');
  response.json({ ok: true });
});

apiRouter.get('/admin/visitors', async (request, response) => {
  if (!isAdminPasswordValid(request.get('x-admin-password'))) {
    response.status(401).json({ ok: false, error: '未授权' });
    return;
  }
  const stats = await visitorAnalytics.getStats();
  response.setHeader('Cache-Control', 'no-store');
  response.json(stats);
});

app.use('/api', apiRouter);

app.listen(port, () => {
  console.log(`LOF radar API running at http://127.0.0.1:${port}`);
  let snapshotScheduler = null;
  if (process.env.DISABLE_FUND_SNAPSHOT_SCHEDULER !== '1') {
    snapshotScheduler = startFundSnapshotScheduler({ categories: ['ALL'], includeTrends: false, runImmediately: false });
  }
  if (process.env.DISABLE_STARTUP_CACHE_WARMUP !== '1') {
    setTimeout(() => {
      warmQuoteCaches()
        .then(() => snapshotScheduler?.refresh())
        .catch(() => {});
    }, 200);
  } else if (snapshotScheduler) {
    snapshotScheduler.refresh().catch(() => {});
  }
  if (process.env.DISABLE_WECHAT_SUBSCRIPTION_SCHEDULER !== '1') {
    startWechatSubscriptionScheduler({
      service: wechatSubscriptionService,
      getRows: () => getFundQuotes({ category: 'ALL', includeTrends: false }),
    });
  }
});

function quoteRequestInput(request) {
  const query = request && request.query && typeof request.query === 'object' ? request.query : {};
  const body = request && request.body && typeof request.body === 'object' ? request.body : {};
  return { ...query, ...body };
}

function quoteResponseOptions(input = {}) {
  return {
    fields: input.fields,
    page: input.page,
    pageSize: input.pageSize,
    query: input.query,
    marketFilter: input.marketFilter,
    excludePausedPurchase: input.excludePausedPurchase,
    sortKey: input.sortKey,
    sortDirection: input.sortDirection,
    snapshotId: input.snapshotId,
  };
}

function isTrueFlag(value) {
  return value === true || value === 1 || String(value || '') === '1';
}

function includeTrends(input) {
  return input.trends !== false && String(input.trends ?? '1') !== '0';
}

function clientIp(request) {
  return String(request.headers['x-forwarded-for'] || request.socket.remoteAddress || '')
    .split(',')[0]
    .trim();
}
