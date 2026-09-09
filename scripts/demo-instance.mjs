import { readFile, writeFile, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { models, demoDates } from './demo-data.mjs';
import { replaceDemoData } from './demo-seed.mjs';

async function main() {
  const id = process.env.DEMO_INSTANCE_ID;
  if (process.env.DEMO_MODE !== 'true' || !id || !/^[a-f0-9]{32}$/.test(id)) throw new Error('Nur eine ausdrücklich konfigurierte Demo-Instanz darf initialisiert werden.');
  const dbUrl = new URL(process.env.DATABASE_URL);
  if (decodeURIComponent(dbUrl.pathname) !== '/mobile_reserve_demo') throw new Error('Die Demo erwartet eine eigene Datenbank mobile_reserve_demo.');
  dbUrl.searchParams.set('connection_limit', '1');
  const db = new PrismaClient({ datasourceUrl: dbUrl.href });
  try {
    const seed = JSON.parse(await readFile(process.env.DEMO_SEED_PATH || '/demo/demo-seed.json', 'utf8'));
    if (seed.format !== 'mobile-reserve-demo-v1') throw new Error('Falsches Seedformat.');
    demoDates(seed.start);
    seed.data.systemSetting = [...seed.data.systemSetting.filter(row => row.id !== 'demoInstanceId'), { id: 'demoInstanceId', value: id }];
    const reset = process.argv.slice(2);
    if (reset.length) {
      if (reset.length !== 2 || reset[0] !== '--reset' || reset[1] !== 'NUR-DEMO-ZURUECKSETZEN') throw new Error('Reset erfordert --reset NUR-DEMO-ZURUECKSETZEN.');
      const marker = await db.systemSetting.findUnique({ where: { id: 'demoInstanceId' } });
      const mode = await db.systemSetting.findUnique({ where: { id: 'demoMode' } });
      if (marker?.value !== id || mode?.value !== 'true') throw new Error('Diese Datenbank gehört nicht zu diesem Demo-Paket. Reset verweigert.');
      await db.$disconnect();
      const file = `/app/demo-work/reset-seed-${randomUUID()}.json`;
      await writeFile(file, JSON.stringify(seed), { flag: 'wx', mode: 0o600 });
      try {
        const args = ['scripts/demo-seed.mjs', '--seed', file];
        const preview = execFileSync(process.execPath, args, { encoding: 'utf8' });
        const confirmation = JSON.parse(preview.slice(0, preview.lastIndexOf('}') + 1)).bestaetigung;
        const backup = `/app/demo-work/backup-${Date.now()}`;
        execFileSync(process.execPath, [...args, '--apply', confirmation, '--backup-dir', backup], { stdio: 'inherit' });
      } finally { await unlink(file); }
      return;
    }
    await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(687142006)`;
      const marker = await tx.systemSetting.findUnique({ where: { id: 'demoInstanceId' } });
      const mode = await tx.systemSetting.findUnique({ where: { id: 'demoMode' } });
      if (marker?.value === id && mode?.value === 'true') {
        console.log('Bestehende Demo erkannt. Keine Daten verändert.');
        return;
      }
      for (const model of models) if (await tx[model].count()) throw new Error('Datenbank nicht leer oder fremde Demo: automatische Einrichtung verweigert.');
      await replaceDemoData(tx, seed);
      console.log('Eigene Demo erstmals eingerichtet. Zugangsdaten stehen in der separaten Datei.');
    }, { timeout: 60_000 });
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
