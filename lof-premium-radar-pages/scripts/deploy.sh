#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${DEPLOY_ENV_FILE:-$ROOT_DIR/.env.deploy}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$ENV_FILE"
fi

DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_PATH="${DEPLOY_PATH:-/srv/lof}"
DEPLOY_SERVICE="${DEPLOY_SERVICE:-lof-premium-radar}"
DEPLOY_DOMAIN="${DEPLOY_DOMAIN:-_}"
DEPLOY_SSH_KEY="${DEPLOY_SSH_KEY:-}"
DEPLOY_SKIP_TESTS="${DEPLOY_SKIP_TESTS:-0}"
APP_PORT="${APP_PORT:-4173}"
DEPLOY_SMOKE_URL="${DEPLOY_SMOKE_URL:-}"
DEPLOY_ADMIN_PASSWORD="${DEPLOY_ADMIN_PASSWORD:-53123}"

if [[ -z "$DEPLOY_HOST" ]]; then
  cat <<EOF >&2
Missing DEPLOY_HOST.

Create $ENV_FILE first, for example:
  DEPLOY_HOST=1.2.3.4
  DEPLOY_USER=root
  DEPLOY_PATH=/srv/lof
  DEPLOY_DOMAIN=_
EOF
  exit 1
fi

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need_cmd npm
need_cmd tar
need_cmd ssh
need_cmd scp
need_cmd curl

SSH_OPTS=(-p "$DEPLOY_PORT" -o StrictHostKeyChecking=accept-new)
SCP_OPTS=(-P "$DEPLOY_PORT" -o StrictHostKeyChecking=accept-new)
if [[ -n "$DEPLOY_SSH_KEY" ]]; then
  SSH_OPTS+=(-i "$DEPLOY_SSH_KEY")
  SCP_OPTS+=(-i "$DEPLOY_SSH_KEY")
fi

REMOTE="$DEPLOY_USER@$DEPLOY_HOST"
ARCHIVE="$(mktemp -t lof-premium-radar.XXXXXX.tar.gz)"
REMOTE_ARCHIVE="/tmp/lof-premium-radar-${USER:-deploy}-$(date +%s).tar.gz"
if [[ -z "$DEPLOY_SMOKE_URL" ]]; then
  SMOKE_HOST="$DEPLOY_DOMAIN"
  if [[ -z "$SMOKE_HOST" || "$SMOKE_HOST" == "_" ]]; then
    SMOKE_HOST="$DEPLOY_HOST"
  fi
  DEPLOY_SMOKE_URL="http://${SMOKE_HOST}"
fi

cleanup() {
  rm -f "$ARCHIVE"
}
trap cleanup EXIT

check_ssh_connection() {
  if ssh "${SSH_OPTS[@]}" -o BatchMode=yes -o ConnectTimeout=8 "$REMOTE" "echo SSH_OK" >/dev/null 2>&1; then
    return 0
  fi

  local public_key_message=""
  if [[ -n "$DEPLOY_SSH_KEY" && -f "${DEPLOY_SSH_KEY}.pub" ]]; then
    public_key_message="
Public key to install:
$(cat "${DEPLOY_SSH_KEY}.pub")
"
  fi

  cat <<EOF >&2
SSH preflight failed: cannot login to $REMOTE.

Check these Aliyun ECS settings before running npm run deploy:
  1. DEPLOY_HOST points to the ECS public IP.
  2. Security group allows inbound TCP ${DEPLOY_PORT} from your current network.
  3. The SSH public key matching DEPLOY_SSH_KEY is installed for ${DEPLOY_USER}.
  4. If root SSH login is disabled, set DEPLOY_USER to a sudo-capable user.

Current deploy config file: $ENV_FILE
Current DEPLOY_SSH_KEY: ${DEPLOY_SSH_KEY:-not set}
${public_key_message}

If you want me to finish this from the Aliyun console, open the ECS instance page and confirm I may add the local public key to the server login configuration.
EOF
  exit 1
}

echo "==> Checking SSH access"
check_ssh_connection

echo "==> Checking project"
cd "$ROOT_DIR"
npm run typecheck
if [[ "$DEPLOY_SKIP_TESTS" != "1" ]]; then
  npm run test
fi

echo "==> Building"
npm run build

echo "==> Packing release"
tar \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.cache' \
  --exclude='dist/.vite' \
  -czf "$ARCHIVE" \
  dist server data public package.json package-lock.json nginx-default.conf .nojekyll .spa

echo "==> Uploading to $REMOTE:$DEPLOY_PATH"
ssh "${SSH_OPTS[@]}" "$REMOTE" "mkdir -p '$DEPLOY_PATH/releases' '$DEPLOY_PATH/shared'"
scp "${SCP_OPTS[@]}" "$ARCHIVE" "$REMOTE:$REMOTE_ARCHIVE"

echo "==> Installing release on server"
ssh "${SSH_OPTS[@]}" "$REMOTE" \
  "DEPLOY_PATH='$DEPLOY_PATH' \
   DEPLOY_SERVICE='$DEPLOY_SERVICE' \
   DEPLOY_DOMAIN='$DEPLOY_DOMAIN' \
   APP_PORT='$APP_PORT' \
   ADMIN_PASSWORD='$DEPLOY_ADMIN_PASSWORD' \
   REMOTE_ARCHIVE='$REMOTE_ARCHIVE' \
   bash -s" <<'REMOTE_SCRIPT'
set -Eeuo pipefail

release_dir="$DEPLOY_PATH/releases/$(date +%Y%m%d%H%M%S)"

install_server_dependencies() {
  local need_apt_update=0

  if ! command -v curl >/dev/null 2>&1 || ! command -v ca-certificates >/dev/null 2>&1; then
    need_apt_update=1
  fi

  if ! command -v nginx >/dev/null 2>&1; then
    need_apt_update=1
  fi

  if [[ "$need_apt_update" == "1" ]]; then
    apt-get update
    apt-get install -y curl ca-certificates nginx
  fi

  local node_major=0
  if command -v node >/dev/null 2>&1; then
    node_major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
  fi

  if [[ "$node_major" -lt 20 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
}

wait_for_remote_app() {
  local health_url="http://127.0.0.1:${APP_PORT}/api/health"
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 2 "$health_url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Remote app did not become ready: $health_url" >&2
  systemctl --no-pager --full status "$DEPLOY_SERVICE" | sed -n '1,80p' >&2 || true
  journalctl -u "$DEPLOY_SERVICE" --no-pager -n 80 >&2 || true
  return 1
}

install_server_dependencies

mkdir -p "$release_dir"
tar -xzf "$REMOTE_ARCHIVE" -C "$release_dir"
rm -f "$REMOTE_ARCHIVE"

cd "$release_dir"
npm ci --omit=dev

ln -sfn "$release_dir" "$DEPLOY_PATH/current"
rm -f /etc/nginx/sites-enabled/default

cat >"/etc/systemd/system/${DEPLOY_SERVICE}.service" <<EOF
[Unit]
Description=LOF Premium Radar
After=network.target

[Service]
Type=simple
WorkingDirectory=${DEPLOY_PATH}/current
Environment=NODE_ENV=production
Environment=PORT=${APP_PORT}
Environment=ADMIN_PASSWORD=${ADMIN_PASSWORD}
Environment=VISITOR_ANALYTICS_FILE=${DEPLOY_PATH}/shared/visitor-analytics.json
ExecStart=/usr/bin/env node server/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

cat >"/etc/nginx/conf.d/${DEPLOY_SERVICE}.conf" <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${DEPLOY_DOMAIN};
    root ${DEPLOY_PATH}/current/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:${APP_PORT}/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        add_header Cache-Control "no-store";
    }

    location = /index.html {
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }

    location / {
        try_files \$uri \$uri/ /index.html;
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }

    location /assets/ {
        try_files \$uri =404;
        expires 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }
}
EOF

systemctl daemon-reload
systemctl enable "$DEPLOY_SERVICE"
systemctl restart "$DEPLOY_SERVICE"
wait_for_remote_app
nginx -t
systemctl reload nginx

find "$DEPLOY_PATH/releases" -mindepth 1 -maxdepth 1 -type d | sort | head -n -5 | xargs -r rm -rf

systemctl --no-pager --full status "$DEPLOY_SERVICE" | sed -n '1,12p'
REMOTE_SCRIPT

verify_lof_api() {
  curl -fsS --max-time 60 "${DEPLOY_SMOKE_URL%/}/api/funds/quotes?category=LOF&trends=0&force=1" | node -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    console.error("LOF API smoke test failed: response is not JSON");
    process.exit(1);
  }
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const rowCount = Number(payload?.meta?.rowCount ?? rows.length ?? 0);
  const missingPrice = rows.filter((row) => row.marketPrice === null || row.marketPrice === undefined || row.marketPrice === "" || Number(row.marketPrice) <= 0);
  const missingNav = rows.filter((row) => row.lastNav === null || row.lastNav === undefined || row.lastNav === "");
  const missingPremium = rows.filter((row) => row.premiumRate === null || row.premiumRate === undefined || Number.isNaN(Number(row.premiumRate)));
  const overseasTech = rows.find((row) => row.code === "501312" || row.name === "海外科技LOF");
  if (rowCount !== 53 || rows.length !== 53 || missingPrice.length || missingNav.length || missingPremium.length || !overseasTech || Number(overseasTech.marketPrice) <= 0) {
    console.error("LOF API smoke test failed: deployed LOF data is incomplete");
    console.error(JSON.stringify({
      rowCount,
      rowsLength: rows.length,
      missingPrice: missingPrice.map((row) => ({ code: row.code, name: row.name })),
      missingNav: missingNav.map((row) => ({ code: row.code, name: row.name })),
      missingPremium: missingPremium.map((row) => ({ code: row.code, name: row.name })),
      overseasTech: overseasTech ? { code: overseasTech.code, name: overseasTech.name, marketPrice: overseasTech.marketPrice } : null,
      status: payload?.meta?.status,
      sourceProvider: payload?.meta?.sourceProvider,
      sourceStatus: payload?.meta?.sourceStatus,
      warn: payload?.meta?.warn,
    }, null, 2));
    process.exit(1);
  }
  console.log(`LOF API smoke test passed: rowCount=${rowCount}, source=${payload?.meta?.sourceProvider || "unknown"}, overseasTechPrice=${overseasTech.marketPrice}`);
});
'
}

echo "==> Verifying deployed LOF API"
for attempt in $(seq 1 5); do
  if verify_lof_api; then
    break
  fi

  if [[ "$attempt" == "5" ]]; then
    exit 1
  fi

  echo "LOF API smoke test retrying: attempt ${attempt}/5" >&2
  sleep 3
done

echo "==> Verifying deployed analytics/admin APIs"
curl -fsS --max-time 20 \
  -X POST "${DEPLOY_SMOKE_URL%/}/api/analytics/visit" \
  -H 'Content-Type: application/json' \
  -d '{"deviceId":"deploy-smoke","path":"/deploy-smoke"}' | node -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const payload = JSON.parse(input);
  if (!payload?.ok) {
    console.error("Analytics API smoke test failed");
    process.exit(1);
  }
  console.log("Analytics API smoke test passed");
});
'

curl -fsS --max-time 20 \
  -X POST "${DEPLOY_SMOKE_URL%/}/api/admin/login" \
  -H 'Content-Type: application/json' \
  -d "{\"password\":\"${DEPLOY_ADMIN_PASSWORD}\"}" | node -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const payload = JSON.parse(input);
  if (!payload?.ok) {
    console.error("Admin API smoke test failed: login rejected");
    process.exit(1);
  }
  console.log("Admin login smoke test passed");
});
'

curl -fsS --max-time 20 \
  "${DEPLOY_SMOKE_URL%/}/api/admin/visitors" \
  -H "X-Admin-Password: ${DEPLOY_ADMIN_PASSWORD}" | node -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const payload = JSON.parse(input);
  if (!Number.isFinite(Number(payload?.totalVisitors))) {
    console.error("Admin API smoke test failed: visitors payload invalid");
    process.exit(1);
  }
  console.log(`Admin visitors smoke test passed: totalVisitors=${payload.totalVisitors}`);
});
'

echo "==> Deployed"
echo "URL: ${DEPLOY_SMOKE_URL%/}"
