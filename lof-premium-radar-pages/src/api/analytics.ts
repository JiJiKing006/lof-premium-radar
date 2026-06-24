export interface VisitorStatsSnapshot {
  meta: {
    source: string;
    updateTime: string;
    targetTotalVisitors?: number;
  };
  project: string;
  label: string;
  seeded: boolean;
  totalVisitors: number;
  totalVisits: number;
  todayNewVisitors: number;
  dailyNewVisitors: Array<{
    date: string;
    count: number;
  }>;
  dailyNewVisitorDetails: Array<{
    date: string;
    count: number;
    visitors: VisitorRecord[];
  }>;
  recentVisitors: VisitorRecord[];
}

export interface VisitorStats extends VisitorStatsSnapshot {
  projects: VisitorStatsSnapshot[];
}

export interface VisitorRecord {
    deviceId: string;
    project: string;
    firstSeenAt: string;
    lastSeenAt: string;
    firstPath: string;
    lastPath: string;
    visits: number;
    userAgent: string;
    ip: string;
}

export async function recordVisitor(deviceId: string, path = window.location.pathname + window.location.search, project = 'lof') {
  const response = await fetch('/api/analytics/visit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, path, project }),
  });
  if (!response.ok) throw new Error('访问记录失败');
  return response.json() as Promise<{ ok: boolean; totalVisitors: number }>;
}

export async function loginAdmin(password: string) {
  const response = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) throw new Error('密码错误');
  return response.json() as Promise<{ ok: boolean }>;
}

export async function fetchVisitorStats(password: string): Promise<VisitorStats> {
  const response = await fetch('/api/admin/visitors', {
    headers: { 'X-Admin-Password': password },
  });
  if (!response.ok) throw new Error('无法读取访问统计');
  return response.json() as Promise<VisitorStats>;
}
