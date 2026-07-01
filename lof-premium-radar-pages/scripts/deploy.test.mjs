import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const deployScript = readFileSync(new URL('./deploy.sh', import.meta.url), 'utf8');
const testDeployScript = readFileSync(new URL('./deploy-test.sh', import.meta.url), 'utf8');
const nginxDefault = readFileSync(new URL('../nginx-default.conf', import.meta.url), 'utf8');
const serverIndex = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const fundsRoutes = readFileSync(new URL('../server/routes/funds.js', import.meta.url), 'utf8');
const miniProgramConfig = readFileSync(new URL('../config/mp.js', import.meta.url), 'utf8');

describe('deployment nginx configuration', () => {
  it('serves the personal homepage at the root and the LOF API under /api and /lof/api', () => {
    expect(deployScript).toContain('default_server');
    expect(deployScript).toContain('rm -f /etc/nginx/sites-enabled/default');
    expect(deployScript).toContain('DEPLOY_DOMAIN="${DEPLOY_DOMAIN:-jijiking.top}"');
    expect(deployScript).toContain('DEPLOY_LOF_PUBLIC_PATH="${DEPLOY_LOF_PUBLIC_PATH:-/lof}"');
    expect(deployScript).toContain('DEPLOY_HOME_ROOT="${DEPLOY_HOME_ROOT:-/srv/www/home}"');
    expect(deployScript).toContain('npm run check:server');
    expect(deployScript).toContain('NGINX_SERVER_NAME="$DEPLOY_DOMAIN"');
    expect(deployScript).toContain('grep -Rsl "server_name ${DEPLOY_DOMAIN}"');
    expect(deployScript).toContain('NGINX_SERVER_NAME="_"');
    expect(deployScript).toContain('server_name ${NGINX_SERVER_NAME};');
    expect(deployScript).toContain('root ${HOME_ROOT};');
    expect(deployScript).toContain('location ^~ ${LOF_PUBLIC_PATH}/api/');
    expect(deployScript).not.toContain('VITE_BASE_PATH');
    expect(deployScript).not.toContain('current/dist');

    expect(nginxDefault).toContain('default_server');
    expect(nginxDefault).toContain('server_name jijiking.top');
    expect(nginxDefault).toContain('root /srv/www/home;');
    expect(nginxDefault).toContain('location ^~ /lof/api/');
    expect(nginxDefault).not.toContain('/srv/lof/current/dist');

    expect(serverIndex).toContain("app.use('/api', createFundsRouter());");
    expect(serverIndex).toContain("app.use('/api', createMarketRouter());");
    expect(serverIndex).toContain("app.use('/api', createOperationsRouter({ wechatSubscriptionService }));");
    expect(fundsRoutes).toContain("router.post('/funds/quotes'");
    expect(fundsRoutes).toContain("router.post('/funds/quotes/refresh'");
    expect(fundsRoutes).toContain('waitForFresh: true');
    expect(fundsRoutes).toContain("router.post('/funds/quotes/page'");
    expect(serverIndex).not.toContain('createViteServer');
    expect(serverIndex).not.toContain('express.static');
  });

  it('keeps root homepage cache policy outside the LOF API service', () => {
    expect(deployScript).toContain('Cache-Control "no-store, no-cache, must-revalidate"');
    expect(deployScript).not.toContain('dist/assets');

    expect(nginxDefault).toContain('Cache-Control "no-store, no-cache, must-revalidate"');
    expect(nginxDefault).not.toContain('/lof/assets/');
  });

  it('stores visitor analytics outside release directories', () => {
    expect(deployScript).toContain('mkdir -p \'$DEPLOY_PATH/releases\' \'$DEPLOY_PATH/shared\'');
    expect(deployScript).toContain('Environment=VISITOR_ANALYTICS_FILE=${DEPLOY_PATH}/shared/visitor-analytics.json');
  });

  it('checks SSH access before running checks and upload work', () => {
    expect(deployScript).toContain('check_ssh_connection');
    expect(deployScript).toContain('==> Checking SSH access');
    expect(deployScript).toContain('SSH preflight failed');
    expect(deployScript).toContain('DEPLOY_SSH_KEY');
    expect(deployScript).toContain('Public key to install:');
  });

  it('smoke tests the deployed LOF API before reporting success', () => {
    expect(deployScript).toContain('DEPLOY_SMOKE_URL');
    expect(deployScript).toContain('verify_fund_list_api');
    expect(deployScript).toContain('/api/funds?category=LOF&force=1');
    expect(deployScript).toContain('${LOF_PUBLIC_PATH}/api/funds?category=LOF');
    expect(deployScript).toContain('response is not JSON');
    expect(deployScript).toContain('missingSource.length');
    expect(deployScript).toContain('/api/funds/quotes?category=LOF&trends=0&force=1');
    expect(deployScript).toContain('LOF API smoke test failed');
    expect(deployScript).toContain('rowCount !== 285');
    expect(deployScript).toContain('unlabeledMissing.length');
    expect(deployScript).toContain('incompleteCritical.length');
    expect(deployScript).toContain('Number(overseasTech.lastNav) <= 0');
    expect(deployScript).toContain('!Number.isFinite(Number(overseasTech.premiumRate))');
    expect(deployScript).toContain('dataStatus !== "missing_quote"');
    expect(deployScript).toContain('sourceStatus !== "missing"');
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
    expect(deployScript).toContain('"project":"lof"');
    expect(deployScript).toContain('"project":"personal"');
    expect(deployScript).toContain('Personal analytics API smoke test failed');
    expect(deployScript).toContain('/api/admin/login');
    expect(deployScript).toContain('/api/admin/visitors');
    expect(deployScript).toContain('Analytics API smoke test failed');
    expect(deployScript).toContain('Admin API smoke test failed');
    expect(deployScript).toContain('project.project === "lof"');
    expect(deployScript).toContain('project.project === "personal"');
  });

  it('propagates the configured admin password to the deployed service', () => {
    expect(deployScript).toContain("ADMIN_PASSWORD='$DEPLOY_ADMIN_PASSWORD'");
    expect(deployScript).toContain('Environment=ADMIN_PASSWORD=${ADMIN_PASSWORD}');
  });

  it('propagates the daily-growing visitor analytics baseline to the deployed service', () => {
    expect(deployScript).toContain('DEPLOY_VISITOR_ANALYTICS_TARGET_TOTAL="${DEPLOY_VISITOR_ANALYTICS_TARGET_TOTAL:-273}"');
    expect(deployScript).toContain('DEPLOY_VISITOR_ANALYTICS_GROWTH_START_DATE="${DEPLOY_VISITOR_ANALYTICS_GROWTH_START_DATE:-2026-06-07}"');
    expect(deployScript).toContain("DEPLOY_VISITOR_ANALYTICS_TARGET_TOTAL='$DEPLOY_VISITOR_ANALYTICS_TARGET_TOTAL'");
    expect(deployScript).toContain("DEPLOY_VISITOR_ANALYTICS_GROWTH_START_DATE='$DEPLOY_VISITOR_ANALYTICS_GROWTH_START_DATE'");
    expect(deployScript).toContain('Environment=VISITOR_ANALYTICS_TARGET_TOTAL=${DEPLOY_VISITOR_ANALYTICS_TARGET_TOTAL}');
    expect(deployScript).toContain('Environment=VISITOR_ANALYTICS_GROWTH_START_DATE=${DEPLOY_VISITOR_ANALYTICS_GROWTH_START_DATE}');
  });

  it('keeps WeChat credentials in server environment variables and subscription data in shared storage', () => {
    expect(deployScript).toContain('DEPLOY_WX_APP_SECRET="${DEPLOY_WX_APP_SECRET:-}"');
    expect(deployScript).toContain('Environment=WX_APP_SECRET=${DEPLOY_WX_APP_SECRET}');
    expect(deployScript).toContain('Environment=WX_SUBSCRIPTION_FILE=${DEPLOY_PATH}/shared/wechat-subscriptions.json');
    expect(deployScript).not.toContain('5280d9914ef2cf0fe1a926e9000d693a');
  });

  it('keeps optional sibling static projects outside the LOF release directory', () => {
    expect(deployScript).toContain('DEPLOY_STATIC_ROOT="${DEPLOY_STATIC_ROOT:-/srv/www}"');
    expect(deployScript).toContain('DEPLOY_STATIC_INCLUDE_DIR="${DEPLOY_STATIC_INCLUDE_DIR:-/etc/nginx/includes/static-projects}"');
    expect(deployScript).toContain('DEPLOY_STATIC_PROJECTS="${DEPLOY_STATIC_PROJECTS:-}"');
    expect(deployScript).toContain("DEPLOY_STATIC_ROOT='$DEPLOY_STATIC_ROOT'");
    expect(deployScript).toContain("DEPLOY_STATIC_INCLUDE_DIR='$DEPLOY_STATIC_INCLUDE_DIR'");
    expect(deployScript).toContain("DEPLOY_STATIC_PROJECTS='$DEPLOY_STATIC_PROJECTS'");
    expect(deployScript).toContain('mkdir -p "$STATIC_INCLUDE_DIR"');
    expect(deployScript).toContain('mkdir -p "$STATIC_ROOT/$project"');
    expect(deployScript).toContain('project_path="/${project}"');
    expect(deployScript).toContain('location = ${project_path}');
    expect(deployScript).toContain('return 301 ${project_path}/;');
    expect(deployScript).toContain('cat >"$STATIC_INCLUDE_DIR/${project}.conf"');
    expect(deployScript).toContain('location ^~ /${project}/');
    expect(deployScript).toContain('alias ${STATIC_ROOT}/${project}/;');
    expect(deployScript).toContain('try_files \\$uri \\$uri/ /${project}/index.html;');
    expect(deployScript).toContain('include ${STATIC_INCLUDE_DIR}/*.conf;');
    expect(deployScript).not.toContain('add_header Cache-Control \\"no-store');

    expect(nginxDefault).toContain('include /etc/nginx/includes/static-projects/*.conf;');
  });

  it('keeps an nginx include slot for independently deployed API environments', () => {
    expect(deployScript).toContain('DEPLOY_API_INCLUDE_DIR="${DEPLOY_API_INCLUDE_DIR:-/etc/nginx/includes/lof-api}"');
    expect(deployScript).toContain('include ${API_INCLUDE_DIR}/*.conf;');
    expect(nginxDefault).toContain('include /etc/nginx/includes/lof-api/*.conf;');
  });

  it('migrates the old /person-website homepage to the root and removes the old route', () => {
    expect(deployScript).toContain('DEPLOY_LEGACY_STATIC_PROJECTS="${DEPLOY_LEGACY_STATIC_PROJECTS:-person-website}"');
    expect(deployScript).toContain("DEPLOY_HOME_ROOT='$DEPLOY_HOME_ROOT'");
    expect(deployScript).toContain("DEPLOY_LEGACY_STATIC_PROJECTS='$DEPLOY_LEGACY_STATIC_PROJECTS'");
    expect(deployScript).toContain('migrate_homepage_from_legacy_project');
    expect(deployScript).toContain('cleanup_legacy_static_projects');
    expect(deployScript).toContain('cp -a "$legacy_dir/." "$HOME_ROOT/"');
    expect(deployScript).toContain('rm -f "$STATIC_INCLUDE_DIR/${project}.conf"');
    expect(deployScript).toContain('rm -rf "$STATIC_ROOT/$project"');
    expect(deployScript).not.toContain('DEPLOY_STATIC_PROJECTS="${DEPLOY_STATIC_PROJECTS:-person-website}"');
  });

  it('injects personal homepage analytics without requiring local homepage source', () => {
    expect(deployScript).toContain('install_homepage_analytics_script');
    expect(deployScript).toContain('cat >"$HOME_ROOT/lof-analytics.js"');
    expect(deployScript).toContain("var project = 'personal';");
    expect(deployScript).toContain("var storageKey = 'personal-website-visitor-device-id';");
    expect(deployScript).toContain("window.fetch('/api/analytics/visit'");
    expect(deployScript).toContain('project: project');
    expect(deployScript).toContain('<script defer src="/lof-analytics.js" data-project="personal"></script>');
    expect(deployScript).toContain("html.includes('/lof-analytics.js')");
  });
});

describe('isolated test API deployment', () => {
  it('uses separate service, port, release path, and persistent files', () => {
    expect(testDeployScript).toContain('TEST_DEPLOY_PATH="${TEST_DEPLOY_PATH:-/srv/lof-test}"');
    expect(testDeployScript).toContain('TEST_DEPLOY_SERVICE="${TEST_DEPLOY_SERVICE:-lof-premium-radar-test}"');
    expect(testDeployScript).toContain('TEST_APP_PORT="${TEST_APP_PORT:-4174}"');
    expect(testDeployScript).toContain('TEST_PUBLIC_PATH="${TEST_PUBLIC_PATH:-/dev}"');
    expect(testDeployScript).toContain('TEST_DEPLOY_PATH matches production');
    expect(testDeployScript).toContain('TEST_DEPLOY_SERVICE matches production');
    expect(testDeployScript).toContain('TEST_APP_PORT matches production');
    expect(testDeployScript).toContain('Environment=FUND_SNAPSHOT_FILE=${TEST_DEPLOY_PATH}/shared/fund-snapshots.json');
    expect(testDeployScript).toContain('Environment=VISITOR_ANALYTICS_FILE=${TEST_DEPLOY_PATH}/shared/visitor-analytics.json');
    expect(testDeployScript).toContain('Environment=WX_SUBSCRIPTION_FILE=${TEST_DEPLOY_PATH}/shared/wechat-subscriptions.json');
    expect(testDeployScript).toContain('fund-quotes:snapshot:${category}:trends:0');
  });

  it('publishes only the /dev/api route and labels test responses', () => {
    expect(testDeployScript).toContain('location ^~ ${TEST_PUBLIC_PATH}/api/');
    expect(testDeployScript).toContain('proxy_pass http://127.0.0.1:${TEST_APP_PORT}/api/;');
    expect(testDeployScript).toContain('add_header X-API-Environment "test" always;');
    expect(testDeployScript).toContain('^x-api-environment: test');
    expect(testDeployScript).not.toContain('location /api/');
    expect(testDeployScript).toContain("grep -Eq 'listen[[:space:]]+.*443'");
    expect(testDeployScript).toContain('routing_nginx_conf="$candidate"');
  });

  it('does not run production notification side effects in the test process', () => {
    expect(testDeployScript).toContain('Environment=API_ENV=test');
    expect(testDeployScript).toContain('Environment=DISABLE_STARTUP_CACHE_WARMUP=1');
    expect(testDeployScript).toContain('Environment=DISABLE_WECHAT_SUBSCRIPTION_SCHEDULER=1');
    expect(testDeployScript).toContain('Environment=WX_MINIPROGRAM_STATE=developer');
    expect(serverIndex).toContain("process.env.DISABLE_WECHAT_SUBSCRIPTION_SCHEDULER !== '1'");
    expect(serverIndex).toContain("process.env.DISABLE_STARTUP_CACHE_WARMUP !== '1'");
  });

  it('gates detail deployment on traceable Sina scale and exchange turnover rate', () => {
    expect(testDeployScript).toContain('local detail_code="501225"');
    expect(testDeployScript).toContain('fundScaleSource === "sina"');
    expect(testDeployScript).toContain('row.turnoverRateBasis === "volumeShares/exchangeShare"');
    expect(testDeployScript).toContain('["share", "lot"].includes(row.turnoverRateVolumeUnit)');
    expect(testDeployScript).toContain('!fundScaleValid');
    expect(testDeployScript).toContain('!turnoverRateValid');
    expect(testDeployScript).toContain('completeEstimateValid');
    expect(testDeployScript).toContain('missingEstimateValid');
    expect(testDeployScript).toContain('row.premiumNote === "今日估算净值暂无数据"');
  });

  it('points non-release mini program builds at the test API base', () => {
    expect(miniProgramConfig).toContain("devApiBaseUrl: 'https://jijiking.top/dev'");
    expect(miniProgramConfig).toContain("apiBaseUrl: 'https://jijiking.top'");
  });

  it('smoke tests complete, traceable financial rows before accepting the test release', () => {
    expect(testDeployScript).toContain('/api/funds/quotes');
    expect(testDeployScript).toContain('"category":"ALL"');
    expect(testDeployScript).toContain('Number(row.marketPrice) > 0');
    expect(testDeployScript).toContain('Number(row.lastNav) > 0');
    expect(testDeployScript).toContain('Number(row.estimatedNav) > 0');
    expect(testDeployScript).toContain('Number.isFinite(Number(row.premiumRate))');
    expect(testDeployScript).toContain('row.estimatedNavSource');
    expect(testDeployScript).toContain('row.estimatedNavTime');
    expect(testDeployScript).toContain('--max-time 1.5');
    expect(testDeployScript).toContain('verify_test_detail_data');
    expect(testDeployScript).toContain('row.marketValueBasis === "marketPrice*exchangeShare"');
    expect(testDeployScript).toContain('Test API detail smoke test retrying');
    expect(testDeployScript).toContain('verify_test_home_stability');
    expect(testDeployScript).toContain('Test API homepage stability failed');
    expect(testDeployScript).toContain('Test API homepage stability retrying');
    expect(testDeployScript).toContain('row.source');
    expect(testDeployScript).toContain('row.updateTime || row.quoteTime');
    expect(testDeployScript).toContain('for attempt in $(seq 1 12)');
    expect(testDeployScript).toContain('Test API financial-data smoke test retrying');
  });
});
