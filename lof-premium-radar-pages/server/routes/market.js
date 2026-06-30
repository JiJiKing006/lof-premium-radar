import express from 'express';
import { getDataSourceHealth } from '../services/sourceHealth.js';
import { fetchMarketIndices } from '../sources/marketIndexSource.js';

export function createMarketRouter() {
  const router = express.Router();

  router.get('/market/indices', async (request, response) => {
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

  router.get('/health/data-sources', (_request, response) => {
    response.json(getDataSourceHealth());
  });

  router.get('/health', (_request, response) => {
    response.json({ ok: true, at: new Date().toISOString() });
  });

  return router;
}
