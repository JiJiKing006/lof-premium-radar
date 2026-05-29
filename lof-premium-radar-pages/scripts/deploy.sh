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

SSH_OPTS=(-p "$DEPLOY_PORT" -o StrictHostKeyChecking=accept-new)
SCP_OPTS=(-P "$DEPLOY_PORT" -o StrictHostKeyChecking=accept-new)
if [[ -n "$DEPLOY_SSH_KEY" ]]; then
  SSH_OPTS+=(-i "$DEPLOY_SSH_KEY")
  SCP_OPTS+=(-i "$DEPLOY_SSH_KEY")
fi

REMOTE="$DEPLOY_USER@$DEPLOY_HOST"
ARCHIVE="$(mktemp -t lof-premium-radar.XXXXXX.tar.gz)"
REMOTE_ARCHIVE="/tmp/lof-premium-radar-${USER:-deploy}-$(date +%s).tar.gz"

cleanup() {
  rm -f "$ARCHIVE"
}
trap cleanup EXIT

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

install_server_dependencies

mkdir -p "$release_dir"
tar -xzf "$REMOTE_ARCHIVE" -C "$release_dir"
rm -f "$REMOTE_ARCHIVE"

cd "$release_dir"
npm ci --omit=dev

ln -sfn "$release_dir" "$DEPLOY_PATH/current"

cat >"/etc/systemd/system/${DEPLOY_SERVICE}.service" <<EOF
[Unit]
Description=LOF Premium Radar
After=network.target

[Service]
Type=simple
WorkingDirectory=${DEPLOY_PATH}/current
Environment=NODE_ENV=production
Environment=PORT=${APP_PORT}
ExecStart=/usr/bin/env node server/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

cat >"/etc/nginx/conf.d/${DEPLOY_SERVICE}.conf" <<EOF
server {
    listen 80;
    listen [::]:80;
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

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /assets/ {
        try_files \$uri =404;
        expires 30d;
    }
}
EOF

systemctl daemon-reload
systemctl enable "$DEPLOY_SERVICE"
systemctl restart "$DEPLOY_SERVICE"
nginx -t
systemctl reload nginx

find "$DEPLOY_PATH/releases" -mindepth 1 -maxdepth 1 -type d | sort | head -n -5 | xargs -r rm -rf

systemctl --no-pager --full status "$DEPLOY_SERVICE" | sed -n '1,12p'
REMOTE_SCRIPT

echo "==> Deployed"
echo "URL: http://${DEPLOY_DOMAIN}"
