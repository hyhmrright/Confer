# shellcheck shell=bash
#
# Sourced by infra/deploy.sh and infra/rollback.sh — not executed directly, so
# it carries a shellcheck directive instead of a shebang.
#
# Both scripts have to agree on which image name belongs to which service: if
# they ever disagreed, a rollback would go looking for an image the deploy never
# saved. Resolving the name from the compose file, in one place, is what keeps
# them from drifting apart.
#
# Sourcing this also leaves the caller in the repo root, and sets SERVICES from
# the caller's arguments (default: gateway client).

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
COMPOSE=docker-compose.prod.yml

# shellcheck disable=SC2034  # read by the sourcing script, not here
if [ $# -gt 0 ]; then
  SERVICES=("$@")
else
  SERVICES=(gateway client)
fi

# The service name goes in through argv, not interpolated into the program
# text: a name carrying a quote would otherwise break the python source itself.
# An unknown service raises KeyError, which set -e turns into an exit.
image_of() {
  docker compose -f "$COMPOSE" config --format json \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['services'][sys.argv[1]]['image'])" "$1"
}
