import express from 'express';
import { formatFundQuoteResponse, getFundDetail, getFundList, getFundQuotePage, getFundQuotes } from '../services/fundAggregator.js';
import { getFundHistory } from '../services/fundHistoryService.js';
import { getHotArbitrageList } from '../services/hotArbitrageService.js';

export function createFundsRouter() {
  const router = express.Router();

  router.get('/funds', async (request, response) => {
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

  router.get('/funds/quotes', handleFundQuotes);
  router.post('/funds/quotes', handleFundQuotes);
  router.get('/funds/quotes/refresh', handleFundQuotesRefresh);
  router.post('/funds/quotes/refresh', handleFundQuotesRefresh);
  router.get('/funds/quotes/page', handleFundQuotesPage);
  router.post('/funds/quotes/page', handleFundQuotesPage);

  router.get('/funds/hot-arbitrage', async (request, response) => {
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

  router.get('/funds/:code/history', async (request, response) => {
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

  router.get('/funds/:code', async (request, response) => {
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

  return router;
}

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
