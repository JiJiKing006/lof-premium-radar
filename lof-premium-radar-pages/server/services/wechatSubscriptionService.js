import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const DEFAULT_FILE = path.join(root, 'data', 'wechat-subscriptions.json');
const DEFAULT_APP_ID = 'wxd827a0e78b5ce07a';
const DEFAULT_TEMPLATE_ID = 'nChCRD1ljtNdWE20NSZIogo5tYX5sX4xP4UPEdZVLyM';
const NOTE = '仅供参考，不做投资建议';
const DEFAULT_REMINDER_MIN_TURNOVER_YUAN = 5_000_000;

export function createWechatSubscriptionService(options = {}) {
  const config = {
    appId: options.appId || process.env.WX_APP_ID || DEFAULT_APP_ID,
    appSecret: options.appSecret || process.env.WX_APP_SECRET || '',
    templateId: options.templateId || process.env.WX_SUBSCRIBE_TEMPLATE_ID || DEFAULT_TEMPLATE_ID,
    filePath: options.filePath || process.env.WX_SUBSCRIPTION_FILE || DEFAULT_FILE,
    fetchImpl: options.fetchImpl || fetch,
  };
  let accessToken = null;
  let templateKeys = null;
  let writeChain = Promise.resolve();

  async function registerByLoginCode(code) {
    assertConfigured(config);
    const openid = await exchangeLoginCode(String(code || '').trim());
    if (!openid) throw new Error('微信登录未返回 openid');
    const store = await readStore(config.filePath);
    const previous = store.subscribers[openid] || { pendingCount: 0 };
    store.subscribers[openid] = {
      pendingCount: Math.min(10, Number(previous.pendingCount || 0) + 1),
      subscribedAt: formatShanghaiDateTime(new Date()),
    };
    store.updatedAt = formatShanghaiDateTime(new Date());
    writeChain = writeChain.then(() => writeStore(config.filePath, store));
    await writeChain;
    return { ok: true, pendingCount: store.subscribers[openid].pendingCount, testScheduled: false };
  }

  async function getStatusByLoginCode(code) {
    assertConfigured(config);
    const openid = await exchangeLoginCode(String(code || '').trim());
    const store = await readStore(config.filePath);
    return { ok: true, added: Number(store.subscribers[openid]?.pendingCount || 0) > 0 };
  }

  async function cancelByLoginCode(code) {
    assertConfigured(config);
    const openid = await exchangeLoginCode(String(code || '').trim());
    const store = await readStore(config.filePath);
    if (store.subscribers[openid]) {
      store.subscribers[openid].pendingCount = 0;
      store.subscribers[openid].cancelledAt = formatShanghaiDateTime(new Date());
      store.updatedAt = formatShanghaiDateTime(new Date());
      await writeStore(config.filePath, store);
    }
    return { ok: true, added: false };
  }

  async function exchangeLoginCode(code) {
    if (!code) throw new Error('缺少微信登录 code');
    const query = new URLSearchParams({ appid: config.appId, secret: config.appSecret, js_code: code, grant_type: 'authorization_code' });
    const payload = await fetchWechatJson(`${'https://api.weixin.qq.com'}/sns/jscode2session?${query}`);
    return payload.openid;
  }

  async function getAccessToken() {
    if (accessToken && accessToken.expiresAt > Date.now() + 60_000) return accessToken.value;
    const payload = await fetchWechatJson('https://api.weixin.qq.com/cgi-bin/stable_token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credential', appid: config.appId, secret: config.appSecret, force_refresh: false }),
    });
    accessToken = { value: payload.access_token, expiresAt: Date.now() + Number(payload.expires_in || 7200) * 1000 };
    return accessToken.value;
  }

  async function resolveTemplateKeys() {
    const envKeys = [process.env.WX_SUBSCRIBE_DATE_KEY, process.env.WX_SUBSCRIBE_CONTENT_KEY, process.env.WX_SUBSCRIBE_NOTE_KEY].filter(Boolean);
    if (envKeys.length === 3) return { date: envKeys[0], content: envKeys[1], note: envKeys[2] };
    if (templateKeys) return templateKeys;
    const token = await getAccessToken();
    const payload = await fetchWechatJson(`https://api.weixin.qq.com/wxaapi/newtmpl/gettemplate?access_token=${encodeURIComponent(token)}`);
    const template = (payload.data || []).find((item) => item.priTmplId === config.templateId || item.template_id === config.templateId);
    const keys = Array.from(String(template?.content || '').matchAll(/\{\{([a-z_]+\d+)\.DATA\}\}/gi), (match) => match[1]);
    if (keys.length < 3) throw new Error('无法识别订阅模板字段 key，请配置 WX_SUBSCRIBE_DATE_KEY、WX_SUBSCRIBE_CONTENT_KEY、WX_SUBSCRIBE_NOTE_KEY');
    templateKeys = { date: keys[0], content: keys[1], note: keys[2] };
    return templateKeys;
  }

  async function sendDaily(rows, now = new Date()) {
    assertConfigured(config);
    const top1 = buildSubscriptionTop1(rows);
    if (top1.length < 1) return { sent: 0, skipped: 'eligible_top1_unavailable' };
    if (!hasCurrentTradingDate(top1, now)) return { sent: 0, skipped: 'not_current_trading_day' };
    const message = buildTemplateMessage(top1, now);
    console.log('[订阅消息模板内容]', JSON.stringify(message));
    const keys = await resolveTemplateKeys();
    validateTemplateValue(keys.content, message.content);
    const store = await readStore(config.filePath);
    const token = await getAccessToken();
    let sent = 0;
    for (const [openid, entry] of Object.entries(store.subscribers)) {
      if (Number(entry.pendingCount || 0) < 1) continue;
      try {
        await sendSubscribeMessage(openid, message, keys, token, process.env.WX_MINIPROGRAM_STATE || 'formal');
        entry.pendingCount -= 1;
        entry.lastSentAt = formatShanghaiDateTime(now);
        sent += 1;
      } catch (error) {
        entry.lastError = String(error.message || error).slice(0, 160);
      }
    }
    store.updatedAt = formatShanghaiDateTime(now);
    await writeStore(config.filePath, store);
    return { sent, message };
  }

  function sendSubscribeMessage(openid, message, keys, token, miniprogramState) {
    return fetchWechatJson(`https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser: openid,
        template_id: config.templateId,
        page: 'pages/index/index',
        miniprogram_state: miniprogramState,
        data: {
          [keys.date]: { value: message.date },
          [keys.content]: { value: message.content },
          [keys.note]: { value: message.note },
        },
      }),
    });
  }

  async function fetchWechatJson(url, init) {
    const response = await config.fetchImpl(url, init);
    const payload = await response.json();
    if (!response.ok || Number(payload.errcode || 0) !== 0) throw new Error(`微信接口调用失败：${payload.errmsg || response.status}`);
    return payload;
  }

  return { isConfigured: () => Boolean(config.appId && config.appSecret && config.templateId), registerByLoginCode, getStatusByLoginCode, cancelByLoginCode, sendDaily };
}

export function buildSubscriptionTop1(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter(isDefaultReminderEligible)
    .sort((left, right) => {
      const premiumDelta = Number(right.premiumRate) - Number(left.premiumRate);
      if (premiumDelta !== 0) return premiumDelta;
      return String(left.code || '').localeCompare(String(right.code || ''));
    })
    .slice(0, 1);
}

export function buildTemplateMessage(top1, now = new Date()) {
  const fund = top1[0];
  return {
    date: formatShanghaiDate(now),
    content: compactTop1Content(fund),
    note: NOTE,
  };
}

function compactTop1Content(fund) {
  const suffix = `(${String(fund.code || '')})${Number(fund.premiumRate).toFixed(2)}%`;
  const nameBudget = Math.max(0, 20 - Array.from(suffix).length);
  const compactName = Array.from(String(fund.name || '')).slice(0, nameBudget).join('');
  return Array.from(`${compactName}${suffix}`).slice(0, 20).join('');
}

function isDefaultReminderEligible(row) {
  if (!row) return false;
  const category = String(row.category || row.fundType || '').toUpperCase();
  if (category !== 'LOF') return false;
  const price = Number(row.marketPrice ?? row.price);
  const nav = Number(row.lastNav ?? row.nav);
  const premiumRate = Number(row.premiumRate);
  const turnover = Number(row.turnover ?? row.amount);
  if (!Number.isFinite(price) || price <= 0) return false;
  if (!Number.isFinite(nav) || nav <= 0) return false;
  if (!Number.isFinite(premiumRate)) return false;
  if (!Number.isFinite(turnover) || turnover <= DEFAULT_REMINDER_MIN_TURNOVER_YUAN) return false;
  return !isPausedPurchase(row);
}

function isPausedPurchase(row) {
  const limit = row.purchaseLimit || {};
  const state = String(limit.state || row.subscriptionState || '').toLowerCase();
  const label = String([limit.label, limit.limitText, row.subscriptionStatus].filter(Boolean).join(' '));
  return state === 'paused' || /暂停申购|停止申购/.test(label);
}

function hasCurrentTradingDate(rows, now) {
  const today = formatShanghaiDate(now);
  return rows.every((row) => String(row.quoteTime || row.updateTime || '').startsWith(today));
}

function validateTemplateValue(key, value) {
  if (/^thing/i.test(key) && Array.from(value).length > 20) {
    throw new Error('当前“消息内容”字段为 thing 类型（最多20字符），无法同时展示3只基金；请更换为包含3个基金内容字段的模板');
  }
}

function assertConfigured(config) {
  if (!config.appSecret) throw new Error('服务端未配置 WX_APP_SECRET');
}

async function readStore(filePath) {
  try { return normalizeStore(JSON.parse(await readFile(filePath, 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return normalizeStore({}); throw error; }
}

async function writeStore(filePath, store) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, filePath);
}

function normalizeStore(value) { return { version: 1, updatedAt: value?.updatedAt || '', subscribers: value?.subscribers || {} }; }
function formatShanghaiDate(date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }
function formatShanghaiDateTime(date) { return `${formatShanghaiDate(date)} ${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date)}`; }

export function startWechatSubscriptionScheduler({ service, getRows, intervalMs = 30_000 }) {
  let lastRunDate = '';
  let running = false;
  const tick = async () => {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit' }).format(now);
    const date = formatShanghaiDate(now);
    if (parts !== '14:30' || lastRunDate === date || running || !service.isConfigured()) return;
    running = true;
    try {
      const snapshot = await getRows();
      const result = await service.sendDaily(snapshot.rows || [], now);
      if (!result.skipped) lastRunDate = date;
    } catch (error) {
      console.error('[订阅消息] 定时发送失败', error.message);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), tick };
}
