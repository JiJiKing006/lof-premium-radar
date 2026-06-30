import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSubscriptionTop1, buildTemplateMessage, createWechatSubscriptionService } from './wechatSubscriptionService.js';

const tempDirs = [];
afterEach(async () => Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

describe('微信一次性订阅消息', () => {
  it('在真实完整 LOF 中选择非暂停且成交额大于500万元的溢价率 Top1', () => {
    const rows = [
      fund('1', 99, { state: 'open', label: '不限额' }, { category: 'ETF' }),
      fund('2', 90, { state: 'paused', label: '暂停申购' }),
      fund('3', 80, { state: 'open', label: '不限额' }, { turnover: 5_000_000 }),
      fund('4', 70, { state: 'open', label: '不限额' }, { lastNav: null }),
      fund('5', 60, { state: 'unknown', label: '暂无数据' }),
      fund('6', 8, { state: 'limited', label: '单日限100元', dailyLimit: 100 }),
      fund('7', 7, { state: 'open', label: '不限额' }),
    ];
    expect(buildSubscriptionTop1(rows).map((item) => item.code)).toEqual(['5']);
  });

  it('默认筛选差值相同时按基金代码稳定选择 Top1', () => {
    expect(buildSubscriptionTop1([
      fund('501225', 7),
      fund('160216', 7),
    ]).map((item) => item.code)).toEqual(['160216']);
  });

  it('模板内容仅包含 Top1 基金名称、代码和溢价率且不超过20字符', () => {
    const message = buildTemplateMessage([fund('160001', 7), fund('160002', 6), fund('160003', 5)], new Date('2026-06-28T06:30:00Z'));
    expect(message.date).toBe('2026-06-28');
    expect(message.content).toBe('基金16000(160001)7.00%');
    expect(Array.from(message.content).length).toBeLessThanOrEqual(20);
    expect(message.note).toBe('仅供参考，不做投资建议');
  });

  it('通过 wx.login 临时 code 换取 openid 并记录一次发送额度', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lof-subscribe-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, 'subscriptions.json');
    const fetchImpl = async (url) => ({ ok: true, json: async () => url.includes('jscode2session') ? { openid: 'private-openid' } : {} });
    const service = createWechatSubscriptionService({ appSecret: 'server-only-secret', filePath, fetchImpl });

    const result = await service.registerByLoginCode('temporary-code');
    const stored = JSON.parse(await readFile(filePath, 'utf8'));

    expect(result).toEqual({ ok: true, pendingCount: 1, testScheduled: false });
    expect(stored.subscribers['private-openid'].pendingCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain('private-openid');

    expect(await service.getStatusByLoginCode('status-code')).toEqual({ ok: true, added: true });
    expect(await service.cancelByLoginCode('cancel-code')).toEqual({ ok: true, added: false });
    expect(await service.getStatusByLoginCode('status-code-2')).toEqual({ ok: true, added: false });
  });

});

function fund(code, premiumRate, purchaseLimit = { state: 'open', label: '不限额' }, overrides = {}) {
  return {
    code,
    name: `基金${code}`,
    category: 'LOF',
    marketPrice: 1.2,
    lastNav: 1,
    premiumRate,
    turnover: 6_000_000,
    purchaseLimit,
    source: '东方财富',
    quoteTime: '2026-06-28 14:30:00',
    ...overrides,
  };
}
