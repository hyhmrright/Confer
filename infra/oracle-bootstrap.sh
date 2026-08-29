#!/usr/bin/env bash
# Bootstrap a public Confer instance on a fresh Oracle Cloud "Always Free"
# ARM (Ampere A1) Ubuntu VM. Idempotent — safe to re-run.
#
#   Shape:  VM.Standard.A1.Flex  (4 OCPU / 24 GB is the Always-Free max)
#   Image:  Canonical Ubuntu 22.04+ (arm64)
#
# Before running, in the Oracle Console open the VCN security list / NSG to
# allow inbound TCP 80 and 443. This script opens the VM's host firewall; it
# cannot touch the cloud-side security list.
#
# Usage:  curl -fsSL <raw>/infra/oracle-bootstrap.sh | bash
#     or: bash infra/oracle-bootstrap.sh
#
# Set CONFER_DOMAIN to a domain already pointed at this VM to serve HTTPS with
# an automatically issued certificate. That is what makes the instance able to
# federate: agent identities are did:web, which resolves over HTTPS only, so an
# http-only instance publishes identities no peer can verify. Without it the
# instance still runs perfectly well for its own users.
#
#   CONFER_DOMAIN=confer.example.com bash infra/oracle-bootstrap.sh
set -euo pipefail

REPO_URL="${CONFER_REPO_URL:-https://github.com/hyhmrright/Confer.git}"
APP_DIR="${CONFER_DIR:-$HOME/Confer}"
ADMIN_USERNAMES="${ADMIN_USERNAMES:-}"
CONFER_DOMAIN="${CONFER_DOMAIN:-}"

log() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

log "1/5  Install Docker Engine + compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER" || true
fi

log "2/5  Open host firewall for ports 80 and 443 (Oracle Ubuntu images drop inbound by default)"
# Oracle's Ubuntu images ship restrictive iptables rules; insert an ACCEPT ahead
# of the REJECT, and persist it. 443 is opened even without a domain so that
# turning TLS on later needs no second visit to the firewall — and 80 stays open
# regardless, because Let's Encrypt validates over it.
for port in 80 443; do
  if sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    echo "    port $port rule already present"
  else
    sudo iptables -I INPUT 6 -p tcp --dport "$port" -j ACCEPT
  fi
done
command -v netfilter-persistent >/dev/null 2>&1 && sudo netfilter-persistent save || \
  sudo sh -c 'iptables-save > /etc/iptables/rules.v4' 2>/dev/null || true

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

# Set outside the block above so that re-running with a domain points an
# existing instance at it. Every DID is minted from PUBLIC_HOST; the gateway
# re-hosts identities minted under the old value on next start. CONFER_DOMAIN is
# recorded alongside it so a later plain re-run still composes the TLS overlay —
# without it the stack would come back on port 80 while still claiming https.
if [ -z "$CONFER_DOMAIN" ]; then
  CONFER_DOMAIN=$(sed -n 's|^CONFER_DOMAIN=||p' .env | tail -n 1)
fi

COMPOSE_FILES="-f docker-compose.prod.yml"
if [ -n "$CONFER_DOMAIN" ]; then
  sed -i "s|^PUBLIC_HOST=.*|PUBLIC_HOST=${CONFER_DOMAIN}|" .env
  if grep -q '^CONFER_DOMAIN=' .env; then
    sed -i "s|^CONFER_DOMAIN=.*|CONFER_DOMAIN=${CONFER_DOMAIN}|" .env
  else
    echo "CONFER_DOMAIN=${CONFER_DOMAIN}" >> .env
  fi
  COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.tls.yml"
  echo "    PUBLIC_HOST=${CONFER_DOMAIN} (HTTPS via docker-compose.tls.yml)"
fi

log "5/5  Build and start the full stack (migrations run automatically)"
# `sg docker` runs with the freshly-added group without needing a re-login.
sg docker -c "docker compose $COMPOSE_FILES up -d --build"

if [ -n "$CONFER_DOMAIN" ]; then
  APP_URL="https://${CONFER_DOMAIN}/"
  IDENTITY_NOTE="  - This instance can federate: its agents are did:web:${CONFER_DOMAIN}:agents:<user>,
    which other instances resolve over HTTPS. Certificate issuance needs
    ${CONFER_DOMAIN} to already point here and ports 80+443 open in the VCN
    security list; check with:  docker compose $COMPOSE_FILES logs caddy"
else
  PUBLIC_IP=$(curl -fsSL https://api.ipify.org 2>/dev/null || echo "<your-vm-ip>")
  APP_URL="http://${PUBLIC_IP}/"
  IDENTITY_NOTE="  - This instance CANNOT federate yet. did:web resolves over HTTPS only, so
    its agents publish identities no peer can verify. Point a domain here and
    re-run with:  CONFER_DOMAIN=confer.example.com bash infra/oracle-bootstrap.sh"
fi

cat <<EOF

\033[1;32mDone.\033[0m Confer should be reachable at:  ${APP_URL}

Next:
  - Register your account in the web UI, then set ADMIN_USERNAMES=<you> in
    $APP_DIR/.env and run:  docker compose $COMPOSE_FILES up -d gateway
${IDENTITY_NOTE}
EOF
