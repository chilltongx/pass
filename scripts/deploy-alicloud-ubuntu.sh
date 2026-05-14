#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/pass}"
APP_USER="${APP_USER:-root}"
PORT="${PORT:-6789}"
MAX_UPLOAD_MB="${MAX_UPLOAD_MB:-500}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Please run as root: sudo bash scripts/deploy-alicloud-ubuntu.sh"
  exit 1
fi

if [[ -z "${PUBLIC_URL:-}" ]]; then
  read -r -p "Public URL, for example https://pass.example.com: " PUBLIC_URL
fi

if [[ -z "${PASS_PASSWORD:-}" ]]; then
  read -r -s -p "Pass password: " PASS_PASSWORD
  echo
fi

if [[ -z "${PUBLIC_URL}" || -z "${PASS_PASSWORD}" ]]; then
  echo "PUBLIC_URL and PASS_PASSWORD are required."
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)" >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y ca-certificates curl gnupg rsync
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
    apt-get update
    apt-get install -y nodejs
  else
    echo "Node.js >= 18 is required. Install it first, then run this script again."
    exit 1
  fi
fi

if ! command -v rsync >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then
  apt-get update
  apt-get install -y rsync
fi

mkdir -p "${APP_DIR}"
rsync -a --delete \
  --exclude node_modules \
  --exclude storage \
  --exclude "*.log" \
  ./ "${APP_DIR}/"

cd "${APP_DIR}"
npm ci --omit=dev
mkdir -p storage/files

cat >/etc/systemd/system/pass.service <<EOF
[Unit]
Description=Pass private relay
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PORT=${PORT}
Environment=PUBLIC_URL=${PUBLIC_URL}
Environment=PASS_USER=pass
Environment=PASS_PASSWORD=${PASS_PASSWORD}
Environment=MAX_UPLOAD_MB=${MAX_UPLOAD_MB}
ExecStart=$(command -v node) ${APP_DIR}/server.js
Restart=always
RestartSec=3
User=${APP_USER}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now pass
systemctl restart pass

echo
echo "Pass is running behind the local port ${PORT}."
echo "Public URL: ${PUBLIC_URL}"
echo "Username: pass"
echo "Check status with: systemctl status pass"
