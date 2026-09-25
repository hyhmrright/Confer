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
# Migrations need nothing extra here. The migrate service runs out of the
# gateway's own image — one tag, two commands — so rebuilding the gateway is
# what refreshes the migration set, and running it is compose's job: gateway
# depends_on migrate with service_completed_successfully, so `up` starts it and
# waits for exit 0 before the new gateway comes up, which is the order a
# forward-only migration needs anyway.
set -euo pipefail
# shellcheck source=infra/compose-images.sh
source "$(dirname "$0")/compose-images.sh"

for svc in "${SERVICES[@]}"; do
  img=$(image_of "$svc")
  prev=$(previous_of "$img")
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

# -a, so the migrate job appears. It has exited by the time this runs, and a
# deploy whose closing report says nothing at all about the migration step is
# how a failed one goes unnoticed.
docker compose -f "$COMPOSE" ps -a --format 'table {{.Service}}\t{{.Status}}'
