import express from 'express';
import { isAdminPasswordValid, visitorAnalytics } from '../services/visitorAnalytics.js';

export function createOperationsRouter({ wechatSubscriptionService }) {
  const router = express.Router();

  router.post('/analytics/visit', async (request, response) => {
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

  router.post('/subscriptions/register', async (request, response) => {
    try {
      const result = await wechatSubscriptionService.registerByLoginCode(request.body?.code);
      response.setHeader('Cache-Control', 'no-store');
      response.json(result);
    } catch (error) {
      response.status(400).json({ ok: false, error: error.message || '订阅登记失败' });
    }
  });

  router.post('/subscriptions/status', async (request, response) => {
    try {
      response.setHeader('Cache-Control', 'no-store');
      response.json(await wechatSubscriptionService.getStatusByLoginCode(request.body?.code));
    } catch (error) {
      response.status(400).json({ ok: false, error: error.message || '提醒状态查询失败' });
    }
  });

  router.post('/subscriptions/cancel', async (request, response) => {
    try {
      response.setHeader('Cache-Control', 'no-store');
      response.json(await wechatSubscriptionService.cancelByLoginCode(request.body?.code));
    } catch (error) {
      response.status(400).json({ ok: false, error: error.message || '取消提醒失败' });
    }
  });

  router.post('/admin/login', (request, response) => {
    if (!isAdminPasswordValid(request.body?.password)) {
      response.status(401).json({ ok: false, error: '密码错误' });
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    response.json({ ok: true });
  });

  router.get('/admin/visitors', async (request, response) => {
    if (!isAdminPasswordValid(request.get('x-admin-password'))) {
      response.status(401).json({ ok: false, error: '未授权' });
      return;
    }
    const stats = await visitorAnalytics.getStats();
    response.setHeader('Cache-Control', 'no-store');
    response.json(stats);
  });

  return router;
}

function clientIp(request) {
  return String(request.headers['x-forwarded-for'] || request.socket.remoteAddress || '')
    .split(',')[0]
    .trim();
}
