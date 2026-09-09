#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
test -f .env && test -f compose.yml && test -f data/demo-seed.json
docker compose -p mobile-reserve-demo-sonnenhain -f compose.yml build demo-init
docker compose -p mobile-reserve-demo-sonnenhain -f compose.yml up -d
docker compose -p mobile-reserve-demo-sonnenhain -f compose.yml ps -a
printf '\nBei Fehlern: docker compose -f compose.yml logs --tail=100 demo-init demo-web\n'
