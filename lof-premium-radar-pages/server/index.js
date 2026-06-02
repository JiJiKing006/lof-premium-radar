import express from 'express';
import dns from 'node:dns';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { getDataSourceHealth } from './services/sourceHealth.js';
import { createDevServerOptions } from './services/devServerOptions.js';
import { getFundDetail, getFundList, getFundQuotes } from './services/fundAggregator.js';
import { getFundHistory } from './services/fundHistoryService.js';
import { getHotArbitrageList } from './services/hotArbitrageService.js';
import { fetchMarketIndices } from './sources/marketIndexSource.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 4173);
const isProduction = process.env.NODE_ENV === 'production';

dns.setDefaultResultOrder('ipv4first');

const app = express();

app.use(express.json());

app.get('/api/funds', async (request, response) => {
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

app.get('/api/funds/quotes', async (request, response) => {
  try {
    const snapshot = await getFundQuotes({
      category: String(request.query.category || ''),
      force: request.query.force === '1',
      includeTrends: request.query.trends !== '0',
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

app.get('/api/funds/hot-arbitrage', async (request, response) => {
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

app.get('/api/funds/:code/history', async (request, response) => {
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

app.get('/api/funds/:code', async (request, response) => {
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

app.get('/api/market/indices', async (request, response) => {
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

app.get('/api/health/data-sources', (_request, response) => {
  response.json(getDataSourceHealth());
});

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, at: new Date().toISOString() });
});

if (isProduction) {
  app.use(express.static(path.join(root, 'dist')));
  app.get('*', (_request, response) => {
    response.sendFile(path.join(root, 'dist', 'index.html'));
  });
} else {
  const vite = await createViteServer(createDevServerOptions({ root, port }));
  app.use(vite.middlewares);
}

app.listen(port, () => {
  console.log(`LOF radar running at http://127.0.0.1:${port}`);
  setTimeout(() => {
    for (const category of ['LOF', 'QDII', 'ETF']) {
      getFundQuotes({ category, includeTrends: false }).catch(() => {});
    }
  }, 200);
});
