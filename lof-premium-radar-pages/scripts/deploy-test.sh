#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRODUCTION_ENV_FILE="${DEPLOY_ENV_FILE:-$ROOT_DIR/.env.deploy}"
TEST_ENV_FILE="${TEST_DEPLOY_ENV_FILE:-$ROOT_DIR/.env.test.deploy}"

if [[ -f "$PRODUCTION_ENV_FILE" ]]; then
  # Reuse only the server connection and existing app credentials.
  # shellcheck source=/dev/null
  source "$PRODUCTION_ENV_FILE"
fi
if [[ -f "$TEST_ENV_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$TEST_ENV_FILE"
fi

DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_DOMAIN="${DEPLOY_DOMAIN:-jijiking.top}"
DEPLOY_SSH_KEY="${DEPLOY_SSH_KEY:-}"
PRODUCTION_DEPLOY_PATH="${DEPLOY_PATH:-/srv/lof}"
PRODUCTION_DEPLOY_SERVICE="${DEPLOY_SERVICE:-lof-premium-radar}"
PRODUCTION_APP_PORT="${APP_PORT:-4173}"
TEST_DEPLOY_PATH="${TEST_DEPLOY_PATH:-/srv/lof-test}"
TEST_DEPLOY_SERVICE="${TEST_DEPLOY_SERVICE:-lof-premium-radar-test}"
TEST_APP_PORT="${TEST_APP_PORT:-4174}"
TEST_PUBLIC_PATH="${TEST_PUBLIC_PATH:-/dev}"
TEST_API_INCLUDE_DIR="${TEST_API_INCLUDE_DIR:-/etc/nginx/includes/lof-api}"
TEST_DEPLOY_SKIP_TESTS="${TEST_DEPLOY_SKIP_TESTS:-0}"
TEST_DEPLOY_SMOKE_URL="${TEST_DEPLOY_SMOKE_URL:-${DEPLOY_SMOKE_URL:-}}"
TEST_ADMIN_PASSWORD="${TEST_ADMIN_PASSWORD:-${DEPLOY_ADMIN_PASSWORD:-53123}}"
TEST_WX_APP_ID="${TEST_WX_APP_ID:-${DEPLOY_WX_APP_ID:-wxd827a0e78b5ce07a}}"
TEST_WX_APP_SECRET="${TEST_WX_APP_SECRET:-${DEPLOY_WX_APP_SECRET:-}}"
TEST_WX_SUBSCRIBE_TEMPLATE_ID="${TEST_WX_SUBSCRIBE_TEMPLATE_ID:-${DEPLOY_WX_SUBSCRIBE_TEMPLATE_ID:-nChCRD1ljtNdWE20NSZIogo5tYX5sX4xP4UPEdZVLyM}}"

TEST_PUBLIC_PATH="/${TEST_PUBLIC_PATH#/}"
TEST_PUBLIC_PATH="${TEST_PUBLIC_PATH%/}"

if [[ -z "$DEPLOY_HOST" ]]; then
  echo "Missing DEPLOY_HOST. Configure it in $PRODUCTION_ENV_FILE." >&2
  exit 1
fi
if [[ "$TEST_DEPLOY_PATH" == "$PRODUCTION_DEPLOY_PATH" ]]; then
  echo "Refusing test deployment: TEST_DEPLOY_PATH matches production." >&2
  exit 1
fi
if [[ "$TEST_DEPLOY_SERVICE" == "$PRODUCTION_DEPLOY_SERVICE" ]]; then
  echo "Refusing test deployment: TEST_DEPLOY_SERVICE matches production." >&2
  exit 1
fi
if [[ "$TEST_APP_PORT" == "$PRODUCTION_APP_PORT" ]]; then
  echo "Refusing test deployment: TEST_APP_PORT matches production." >&2
  exit 1
fi
if [[ ! "$TEST_PUBLIC_PATH" =~ ^/[a-zA-Z0-9._-]+$ ]] || [[ "$TEST_PUBLIC_PATH" == "/lof" ]]; then
  echo "Invalid or production-conflicting TEST_PUBLIC_PATH: $TEST_PUBLIC_PATH" >&2
  exit 1
fi

if [[ -z "$TEST_DEPLOY_SMOKE_URL" ]]; then
  TEST_DEPLOY_SMOKE_URL="https://${DEPLOY_DOMAIN}"
fi

for command in npm tar ssh scp curl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 1
  fi
done

SSH_OPTS=(-p "$DEPLOY_PORT" -o StrictHostKeyChecking=accept-new)
SCP_OPTS=(-P "$DEPLOY_PORT" -o StrictHostKeyChecking=accept-new)
if [[ -n "$DEPLOY_SSH_KEY" ]]; then
  SSH_OPTS+=(-i "$DEPLOY_SSH_KEY")
  SCP_OPTS+=(-i "$DEPLOY_SSH_KEY")
fi

REMOTE="$DEPLOY_USER@$DEPLOY_HOST"
ARCHIVE="$(mktemp -t lof-premium-radar-test.XXXXXX.tar.gz)"
REMOTE_ARCHIVE="/tmp/lof-premium-radar-test-${USER:-deploy}-$(date +%s).tar.gz"

cleanup() {
  rm -f "$ARCHIVE"
}
trap cleanup EXIT

echo "==> Checking SSH access"
if ! ssh "${SSH_OPTS[@]}" -o BatchMode=yes -o ConnectTimeout=8 "$REMOTE" "echo SSH_OK" >/dev/null 2>&1; then
  echo "SSH preflight failed for $REMOTE. Check $PRODUCTION_ENV_FILE." >&2
  exit 1
fi

echo "==> Checking test release"
cd "$ROOT_DIR"
npm run check:server
if [[ "$TEST_DEPLOY_SKIP_TESTS" != "1" ]]; then
  npm run test
fi

echo "==> Packing isolated test release"
COPYFILE_DISABLE=1 tar --no-xattrs \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.cache' \
  -czf "$ARCHIVE" \
  server data package.json package-lock.json

echo "==> Uploading test release"
ssh "${SSH_OPTS[@]}" "$REMOTE" "mkdir -p '$TEST_DEPLOY_PATH/releases' '$TEST_DEPLOY_PATH/shared'"
scp "${SCP_OPTS[@]}" "$ARCHIVE" "$REMOTE:$REMOTE_ARCHIVE"

echo "==> Installing isolated test service"
ssh "${SSH_OPTS[@]}" "$REMOTE" \
  "TEST_DEPLOY_PATH='$TEST_DEPLOY_PATH' \
   TEST_DEPLOY_SERVICE='$TEST_DEPLOY_SERVICE' \
   TEST_APP_PORT='$TEST_APP_PORT' \
   TEST_PUBLIC_PATH='$TEST_PUBLIC_PATH' \
   TEST_API_INCLUDE_DIR='$TEST_API_INCLUDE_DIR' \
   TEST_ADMIN_PASSWORD='$TEST_ADMIN_PASSWORD' \
   TEST_WX_APP_ID='$TEST_WX_APP_ID' \
   TEST_WX_APP_SECRET='$TEST_WX_APP_SECRET' \
   TEST_WX_SUBSCRIBE_TEMPLATE_ID='$TEST_WX_SUBSCRIBE_TEMPLATE_ID' \
   DEPLOY_DOMAIN='$DEPLOY_DOMAIN' \
   PRODUCTION_DEPLOY_SERVICE='$PRODUCTION_DEPLOY_SERVICE' \
   PRODUCTION_APP_PORT='$PRODUCTION_APP_PORT' \
   REMOTE_ARCHIVE='$REMOTE_ARCHIVE' \
   bash -s" <<'REMOTE_SCRIPT'
set -Eeuo pipefail

release_dir="$TEST_DEPLOY_PATH/releases/$(date +%Y%m%d%H%M%S)"
production_nginx_conf="/etc/nginx/conf.d/${PRODUCTION_DEPLOY_SERVICE}.conf"
test_nginx_conf="${TEST_API_INCLUDE_DIR}/${TEST_DEPLOY_SERVICE}.conf"
routing_nginx_conf=""

for candidate in /etc/nginx/conf.d/*.conf; do
  if grep -Fq "server_name ${DEPLOY_DOMAIN}" "$candidate" && grep -Eq 'listen[[:space:]]+.*443' "$candidate"; then
    routing_nginx_conf="$candidate"
    break
  fi
done
if [[ -z "$routing_nginx_conf" ]]; then
  routing_nginx_conf="$production_nginx_conf"
fi

wait_for_test_app() {
  local health_url="http://127.0.0.1:${TEST_APP_PORT}/api/health"
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 2 "$health_url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  systemctl --no-pager --full status "$TEST_DEPLOY_SERVICE" | sed -n '1,80p' >&2 || true
  journalctl -u "$TEST_DEPLOY_SERVICE" --no-pager -n 80 >&2 || true
  return 1
}

mkdir -p "$release_dir" "$TEST_DEPLOY_PATH/shared" "$TEST_API_INCLUDE_DIR"
tar -xzf "$REMOTE_ARCHIVE" -C "$release_dir"
rm -f "$REMOTE_ARCHIVE"

cd "$release_dir"
npm ci --omit=dev

# Seed only the test snapshot file from the currently served production API.
# This is a read-only production request and never writes into production storage.
snapshot_seed="$(mktemp)"
if [[ ! -s "$TEST_DEPLOY_PATH/shared/fund-snapshots.json" ]] \
  && curl -fsS --max-time 8 "http://127.0.0.1:${PRODUCTION_APP_PORT}/api/funds/quotes?category=ALL&trends=0" >"$snapshot_seed" 2>/dev/null; then
  SNAPSHOT_INPUT="$snapshot_seed" \
  SNAPSHOT_OUTPUT="$TEST_DEPLOY_PATH/shared/fund-snapshots.json" \
  node <<'EOF'
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync(process.env.SNAPSHOT_INPUT, 'utf8'));
const rows = Array.isArray(payload?.rows) ? payload.rows : [];
if (rows.length > 0) {
  const snapshots = { 'fund-quotes:snapshot:ALL:trends:0': payload };
  for (const category of ['LOF', 'QDII', 'ETF']) {
    const categoryRows = rows.filter((row) => String(row.category || row.fundType || '').toUpperCase() === category);
    if (!categoryRows.length) continue;
    snapshots[`fund-quotes:snapshot:${category}:trends:0`] = {
      ...payload,
      meta: {
        ...(payload.meta || {}),
        rowCount: categoryRows.length,
        allCount: categoryRows.length,
        filteredCount: categoryRows.length,
        totalCount: categoryRows.length,
      },
      rows: categoryRows,
    };
  }
  fs.writeFileSync(process.env.SNAPSHOT_OUTPUT, JSON.stringify({
    version: 1,
    savedAt: new Date().toISOString(),
    snapshots,
  }));
}
EOF
fi
rm -f "$snapshot_seed"

ln -sfn "$release_dir" "$TEST_DEPLOY_PATH/current"

cat >"/etc/systemd/system/${TEST_DEPLOY_SERVICE}.service" <<EOF
[Unit]
Description=LOF Premium Radar Test API
After=network.target

[Service]
Type=simple
WorkingDirectory=${TEST_DEPLOY_PATH}/current
Environment=NODE_ENV=production
Environment=API_ENV=test
Environment=PORT=${TEST_APP_PORT}
Environment=DISABLE_STARTUP_CACHE_WARMUP=1
Environment=DISABLE_FUND_SNAPSHOT_SCHEDULER=1
Environment=DISABLE_WECHAT_SUBSCRIPTION_SCHEDULER=1
Environment=ADMIN_PASSWORD=${TEST_ADMIN_PASSWORD}
Environment=VISITOR_ANALYTICS_FILE=${TEST_DEPLOY_PATH}/shared/visitor-analytics.json
Environment=FUND_SNAPSHOT_FILE=${TEST_DEPLOY_PATH}/shared/fund-snapshots.json
Environment=VISITOR_ANALYTICS_TARGET_TOTAL=0
Environment=WX_APP_ID=${TEST_WX_APP_ID}
Environment=WX_APP_SECRET=${TEST_WX_APP_SECRET}
Environment=WX_SUBSCRIBE_TEMPLATE_ID=${TEST_WX_SUBSCRIBE_TEMPLATE_ID}
Environment=WX_SUBSCRIPTION_FILE=${TEST_DEPLOY_PATH}/shared/wechat-subscriptions.json
Environment=WX_MINIPROGRAM_STATE=developer
ExecStart=/usr/bin/env node server/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$TEST_DEPLOY_SERVICE"
systemctl restart "$TEST_DEPLOY_SERVICE"
wait_for_test_app

cat >"$test_nginx_conf" <<EOF
    location = ${TEST_PUBLIC_PATH}/api {
        return 308 ${TEST_PUBLIC_PATH}/api/;
    }

    location ^~ ${TEST_PUBLIC_PATH}/api/ {
        proxy_pass http://127.0.0.1:${TEST_APP_PORT}/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        add_header X-API-Environment "test" always;
        add_header Cache-Control "no-store" always;
    }
EOF

if [[ ! -f "$routing_nginx_conf" ]]; then
  echo "Public nginx config not found: $routing_nginx_conf" >&2
  exit 1
fi

# Bootstrap the include slot once on servers deployed before test API support.
if ! grep -Fq "include ${TEST_API_INCLUDE_DIR}/*.conf;" "$routing_nginx_conf"; then
  if [[ "$(tail -n 1 "$routing_nginx_conf" | tr -d '[:space:]')" != "}" ]]; then
    echo "Cannot safely add test API include to $routing_nginx_conf" >&2
    exit 1
  fi
  cp "$routing_nginx_conf" "${routing_nginx_conf}.before-test-api"
  sed -i '$i\    include '"${TEST_API_INCLUDE_DIR}"'/*.conf;\n' "$routing_nginx_conf"
fi

if ! nginx -t; then
  if [[ -f "${routing_nginx_conf}.before-test-api" ]]; then
    mv "${routing_nginx_conf}.before-test-api" "$routing_nginx_conf"
  fi
  rm -f "$test_nginx_conf"
  nginx -t || true
  exit 1
fi
rm -f "${routing_nginx_conf}.before-test-api"
systemctl reload nginx

find "$TEST_DEPLOY_PATH/releases" -mindepth 1 -maxdepth 1 -type d | sort | head -n -5 | xargs -r rm -rf
systemctl --no-pager --full status "$TEST_DEPLOY_SERVICE" | sed -n '1,12p'
REMOTE_SCRIPT

echo "==> Verifying public test API route"
headers_file="$(mktemp -t lof-test-api-headers.XXXXXX)"
trap 'rm -f "$ARCHIVE" "$headers_file"' EXIT
curl -fsS --max-time 20 -D "$headers_file" -o /dev/null \
  "${TEST_DEPLOY_SMOKE_URL%/}${TEST_PUBLIC_PATH}/api/health"
if ! grep -qi '^x-api-environment: test' "$headers_file"; then
  echo "Test API smoke test failed: environment header is missing." >&2
  exit 1
fi

verify_test_financial_data() {
  curl -fsS --max-time 1.5 \
    -X POST "${TEST_DEPLOY_SMOKE_URL%/}${TEST_PUBLIC_PATH}/api/funds/quotes" \
    -H 'Content-Type: application/json' \
    -d '{"category":"ALL","fields":"home","trends":"0","page":"1","pageSize":"20"}' | node -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const payload = JSON.parse(input);
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const validEstimateDate = (row) => {
    const estimateDate = String(row.estimatedNavTime || "").slice(0, 10);
    const quoteDate = String(row.quoteTime || "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(estimateDate)
      && estimateDate <= today
      && (!/^\d{4}-\d{2}-\d{2}$/.test(quoteDate) || estimateDate >= quoteDate);
  };
  const total = Number(payload?.meta?.pagination?.total || 0);
  const invalid = rows.filter((row) =>
    !(Number(row.marketPrice) > 0) ||
    !(Number(row.lastNav) > 0) ||
    !(Number(row.estimatedNav) > 0) ||
    !Number.isFinite(Number(row.premiumRate)) ||
    !Number.isFinite(Number(row.officialPremiumRate)) ||
    Math.abs(Number(row.premiumRate) - ((Number(row.marketPrice) / Number(row.estimatedNav) - 1) * 100)) > 0.02 ||
    !String(row.estimatedNavSource || "").trim() ||
    !validEstimateDate(row) ||
    !row.source ||
    !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(String(row.updateTime || row.quoteTime || ""))
  );
  if (!rows.length || total < 80 || invalid.length) {
    console.error("Test API financial-data smoke test failed");
    console.error(JSON.stringify({ rowCount: rows.length, total, invalid: invalid.slice(0, 5) }, null, 2));
    process.exit(1);
  }
  console.log(`Test API smoke test passed: ${rows.length} complete LOF rows`);
});
'
}

verify_test_detail_data() {
  local detail_code="501225"

  curl -fsS --max-time 1.5 \
    "${TEST_DEPLOY_SMOKE_URL%/}${TEST_PUBLIC_PATH}/api/funds/${detail_code}?category=LOF" | node -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const row = JSON.parse(input);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const estimateDate = String(row.estimatedNavTime || "").slice(0, 10);
  const quoteDate = String(row.quoteTime || "").slice(0, 10);
  const estimateDateValid = /^\d{4}-\d{2}-\d{2}$/.test(estimateDate)
    && estimateDate <= today
    && (!/^\d{4}-\d{2}-\d{2}$/.test(quoteDate) || estimateDate >= quoteDate);
  const formula = ((Number(row.marketPrice) / Number(row.estimatedNav)) - 1) * 100;
  const marketValueValid = Object.prototype.hasOwnProperty.call(row, "marketValue")
    && (!(Number(row.marketValue) > 0) || (
      row.marketValueBasis === "marketPrice*exchangeShare"
      && String(row.marketValueSource || "").trim()
      && String(row.shareTime || "").trim()
    ));
  const fundScaleValid = Number(row.fundScale) > 0
    && row.fundScaleSource === "sina"
    && /^\d{4}-\d{2}-\d{2}$/.test(String(row.fundScaleDate || ""))
    && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(row.fundScaleTime || ""));
  const turnoverRateValid = Number.isFinite(Number(row.turnoverRate))
    && Number(row.turnoverRate) >= 0
    && row.turnoverRateBasis === "volumeShares/exchangeShare"
    && ["share", "lot"].includes(row.turnoverRateVolumeUnit)
    && String(row.turnoverRateSource || "").trim()
    && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(row.turnoverRateTime || ""));
  if (!(Number(row.marketPrice) > 0)
    || !(Number(row.estimatedNav) > 0)
    || !estimateDateValid
    || !Number.isFinite(Number(row.premiumRate))
    || Math.abs(Number(row.premiumRate) - formula) > 0.02
    || !marketValueValid
    || !fundScaleValid
    || !turnoverRateValid) {
    console.error("Test API detail smoke test failed");
    console.error(JSON.stringify(row, null, 2));
    process.exit(1);
  }
  console.log(`Test detail smoke test passed: ${row.code}`);
});
'
}

verify_test_home_stability() {
  local totals=()
  local total
  for _ in $(seq 1 5); do
    total="$(curl -fsS --max-time 1.5 \
      -X POST "${TEST_DEPLOY_SMOKE_URL%/}${TEST_PUBLIC_PATH}/api/funds/quotes" \
      -H 'Content-Type: application/json' \
      -d '{"category":"ALL","fields":"home","trends":"0","page":"1","pageSize":"20"}' \
      | node -e 'let input="";process.stdin.on("data",c=>input+=c);process.stdin.on("end",()=>{const p=JSON.parse(input);const total=Number(p?.meta?.pagination?.total);if(!(total>0))process.exit(1);process.stdout.write(String(total));});')"
    totals+=("$total")
    sleep 1
  done
  local first="${totals[0]}"
  for total in "${totals[@]}"; do
    if [[ "$total" != "$first" ]]; then
      echo "Test API homepage stability failed: ${totals[*]}" >&2
      return 1
    fi
  done
  echo "Test homepage stability passed: ${first} rows x ${#totals[@]}"
}

for attempt in $(seq 1 12); do
  if verify_test_financial_data; then
    break
  fi
  if [[ "$attempt" == "12" ]]; then
    exit 1
  fi
  echo "Test API financial-data smoke test retrying: attempt ${attempt}/12" >&2
  sleep 5
done

for attempt in $(seq 1 6); do
  if verify_test_home_stability; then
    break
  fi
  if [[ "$attempt" == "6" ]]; then
    exit 1
  fi
  echo "Test API homepage stability retrying: attempt ${attempt}/6" >&2
  sleep 5
done

for attempt in $(seq 1 12); do
  if verify_test_detail_data; then
    break
  fi
  if [[ "$attempt" == "12" ]]; then
    exit 1
  fi
  echo "Test API detail smoke test retrying: attempt ${attempt}/12" >&2
  sleep 5
done

echo "==> Test API deployed"
echo "Test API base URL: ${TEST_DEPLOY_SMOKE_URL%/}${TEST_PUBLIC_PATH}"
echo "Quotes URL: ${TEST_DEPLOY_SMOKE_URL%/}${TEST_PUBLIC_PATH}/api/funds/quotes"
