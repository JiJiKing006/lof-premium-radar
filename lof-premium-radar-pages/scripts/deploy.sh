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
DEPLOY_DOMAIN="${DEPLOY_DOMAIN:-jijiking.top}"
DEPLOY_SSH_KEY="${DEPLOY_SSH_KEY:-}"
DEPLOY_SKIP_TESTS="${DEPLOY_SKIP_TESTS:-0}"
APP_PORT="${APP_PORT:-4173}"
DEPLOY_SMOKE_URL="${DEPLOY_SMOKE_URL:-}"
DEPLOY_ADMIN_PASSWORD="${DEPLOY_ADMIN_PASSWORD:-53123}"
DEPLOY_STATIC_ROOT="${DEPLOY_STATIC_ROOT:-/srv/www}"
DEPLOY_STATIC_INCLUDE_DIR="${DEPLOY_STATIC_INCLUDE_DIR:-/etc/nginx/includes/static-projects}"
DEPLOY_STATIC_PROJECTS="${DEPLOY_STATIC_PROJECTS:-}"
DEPLOY_LEGACY_STATIC_PROJECTS="${DEPLOY_LEGACY_STATIC_PROJECTS:-person-website}"
DEPLOY_HOME_ROOT="${DEPLOY_HOME_ROOT:-/srv/www/home}"
DEPLOY_LOF_PUBLIC_PATH="${DEPLOY_LOF_PUBLIC_PATH:-/lof}"
DEPLOY_VISITOR_ANALYTICS_TARGET_TOTAL="${DEPLOY_VISITOR_ANALYTICS_TARGET_TOTAL:-273}"
DEPLOY_VISITOR_ANALYTICS_GROWTH_START_DATE="${DEPLOY_VISITOR_ANALYTICS_GROWTH_START_DATE:-2026-06-07}"
LOF_PUBLIC_PATH="/${DEPLOY_LOF_PUBLIC_PATH#/}"
LOF_PUBLIC_PATH="${LOF_PUBLIC_PATH%/}"
LOF_BASE_PATH="${LOF_PUBLIC_PATH}/"

if [[ -z "$DEPLOY_HOST" ]]; then
  cat <<EOF >&2
Missing DEPLOY_HOST.

Create $ENV_FILE first, for example:
  DEPLOY_HOST=1.2.3.4
  DEPLOY_USER=root
  DEPLOY_PATH=/srv/lof
  DEPLOY_DOMAIN=jijiking.top
  DEPLOY_STATIC_ROOT=/srv/www
  DEPLOY_HOME_ROOT=/srv/www/home
  DEPLOY_LOF_PUBLIC_PATH=/lof
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
VITE_BASE_PATH="${VITE_BASE_PATH:-$LOF_BASE_PATH}" npm run build

echo "==> Packing release"
tar \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.cache' \
  --exclude='dist/.vite' \
  -czf "$ARCHIVE" \
  dist server data public package.json package-lock.json nginx-default.conf .nojekyll .spa

echo "==> Uploading to $REMOTE:$DEPLOY_PATH"
ssh "${SSH_OPTS[@]}" "$REMOTE" "mkdir -p '$DEPLOY_PATH/releases' '$DEPLOY_PATH/shared' '$DEPLOY_STATIC_ROOT' '$DEPLOY_HOME_ROOT'"
scp "${SCP_OPTS[@]}" "$ARCHIVE" "$REMOTE:$REMOTE_ARCHIVE"

echo "==> Installing release on server"
ssh "${SSH_OPTS[@]}" "$REMOTE" \
  "DEPLOY_PATH='$DEPLOY_PATH' \
   DEPLOY_SERVICE='$DEPLOY_SERVICE' \
   DEPLOY_DOMAIN='$DEPLOY_DOMAIN' \
   APP_PORT='$APP_PORT' \
   ADMIN_PASSWORD='$DEPLOY_ADMIN_PASSWORD' \
   DEPLOY_STATIC_ROOT='$DEPLOY_STATIC_ROOT' \
   DEPLOY_STATIC_INCLUDE_DIR='$DEPLOY_STATIC_INCLUDE_DIR' \
   DEPLOY_STATIC_PROJECTS='$DEPLOY_STATIC_PROJECTS' \
   DEPLOY_LEGACY_STATIC_PROJECTS='$DEPLOY_LEGACY_STATIC_PROJECTS' \
   DEPLOY_HOME_ROOT='$DEPLOY_HOME_ROOT' \
   DEPLOY_LOF_PUBLIC_PATH='$LOF_PUBLIC_PATH' \
   DEPLOY_VISITOR_ANALYTICS_TARGET_TOTAL='$DEPLOY_VISITOR_ANALYTICS_TARGET_TOTAL' \
   DEPLOY_VISITOR_ANALYTICS_GROWTH_START_DATE='$DEPLOY_VISITOR_ANALYTICS_GROWTH_START_DATE' \
   REMOTE_ARCHIVE='$REMOTE_ARCHIVE' \
   bash -s" <<'REMOTE_SCRIPT'
set -Eeuo pipefail

release_dir="$DEPLOY_PATH/releases/$(date +%Y%m%d%H%M%S)"
STATIC_ROOT="${DEPLOY_STATIC_ROOT:-/srv/www}"
STATIC_INCLUDE_DIR="${DEPLOY_STATIC_INCLUDE_DIR:-/etc/nginx/includes/static-projects}"
STATIC_PROJECTS="${DEPLOY_STATIC_PROJECTS:-}"
LEGACY_STATIC_PROJECTS="${DEPLOY_LEGACY_STATIC_PROJECTS:-person-website}"
HOME_ROOT="${DEPLOY_HOME_ROOT:-/srv/www/home}"
LOF_PUBLIC_PATH="/${DEPLOY_LOF_PUBLIC_PATH#/}"
LOF_PUBLIC_PATH="${LOF_PUBLIC_PATH%/}"

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

install_static_project_locations() {
  local project
  local project_path

  mkdir -p "$STATIC_INCLUDE_DIR"

  for project in $STATIC_PROJECTS; do
    if [[ -z "$project" ]]; then
      continue
    fi

    case "$project" in
      api|assets|admin|*[!a-zA-Z0-9._-]*)
        echo "Invalid DEPLOY_STATIC_PROJECTS entry: $project" >&2
        return 1
        ;;
    esac

    mkdir -p "$STATIC_ROOT/$project"
    project_path="/${project}"
    cat >"$STATIC_INCLUDE_DIR/${project}.conf" <<EOF
    location = ${project_path} {
        return 301 ${project_path}/;
    }

    location ^~ /${project}/ {
        alias ${STATIC_ROOT}/${project}/;
        index index.html;
        try_files \$uri \$uri/ /${project}/index.html;
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }
EOF
  done
}

migrate_homepage_from_legacy_project() {
  local project
  local legacy_dir

  mkdir -p "$HOME_ROOT"

  if [[ -f "$HOME_ROOT/index.html" ]]; then
    return 0
  fi

  for project in $LEGACY_STATIC_PROJECTS; do
    if [[ -z "$project" ]]; then
      continue
    fi

    case "$project" in
      api|assets|admin|*[!a-zA-Z0-9._-]*)
        echo "Invalid DEPLOY_LEGACY_STATIC_PROJECTS entry: $project" >&2
        return 1
        ;;
    esac

    legacy_dir="$STATIC_ROOT/$project"
    if [[ -f "$legacy_dir/index.html" ]]; then
      cp -a "$legacy_dir/." "$HOME_ROOT/"
      return 0
    fi
  done
}

cleanup_legacy_static_projects() {
  local project

  mkdir -p "$STATIC_INCLUDE_DIR"

  for project in $LEGACY_STATIC_PROJECTS; do
    if [[ -z "$project" ]]; then
      continue
    fi

    case "$project" in
      api|assets|admin|*[!a-zA-Z0-9._-]*)
        echo "Invalid DEPLOY_LEGACY_STATIC_PROJECTS entry: $project" >&2
        return 1
        ;;
    esac

    rm -f "$STATIC_INCLUDE_DIR/${project}.conf"
    rm -rf "$STATIC_ROOT/$project"
  done
}

install_homepage_analytics_script() {
  mkdir -p "$HOME_ROOT"

  cat >"$HOME_ROOT/lof-analytics.js" <<'EOF'
(function () {
  var project = 'personal';
  var storageKey = 'personal-website-visitor-device-id';

  function createDeviceId() {
    return 'personal-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function getDeviceId() {
    try {
      var existing = window.localStorage.getItem(storageKey);
      if (existing) return existing;
      var next = createDeviceId();
      window.localStorage.setItem(storageKey, next);
      return next;
    } catch (_) {
      return createDeviceId();
    }
  }

  try {
    window.fetch('/api/analytics/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: getDeviceId(),
        project: project,
        path: window.location.pathname + window.location.search,
      }),
      keepalive: true,
    }).catch(function () {});
  } catch (_) {}
})();
EOF

  if [[ ! -f "$HOME_ROOT/index.html" ]]; then
    return 0
  fi

  HOME_ROOT="$HOME_ROOT" node <<'EOF'
const fs = require('fs');
const path = require('path');
const file = path.join(process.env.HOME_ROOT, 'index.html');
const snippet = '<script defer src="/lof-analytics.js" data-project="personal"></script>';
let html = fs.readFileSync(file, 'utf8');

if (!html.includes('/lof-analytics.js')) {
  if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, `${snippet}\n</body>`);
  } else {
    html = `${html}\n${snippet}\n`;
  }
  fs.writeFileSync(file, html);
}
EOF
}

install_server_dependencies
migrate_homepage_from_legacy_project
install_static_project_locations
cleanup_legacy_static_projects
install_homepage_analytics_script

mkdir -p "$release_dir"
tar -xzf "$REMOTE_ARCHIVE" -C "$release_dir"
rm -f "$REMOTE_ARCHIVE"

cd "$release_dir"
npm ci --omit=dev

ln -sfn "$release_dir" "$DEPLOY_PATH/current"
rm -f /etc/nginx/sites-enabled/default

NGINX_SERVER_NAME="$DEPLOY_DOMAIN"
if [[ -n "$DEPLOY_DOMAIN" && "$DEPLOY_DOMAIN" != "_" ]] && \
  grep -Rsl "server_name ${DEPLOY_DOMAIN}" /etc/nginx/conf.d /etc/nginx/sites-enabled 2>/dev/null | grep -v "/${DEPLOY_SERVICE}.conf$" >/dev/null; then
  NGINX_SERVER_NAME="_"
fi

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
Environment=VISITOR_ANALYTICS_TARGET_TOTAL=${DEPLOY_VISITOR_ANALYTICS_TARGET_TOTAL}
Environment=VISITOR_ANALYTICS_GROWTH_START_DATE=${DEPLOY_VISITOR_ANALYTICS_GROWTH_START_DATE}
Environment=PUBLIC_BASE_PATH=${LOF_PUBLIC_PATH}/
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
    server_name ${NGINX_SERVER_NAME};
    root ${HOME_ROOT};
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

    location = ${LOF_PUBLIC_PATH} {
        return 301 ${LOF_PUBLIC_PATH}/;
    }

    location ^~ ${LOF_PUBLIC_PATH}/assets/ {
        alias ${DEPLOY_PATH}/current/dist/assets/;
        try_files \$uri =404;
        expires 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }

    location ^~ ${LOF_PUBLIC_PATH}/ {
        alias ${DEPLOY_PATH}/current/dist/;
        index index.html;
        try_files \$uri \$uri/ ${LOF_PUBLIC_PATH}/index.html;
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }

    include ${STATIC_INCLUDE_DIR}/*.conf;

    location = /index.html {
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }

    location / {
        try_files \$uri \$uri/ /index.html;
        add_header Cache-Control "no-store, no-cache, must-revalidate";
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
  const incompleteCritical = rows.filter((row) => Number(row.marketPrice) > 0 && (row.lastNav === null || row.lastNav === undefined || row.lastNav === "" || row.premiumRate === null || row.premiumRate === undefined || Number.isNaN(Number(row.premiumRate))));
  const overseasTech = rows.find((row) => row.code === "501312" || row.name === "海外科技LOF");
  const missingFinancialRows = [...missingPrice, ...missingNav, ...missingPremium];
  const unlabeledMissing = missingFinancialRows.filter((row) => row.dataStatus !== "missing_quote" && row.sourceStatus !== "missing");
  if (rowCount !== 285 || rows.length !== 285 || unlabeledMissing.length || incompleteCritical.length || !overseasTech || Number(overseasTech.marketPrice) <= 0 || Number(overseasTech.lastNav) <= 0 || !Number.isFinite(Number(overseasTech.premiumRate))) {
    console.error("LOF API smoke test failed: deployed LOF data is incomplete");
    console.error(JSON.stringify({
      rowCount,
      rowsLength: rows.length,
      missingPrice: missingPrice.map((row) => ({ code: row.code, name: row.name })),
      missingNav: missingNav.map((row) => ({ code: row.code, name: row.name })),
      missingPremium: missingPremium.map((row) => ({ code: row.code, name: row.name })),
      incompleteCritical: incompleteCritical.map((row) => ({ code: row.code, name: row.name, marketPrice: row.marketPrice, lastNav: row.lastNav, premiumRate: row.premiumRate })),
      unlabeledMissing: unlabeledMissing.map((row) => ({ code: row.code, name: row.name, sourceStatus: row.sourceStatus, dataStatus: row.dataStatus })),
      overseasTech: overseasTech ? { code: overseasTech.code, name: overseasTech.name, marketPrice: overseasTech.marketPrice, lastNav: overseasTech.lastNav, premiumRate: overseasTech.premiumRate } : null,
      status: payload?.meta?.status,
      sourceProvider: payload?.meta?.sourceProvider,
      sourceStatus: payload?.meta?.sourceStatus,
      warn: payload?.meta?.warn,
    }, null, 2));
    process.exit(1);
  }
  console.log(`LOF API smoke test passed: rowCount=${rowCount}, source=${payload?.meta?.sourceProvider || "unknown"}, overseasTechPrice=${overseasTech.marketPrice}, labeledMissing=${new Set(missingFinancialRows.map((row) => row.code)).size}`);
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

echo "==> Verifying deployed LOF admin page"
curl -fsS --max-time 20 "${DEPLOY_SMOKE_URL%/}${LOF_PUBLIC_PATH}/admin" | node -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  if (!input.includes("id=\"app\"") || !input.includes("/lof/assets/")) {
    console.error("LOF admin page smoke test failed");
    process.exit(1);
  }
  console.log("LOF admin page smoke test passed");
});
'

echo "==> Verifying deployed analytics/admin APIs"
curl -fsS --max-time 20 \
  -X POST "${DEPLOY_SMOKE_URL%/}/api/analytics/visit" \
  -H 'Content-Type: application/json' \
  -d '{"deviceId":"deploy-smoke","project":"lof","path":"/deploy-smoke"}' | node -e '
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
  -X POST "${DEPLOY_SMOKE_URL%/}/api/analytics/visit" \
  -H 'Content-Type: application/json' \
  -d '{"deviceId":"deploy-smoke","project":"personal","path":"/deploy-smoke"}' | node -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const payload = JSON.parse(input);
  if (!payload?.ok) {
    console.error("Personal analytics API smoke test failed");
    process.exit(1);
  }
  console.log("Personal analytics API smoke test passed");
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
  const projects = Array.isArray(payload?.projects) ? payload.projects : [];
  if (!projects.some((project) => project.project === "lof") || !projects.some((project) => project.project === "personal")) {
    console.error("Admin API smoke test failed: project stats missing");
    process.exit(1);
  }
  console.log(`Admin visitors smoke test passed: totalVisitors=${payload.totalVisitors}`);
});
'

echo "==> Deployed"
echo "Homepage URL: ${DEPLOY_SMOKE_URL%/}/"
echo "LOF URL: ${DEPLOY_SMOKE_URL%/}${LOF_PUBLIC_PATH}/"
