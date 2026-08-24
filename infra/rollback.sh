#!/usr/bin/env bash
#
# Roll services back to the image the last deploy replaced.
#
# infra/deploy.sh tags the outgoing image :previous before overwriting :latest.
# This points :latest back at it and recreates the containers.
#
# THIS ROLLS BACK CODE ONLY. Migrations are forward-only — if the deploy you are
# undoing added one, it has already been applied and the older image may not
# understand the schema it now finds. Check whether packages/gateway/drizzle
# gained a file in the deploy you are reverting before relying on this.
#
# Usage: infra/rollback.sh [service...]    (default: gateway client)
set -euo pipefail
# shellcheck source=infra/compose-images.sh
source "$(dirname "$0")/compose-images.sh"

id_of() { docker image inspect --format '{{.Id}}' "$1" 2>/dev/null; }

# Resolve every service before changing anything, so a missing rollback point on
# the second service can't leave the first one already reverted.
for svc in "${SERVICES[@]}"; do
  img=$(image_of "$svc")
  prev="${img%:*}:previous"
  if ! docker image inspect "$prev" >/dev/null 2>&1; then
    echo "error: $prev does not exist — no deploy has recorded a rollback point for $svc" >&2
    exit 1
  fi
  if [ "$(id_of "$prev")" = "$(id_of "$img")" ]; then
    echo "note: $svc is already running the :previous image; rolling it back changes nothing"
  fi
done

for svc in "${SERVICES[@]}"; do
  img=$(image_of "$svc")
  docker tag "${img%:*}:previous" "$img"
  echo "$svc -> $(id_of "$img" | cut -c8-19)"
done

docker compose -f "$COMPOSE" up -d --force-recreate "${SERVICES[@]}"
docker compose -f "$COMPOSE" ps --format 'table {{.Service}}\t{{.Status}}'
