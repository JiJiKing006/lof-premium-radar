import express from 'express';
import dns from 'node:dns';
import { getFundQuotes, hydratePersistentFundSnapshots, startFundSnapshotScheduler } from './services/fundAggregator.js';
import { warmQuoteCaches } from './services/quoteService.js';
import { createWechatSubscriptionService, startWechatSubscriptionScheduler } from './services/wechatSubscriptionService.js';
import { createFundsRouter } from './routes/funds.js';
import { createMarketRouter } from './routes/market.js';
import { createOperationsRouter } from './routes/operations.js';

const port = Number(process.env.PORT || 4173);

dns.setDefaultResultOrder('ipv4first');

const app = express();
const wechatSubscriptionService = createWechatSubscriptionService();

hydratePersistentFundSnapshots();

app.use(express.json());
app.use('/api', createFundsRouter());
app.use('/api', createMarketRouter());
app.use('/api', createOperationsRouter({ wechatSubscriptionService }));

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
