import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSubscriptionTop1, buildTemplateMessage, createWechatSubscriptionService } from './wechatSubscriptionService.js';

const tempDirs = [];
afterEach(async () => Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

describe('微信一次性订阅消息', () => {
  it('剔除暂停申购和场内交易后按实时溢价率选择 Top1', () => {
    const rows = [
      fund('1', 9, { state: 'paused', label: '暂停申购' }),
      fund('2', 8, { state: 'exchange', label: '场内交易' }),
      fund('3', 7), fund('4', 6), fund('5', 5), fund('6', 4),
    ];
    expect(buildSubscriptionTop1(rows).map((item) => item.code)).toEqual(['3']);
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

  it('开发模式订阅成功后10秒只给当前用户发送一条真实 LOF 测试消息', async () => {
    vi.useFakeTimers();
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lof-subscribe-test-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, 'subscriptions.json');
    const sentBodies = [];
    const fetchImpl = async (url, init = {}) => {
      if (url.includes('jscode2session')) return response({ openid: 'test-openid' });
      if (url.includes('stable_token')) return response({ access_token: 'test-token', expires_in: 7200 });
      if (url.includes('gettemplate')) return response({
        data: [{ priTmplId: 'nChCRD1ljtNdWE20NSZIogo5tYX5sX4xP4UPEdZVLyM', content: '{{date1.DATA}}{{thing2.DATA}}{{thing3.DATA}}' }],
      });
      if (url.includes('message/subscribe/send')) {
        sentBodies.push(JSON.parse(init.body));
        return response({ errcode: 0, errmsg: 'ok' });
      }
      return response({});
    };
    const service = createWechatSubscriptionService({
      appSecret: 'server-only-secret',
      filePath,
      fetchImpl,
      testDelayMs: 10_000,
      getRows: async () => [
        { code: '513100', name: '纳指ETF', category: 'ETF', premiumRate: 99, purchaseLimit: { state: 'open', label: '开放申购' } },
        { code: '501225', name: '全球芯片LOF', category: 'LOF', premiumRate: 26.46, purchaseLimit: { state: 'open', label: '开放申购' } },
      ],
    });

    const result = await service.registerByLoginCode('temporary-code', { testMode: true });
    expect(result).toEqual({ ok: true, pendingCount: 1, testScheduled: true });
    expect(sentBodies).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(sentBodies).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(sentBodies).toHaveLength(1));

    expect(sentBodies[0]).toMatchObject({
      touser: 'test-openid',
      miniprogram_state: 'developer',
      data: {
        thing2: { value: '全球芯片LO(501225)26.46%' },
        thing3: { value: '开发测试，仅验证送达' },
      },
    });
    const stored = JSON.parse(await readFile(filePath, 'utf8'));
    expect(stored.subscribers['test-openid'].pendingCount).toBe(0);
  });
});

function response(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

function fund(code, premiumRate, purchaseLimit = { state: 'open', label: '不限额' }) {
  return { code, name: `基金${code}`, premiumRate, purchaseLimit, quoteTime: '2026-06-28 14:30:00' };
}
