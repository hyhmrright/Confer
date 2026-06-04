#!/usr/bin/env bash
# Bootstrap a public Confer instance on a fresh Oracle Cloud "Always Free"
# ARM (Ampere A1) Ubuntu VM. Idempotent — safe to re-run.
#
#   Shape:  VM.Standard.A1.Flex  (4 OCPU / 24 GB is the Always-Free max)
#   Image:  Canonical Ubuntu 22.04+ (arm64)
#
# Before running, in the Oracle Console open the VCN security list / NSG to
# allow inbound TCP 80 (and 443 if you later add TLS). This script opens the
# VM's host firewall; it cannot touch the cloud-side security list.
#
# Usage:  curl -fsSL <raw>/infra/oracle-bootstrap.sh | bash
#     or: bash infra/oracle-bootstrap.sh
set -euo pipefail

REPO_URL="${CONFER_REPO_URL:-https://github.com/hyhmrright/Confer.git}"
APP_DIR="${CONFER_DIR:-$HOME/Confer}"
ADMIN_USERNAMES="${ADMIN_USERNAMES:-}"

log() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

log "1/5  Install Docker Engine + compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER" || true
fi

log "2/5  Open host firewall for port 80 (Oracle Ubuntu images drop inbound by default)"
# Oracle's Ubuntu images ship restrictive iptables rules; insert an ACCEPT for 80
# ahead of the REJECT, and persist it.
if sudo iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null; then
  echo "    port 80 rule already present"
else
  sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT
  command -v netfilter-persistent >/dev/null 2>&1 && sudo netfilter-persistent save || \
    sudo sh -c 'iptables-save > /etc/iptables/rules.v4' 2>/dev/null || true
fi

log "3/5  Clone (or update) the repo at $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

log "4/5  Create .env with generated secrets (only if missing)"
if [ ! -f .env ]; then
  cp .env.example .env
  # Replace the two must-change secrets with strong random values.
  JWT=$(openssl rand -hex 32)
  ENC=$(openssl rand -hex 32)
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT}|" .env
  sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${ENC}|" .env
  if [ -n "$ADMIN_USERNAMES" ]; then
    sed -i "s|^ADMIN_USERNAMES=.*|ADMIN_USERNAMES=${ADMIN_USERNAMES}|" .env
  fi
  echo "    wrote .env (JWT_SECRET + ENCRYPTION_KEY generated)"
else
  echo "    .env already exists — left untouched"
fi

log "5/5  Build and start the full stack (migrations run automatically)"
# `sg docker` runs with the freshly-added group without needing a re-login.
sg docker -c "docker compose -f docker-compose.prod.yml up -d --build"

PUBLIC_IP=$(curl -fsSL https://api.ipify.org 2>/dev/null || echo "<your-vm-ip>")
cat <<EOF

\033[1;32mDone.\033[0m Confer should be reachable at:  http://${PUBLIC_IP}/

Next:
  - Register your account in the web UI, then set ADMIN_USERNAMES=<you> in
    $APP_DIR/.env and run:  docker compose -f docker-compose.prod.yml up -d gateway
  - For a stable identity (did:web) and HTTPS, point a domain at this IP and
    set PUBLIC_HOST in .env. Until then the instance works by IP for testing.
EOF
