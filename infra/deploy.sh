#!/usr/bin/env bash
#
# Rebuild and restart production services, keeping the image each one replaces.
#
# `docker compose build` overwrites the :latest tag in place. The image that
# held it keeps running but loses its name, and the next `docker image prune`
# reclaims it — which is how this stack reached a state with no way back from a
# bad deploy. Re-tagging to :previous first gives that image a name again, and
# the reference also stops prune from collecting it.
#
# Usage: infra/deploy.sh [service...]     (default: gateway client)
#
# A change that adds a migration also needs the separate migrate image, which
# `build gateway client` does not touch:
#   docker compose -f docker-compose.prod.yml build migrate
#   docker compose -f docker-compose.prod.yml run --rm migrate
set -euo pipefail
# shellcheck source=infra/compose-images.sh
source "$(dirname "$0")/compose-images.sh"

for svc in "${SERVICES[@]}"; do
  img=$(image_of "$svc")
  prev="${img%:*}:previous"
  if docker image inspect "$img" >/dev/null 2>&1; then
    docker tag "$img" "$prev"
    echo "kept $prev as a rollback point"
  else
    echo "no existing $img; nothing to keep as a rollback point"
  fi
done

bun run build
docker compose -f "$COMPOSE" build "${SERVICES[@]}"
docker compose -f "$COMPOSE" up -d "${SERVICES[@]}"

docker compose -f "$COMPOSE" ps --format 'table {{.Service}}\t{{.Status}}'
