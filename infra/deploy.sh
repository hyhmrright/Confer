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
# `migrate` is a second image built from the gateway's own Dockerfile, so it
# carries the migration files and goes stale the moment the gateway is rebuilt
# without it. Nothing announces that: the stale image applies the old set and
# still prints "Migrations complete", leaving the new tables uncreated. It is
# therefore rebuilt here whenever the gateway is. *Running* it was never the
# missing half — gateway depends_on it with service_completed_successfully, so
# `up` starts it and waits for exit 0 before the new gateway comes up, which is
# the order a forward-only migration needs anyway.
set -euo pipefail
# shellcheck source=infra/compose-images.sh
source "$(dirname "$0")/compose-images.sh"

has_service() {
  local svc
  for svc in "${SERVICES[@]}"; do
    if [ "$svc" = "$1" ]; then return 0; fi
  done
  return 1
}

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

# Pulled in this way, migrate is built but deliberately gets no :previous of its
# own — rollback.sh reverts running code, and migrations are forward-only, so an
# older migrate image is not something anyone would want to go back to. Naming
# it explicitly puts it in SERVICES and does take a rollback point, which is the
# operator asking for one rather than the deploy assuming it.
build_services=("${SERVICES[@]}")
if has_service gateway && ! has_service migrate; then
  build_services+=(migrate)
fi

bun run build
docker compose -f "$COMPOSE" build "${build_services[@]}"
docker compose -f "$COMPOSE" up -d "${SERVICES[@]}"

docker compose -f "$COMPOSE" ps --format 'table {{.Service}}\t{{.Status}}'
