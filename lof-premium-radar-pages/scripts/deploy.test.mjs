import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const deployScript = readFileSync(new URL('./deploy.sh', import.meta.url), 'utf8');
const nginxDefault = readFileSync(new URL('../nginx-default.conf', import.meta.url), 'utf8');

describe('deployment nginx configuration', () => {
  it('serves the active release when nginx falls back to the default server', () => {
    expect(deployScript).toContain('default_server');
    expect(deployScript).toContain('rm -f /etc/nginx/sites-enabled/default');
    expect(deployScript).toContain('root ${DEPLOY_PATH}/current/dist;');

    expect(nginxDefault).toContain('default_server');
    expect(nginxDefault).toContain('root /srv/lof/current/dist;');
  });

  it('prevents stale index html from surviving after deploy while keeping hashed assets cacheable', () => {
    expect(deployScript).toContain('Cache-Control "no-store, no-cache, must-revalidate"');
    expect(deployScript).toContain('expires 30d');
    expect(deployScript).toContain('immutable');

    expect(nginxDefault).toContain('Cache-Control "no-store, no-cache, must-revalidate"');
    expect(nginxDefault).toContain('expires 30d');
    expect(nginxDefault).toContain('immutable');
  });

  it('stores visitor analytics outside release directories', () => {
    expect(deployScript).toContain('mkdir -p \'$DEPLOY_PATH/releases\' \'$DEPLOY_PATH/shared\'');
    expect(deployScript).toContain('Environment=VISITOR_ANALYTICS_FILE=${DEPLOY_PATH}/shared/visitor-analytics.json');
  });

  it('checks SSH access before running build and upload work', () => {
    expect(deployScript).toContain('check_ssh_connection');
    expect(deployScript).toContain('==> Checking SSH access');
    expect(deployScript).toContain('SSH preflight failed');
    expect(deployScript).toContain('DEPLOY_SSH_KEY');
    expect(deployScript).toContain('Public key to install:');
  });

  it('smoke tests the deployed LOF API before reporting success', () => {
    expect(deployScript).toContain('DEPLOY_SMOKE_URL');
    expect(deployScript).toContain('/api/funds/quotes?category=LOF&trends=0&force=1');
    expect(deployScript).toContain('LOF API smoke test failed');
    expect(deployScript).toContain('rowCount !== 53');
    expect(deployScript).toContain('missingPrice.length');
    expect(deployScript).toContain('missingNav.length');
    expect(deployScript).toContain('missingPremium.length');
    expect(deployScript).toContain('501312');
  });

  it('retries the LOF data smoke test before accepting incomplete deployed data', () => {
    expect(deployScript).toContain('verify_lof_api');
    expect(deployScript).toContain('for attempt in $(seq 1 5)');
    expect(deployScript).toContain('LOF API smoke test retrying');
    expect(deployScript).toContain('sleep 3');
  });

  it('waits for the restarted app before external smoke tests can hit nginx', () => {
    expect(deployScript).toContain('wait_for_remote_app');
    expect(deployScript).toContain('http://127.0.0.1:${APP_PORT}/api/health');
    const restartIndex = deployScript.indexOf('systemctl restart "$DEPLOY_SERVICE"');
    const waitCallIndex = deployScript.indexOf('wait_for_remote_app', restartIndex);
    const remoteScriptEndIndex = deployScript.lastIndexOf('REMOTE_SCRIPT');

    expect(restartIndex).toBeGreaterThan(-1);
    expect(waitCallIndex).toBeGreaterThan(restartIndex);
    expect(waitCallIndex).toBeLessThan(remoteScriptEndIndex);
    expect(remoteScriptEndIndex).toBeLessThan(deployScript.indexOf('==> Verifying deployed LOF API'));
  });

  it('smoke tests deployed analytics and admin routes before reporting success', () => {
    expect(deployScript).toContain('/api/analytics/visit');
    expect(deployScript).toContain('/api/admin/login');
    expect(deployScript).toContain('/api/admin/visitors');
    expect(deployScript).toContain('Analytics API smoke test failed');
    expect(deployScript).toContain('Admin API smoke test failed');
  });

  it('propagates the configured admin password to the deployed service', () => {
    expect(deployScript).toContain("ADMIN_PASSWORD='$DEPLOY_ADMIN_PASSWORD'");
    expect(deployScript).toContain('Environment=ADMIN_PASSWORD=${ADMIN_PASSWORD}');
  });
});
