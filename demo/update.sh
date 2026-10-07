#!/bin/sh
set -eu
umask 077
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! test -f .env || ! test -f data/demo-seed.json || ! test -f compose.yml || ! test -f app/package.json; then
  printf '%s\n' 'Update abgebrochen: Im bestehenden Demo-Verzeichnis ausführen; .env und data/demo-seed.json müssen erhalten bleiben.' >&2
  exit 1
fi
compose() { docker compose -p mobile-reserve-demo-sonnenhain -f compose.yml "$@"; }
# Build first: a failed build leaves the running web application untouched.
compose build demo-init
compose up -d --wait demo-db
# Verify the existing instance before stopping it or migrating its database.
compose run --rm --no-deps -T demo-init node --input-type=module <<'JS'
import { PrismaClient } from '@prisma/client';
const id = process.env.DEMO_INSTANCE_ID;
if (process.env.DEMO_MODE !== 'true' || !id || !/^[a-f0-9]{32}$/.test(id) || new URL(process.env.DATABASE_URL).pathname !== '/mobile_reserve_demo') throw new Error('Keine ausdrücklich konfigurierte Demo-Instanz.');
const db = new PrismaClient();
try {
  const marker = await db.systemSetting.findUnique({ where: { id: 'demoInstanceId' } });
  const mode = await db.systemSetting.findUnique({ where: { id: 'demoMode' } });
  if (marker?.value !== id || mode?.value !== 'true') throw new Error('Datenbank gehört nicht zu dieser Demo. Update verweigert.');
} finally { await db.$disconnect(); }
JS
mkdir -p backups
backup=$(mktemp -d "backups/update-$(date +%Y%m%d-%H%M%S)-XXXXXX")
compose stop demo-web
# Stop all writes for a consistent database and upload snapshot.
trap 'code=$?; if [ "$code" -ne 0 ]; then printf "Update abgebrochen. Bitte Fehlermeldung und Containerstatus prüfen. Sicherung: %s\n" "$backup" >&2; fi' 0
compose exec -T demo-db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl' > "$backup/database.dump"
compose exec -T demo-db pg_restore --list < "$backup/database.dump" > /dev/null
compose run --rm --no-deps -T demo-init tar -czf - public/uploads private-uploads > "$backup/uploads.tar.gz"
tar -tzf "$backup/uploads.tar.gz" > /dev/null
cp .env data/demo-seed.json compose.yml "$backup/"
printf 'Demo-Sicherung vor Datenbankmigration; compose.yml beschreibt die neue Version.\n' > "$backup/ANLEITUNG.txt"
# Always run migrations with the new image, even when the old init service has
# already exited successfully. Existing demo data is recognized and retained.
compose run --rm --no-deps -T demo-init
compose up -d --no-deps --force-recreate demo-web
compose exec -T demo-web node --input-type=module <<'JS'
import { setTimeout } from 'node:timers/promises';
let ready = false;
for (let attempt = 0; attempt < 60; attempt++) {
  try { if ((await fetch('http://127.0.0.1:3000/api/public/settings', { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } } catch {}
  await setTimeout(1000);
}
if (!ready) throw new Error('Demo antwortet noch nicht. Bitte Container-Logs prüfen.');
console.log(`Demo gestartet: ${process.env.APP_VERSION}`);
JS
compose ps -a
printf '\nDemo aktualisiert. Bestehende Zugänge und Daten bleiben erhalten. Sicherung: %s\n' "$backup"
