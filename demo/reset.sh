#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
test -f .env && test -f compose.yml
if [ "${1:-}" != "NUR-DEMO-ZURUECKSETZEN" ]; then
  printf '%s\n' 'Nur die Demo zurücksetzen (mit Backup): sudo sh reset.sh NUR-DEMO-ZURUECKSETZEN'
  exit 1
fi
docker compose -p mobile-reserve-demo-sonnenhain -f compose.yml stop demo-web
docker compose -p mobile-reserve-demo-sonnenhain -f compose.yml run --rm --no-deps demo-init node scripts/demo-instance.mjs --reset NUR-DEMO-ZURUECKSETZEN
docker compose -p mobile-reserve-demo-sonnenhain -f compose.yml up -d demo-web
