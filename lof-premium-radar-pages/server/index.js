import express from 'express';
import dns from 'node:dns';
import { getDataSourceHealth } from './services/sourceHealth.js';
import { formatFundQuoteResponse, getFundDetail, getFundList, getFundQuotePage, getFundQuotes, hydratePersistentFundSnapshots } from './services/fundAggregator.js';
import { getFundHistory } from './services/fundHistoryService.js';
import { getHotArbitrageList } from './services/hotArbitrageService.js';
import { fetchMarketIndices } from './sources/marketIndexSource.js';
import { isAdminPasswordValid, visitorAnalytics } from './services/visitorAnalytics.js';
import { warmQuoteCaches } from './services/quoteService.js';

const port = Number(process.env.PORT || 4173);

dns.setDefaultResultOrder('ipv4first');

const app = express();
const apiRouter = express.Router();

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

apiRouter.get('/funds/quotes', async (request, response) => {
  try {
    const snapshot = await getFundQuotes({
      category: String(request.query.category || ''),
      force: request.query.force === '1',
      includeTrends: request.query.trends !== '0',
    });
    response.setHeader('Cache-Control', 'no-store');
    response.json(formatFundQuoteResponse(snapshot, {
      fields: request.query.fields,
      page: request.query.page,
      pageSize: request.query.pageSize,
      query: request.query.query,
      marketFilter: request.query.marketFilter,
      excludePausedPurchase: request.query.excludePausedPurchase,
      sortKey: request.query.sortKey,
      sortDirection: request.query.sortDirection,
    }));
  } catch (error) {
    response.status(503).json({
      meta: { status: error.message || '行情服务不可用', stale: true },
      rows: [],
    });
  }
});

apiRouter.get('/funds/quotes/refresh', async (request, response) => {
  try {
    const snapshot = await getFundQuotes({
      category: String(request.query.category || ''),
      force: true,
      waitForFresh: false,
      includeTrends: request.query.trends !== '0',
    });
    response.setHeader('Cache-Control', 'no-store');
    response.json(formatFundQuoteResponse(snapshot, quoteResponseOptions(request)));
  } catch (error) {
    response.status(503).json({
      meta: { status: error.message || '首页数据刷新失败', stale: true },
      rows: [],
    });
  }
});

apiRouter.get('/funds/quotes/page', (request, response) => {
  try {
    const snapshot = getFundQuotePage({
      category: String(request.query.category || ''),
      includeTrends: request.query.trends !== '0',
    });
    response.setHeader('Cache-Control', 'no-store');
    response.json(formatFundQuoteResponse(snapshot, quoteResponseOptions(request)));
  } catch (error) {
    response.status(error.code === 'PAGE_SNAPSHOT_NOT_READY' ? 409 : 503).json({
      meta: { status: error.message || '分页数据不可用', stale: true },
      rows: [],
    });
  }
});

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
      response.status(404).json({ error: '基金不存在' });
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
  setTimeout(() => {
    warmQuoteCaches()
      .then(() => getFundQuotes({ category: 'ALL', force: true, waitForFresh: true, includeTrends: false }))
      .catch(() => {});
  }, 200);
});

function quoteResponseOptions(request) {
  return {
    fields: request.query.fields,
    page: request.query.page,
    pageSize: request.query.pageSize,
    query: request.query.query,
    marketFilter: request.query.marketFilter,
    excludePausedPurchase: request.query.excludePausedPurchase,
    sortKey: request.query.sortKey,
    sortDirection: request.query.sortDirection,
  };
}

function clientIp(request) {
  return String(request.headers['x-forwarded-for'] || request.socket.remoteAddress || '')
    .split(',')[0]
    .trim();
}
