#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PI_USER="${PI_USER:-pi}"
PI_HOST="${PI_HOST:-192.168.0.110}"
PI_PASSWORD="${PI_PASSWORD:-}"
REMOTE_DIR="${REMOTE_DIR:-/opt/homework-goalie}"
ENV_FILE="${ENV_FILE:-/etc/homework-goalie/homework-goalie.env}"

if [[ -z "${PI_PASSWORD}" ]]; then
  echo "PI_PASSWORD is required; do not store it in git." >&2
  exit 2
fi

SSH=(sshpass -p "${PI_PASSWORD}" ssh -o StrictHostKeyChecking=accept-new "${PI_USER}@${PI_HOST}")
RSYNC=(
  rsync -az --delete
  -e "sshpass -p ${PI_PASSWORD} ssh -o StrictHostKeyChecking=accept-new"
  --exclude .git
  --exclude node_modules
  --exclude tmp
  --exclude "*.log"
  --include ".env.example"
  --exclude ".env"
  --exclude ".env.*"
  --exclude "Photo on 2026-5-21 at 13.55.jpg"
)

"${SSH[@]}" "sudo mkdir -p '${REMOTE_DIR}' /var/lib/homework-goalie /etc/homework-goalie && sudo chown -R ${PI_USER}:${PI_USER} '${REMOTE_DIR}' /var/lib/homework-goalie"
"${RSYNC[@]}" "${ROOT}/" "${PI_USER}@${PI_HOST}:${REMOTE_DIR}/"
"${SSH[@]}" "cd '${REMOTE_DIR}' && npm ci --omit=dev"
"${SSH[@]}" "if [ ! -f '${ENV_FILE}' ]; then sudo cp '${REMOTE_DIR}/.env.example' '${ENV_FILE}'; sudo chmod 600 '${ENV_FILE}'; fi"
"${SSH[@]}" "sudo grep -q '^HOMEWORK_GOALIE_HOST=' '${ENV_FILE}' && sudo sed -i 's/^HOMEWORK_GOALIE_HOST=.*/HOMEWORK_GOALIE_HOST=0.0.0.0/' '${ENV_FILE}' || echo 'HOMEWORK_GOALIE_HOST=0.0.0.0' | sudo tee -a '${ENV_FILE}' >/dev/null"
"${SSH[@]}" "sudo cp '${REMOTE_DIR}/systemd/homework-goalie.service' /etc/systemd/system/homework-goalie.service"
"${SSH[@]}" "sudo systemctl daemon-reload && sudo systemctl enable --now homework-goalie.service && sudo systemctl restart homework-goalie.service"
"${SSH[@]}" "sleep 1 && systemctl is-active homework-goalie.service && curl -fsS http://127.0.0.1:4588/healthz"
