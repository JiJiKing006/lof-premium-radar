<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { fetchVisitorStats, loginAdmin, type VisitorRecord, type VisitorStats } from '../api/analytics';

const ADMIN_PASSWORD_KEY = 'lof-admin-password';
const password = ref(loadPassword());
const stats = ref<VisitorStats | null>(null);
const loading = ref(false);
const error = ref('');
const isAuthed = ref(Boolean(password.value));
const maxDailyCount = computed(() => Math.max(1, ...((stats.value?.dailyNewVisitors || []).map((item) => item.count))));
const dailyDetailRows = computed(() => (stats.value?.dailyNewVisitorDetails || [])
  .flatMap((day) => day.visitors.map((visitor) => ({ ...visitor, date: day.date }))));

onMounted(() => {
  if (isAuthed.value) {
    refreshStats();
  }
});

async function handleLogin() {
  error.value = '';
  loading.value = true;
  try {
    await loginAdmin(password.value);
    window.localStorage.setItem(ADMIN_PASSWORD_KEY, password.value);
    isAuthed.value = true;
    await refreshStats();
  } catch {
    error.value = '密码错误，请重新输入';
  } finally {
    loading.value = false;
  }
}

async function refreshStats() {
  error.value = '';
  loading.value = true;
  try {
    stats.value = await fetchVisitorStats(password.value);
  } catch {
    error.value = '无法读取访问统计，请检查密码或服务状态';
    isAuthed.value = false;
    window.localStorage.removeItem(ADMIN_PASSWORD_KEY);
  } finally {
    loading.value = false;
  }
}

function logout() {
  password.value = '';
  stats.value = null;
  isAuthed.value = false;
  window.localStorage.removeItem(ADMIN_PASSWORD_KEY);
}

function loadPassword() {
  try {
    return window.localStorage.getItem(ADMIN_PASSWORD_KEY) || '';
  } catch {
    return '';
  }
}

function shortDeviceId(value: string) {
  if (!value) return '暂无数据';
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

function deviceTitle(value: string) {
  return value || '暂无数据';
}

function visitorUserAgent(visitor: VisitorRecord) {
  return visitor.userAgent || '暂无数据';
}

function visitorIp(visitor: VisitorRecord) {
  return visitor.ip || '暂无数据';
}
</script>

<template>
  <main class="admin-shell">
    <section v-if="!isAuthed" class="admin-login-panel" aria-label="后台登录">
      <div class="admin-login-copy">
        <p>VISITOR OPS</p>
        <h1>后台管理系统</h1>
        <span>输入访问密码查看用户访问统计</span>
      </div>
      <form class="admin-login-form" @submit.prevent="handleLogin">
        <label for="admin-password">访问密码</label>
        <input
          id="admin-password"
          v-model="password"
          type="password"
          inputmode="numeric"
          autocomplete="current-password"
          placeholder="请输入密码"
        />
        <button type="submit" :disabled="loading || !password.trim()">
          {{ loading ? '登录中' : '进入后台' }}
        </button>
        <p v-if="error" class="admin-error">{{ error }}</p>
      </form>
    </section>

    <section v-else class="admin-dashboard" aria-label="访问统计管理主页">
      <header class="admin-dashboard-head">
        <div>
          <p>VISITOR OPS</p>
          <h1>访问统计</h1>
          <span>按设备 ID 去重；一个设备只计一个用户。更新时间：{{ stats?.meta.updateTime || '暂无数据' }}</span>
        </div>
        <div class="admin-actions">
          <button type="button" @click="refreshStats" :disabled="loading">{{ loading ? '刷新中' : '刷新' }}</button>
          <button type="button" @click="logout">退出</button>
        </div>
      </header>

      <p v-if="error" class="admin-error">{{ error }}</p>

      <div class="admin-metrics">
        <article>
          <span>今日新增用户</span>
          <strong>{{ stats?.todayNewVisitors ?? 0 }}</strong>
        </article>
        <article>
          <span>累计用户（唯一设备）</span>
          <strong>{{ stats?.totalVisitors ?? 0 }}</strong>
        </article>
        <article>
          <span>累计访问</span>
          <strong>{{ stats?.totalVisits ?? 0 }}</strong>
        </article>
      </div>

      <section class="admin-panel">
        <div class="admin-panel-title">
          <h2>每日新增用户</h2>
          <span>按设备首次访问日期统计</span>
        </div>
        <div class="daily-bars">
          <div v-for="item in stats?.dailyNewVisitors || []" :key="item.date" class="daily-bar-row">
            <span>{{ item.date }}</span>
            <div class="daily-bar-track">
              <i :style="{ width: `${Math.max(8, (item.count / maxDailyCount) * 100)}%` }"></i>
            </div>
            <strong>{{ item.count }}</strong>
          </div>
          <p v-if="!stats?.dailyNewVisitors.length" class="admin-empty">暂无访问记录</p>
        </div>
      </section>

      <section class="admin-panel">
        <div class="admin-panel-title">
          <h2>每日新增用户明细</h2>
          <span>每行是一个首次出现的设备 ID</span>
        </div>
        <div class="visitor-table-wrap">
          <table class="visitor-table visitor-detail-table">
            <thead>
              <tr>
                <th>新增日期</th>
                <th>设备 ID</th>
                <th>首次登录时间</th>
                <th>最近访问</th>
                <th>次数</th>
                <th>首次路径</th>
                <th>最近路径</th>
                <th>IP</th>
                <th>设备信息</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="visitor in dailyDetailRows" :key="`${visitor.date}-${visitor.deviceId}`">
                <td>{{ visitor.date }}</td>
                <td :title="deviceTitle(visitor.deviceId)" class="device-id-cell">{{ shortDeviceId(visitor.deviceId) }}</td>
                <td>{{ visitor.firstSeenAt }}</td>
                <td>{{ visitor.lastSeenAt }}</td>
                <td>{{ visitor.visits }}</td>
                <td>{{ visitor.firstPath }}</td>
                <td>{{ visitor.lastPath }}</td>
                <td>{{ visitorIp(visitor) }}</td>
                <td :title="visitorUserAgent(visitor)" class="user-agent-cell">{{ visitorUserAgent(visitor) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="!dailyDetailRows.length" class="admin-empty">暂无新增用户明细</p>
        </div>
      </section>

      <section class="admin-panel">
        <div class="admin-panel-title">
          <h2>最近访问设备</h2>
          <span>同一设备重复访问只计为一个用户</span>
        </div>
        <div class="visitor-table-wrap">
          <table class="visitor-table">
            <thead>
              <tr>
                <th>设备</th>
                <th>首次访问</th>
                <th>最近访问</th>
                <th>次数</th>
                <th>最近路径</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="visitor in stats?.recentVisitors || []" :key="visitor.deviceId">
                <td :title="deviceTitle(visitor.deviceId)" class="device-id-cell">{{ shortDeviceId(visitor.deviceId) }}</td>
                <td>{{ visitor.firstSeenAt }}</td>
                <td>{{ visitor.lastSeenAt }}</td>
                <td>{{ visitor.visits }}</td>
                <td>{{ visitor.lastPath }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="!stats?.recentVisitors.length" class="admin-empty">暂无设备记录</p>
        </div>
      </section>
    </section>
  </main>
</template>
