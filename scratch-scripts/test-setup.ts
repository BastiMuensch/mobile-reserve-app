/**
 * Bereitet eine frisch aufgesetzte Testdatenbank für die Funktionstests vor.
 *
 * `prisma/seed-musterstadt.ts` legt Schulamt, Schulen und Lehrkräfte an, aber keinen
 * Login für eine Lehrkraft – den brauchen e2e-verify.ts und export-verify.ts aber.
 * Dieses Skript ergänzt ihn (und ist beliebig oft wiederholbar).
 *
 * Kompletter Aufbau einer Testumgebung:
 *
 *   initdb -D ./pgdata -U postgres --auth=trust
 *   pg_ctl -D ./pgdata -o "-p 55432 -k /tmp/pg" start
 *   createdb -h 127.0.0.1 -p 55432 -U postgres e2etest
 *   export DATABASE_URL="postgresql://postgres@127.0.0.1:55432/e2etest?schema=public"
 *   npx prisma migrate deploy
 *   npx tsx prisma/seed-musterstadt.ts
 *   npx tsx scratch-scripts/test-setup.ts
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const dbName = (process.env.DATABASE_URL ?? '').split('/').pop()?.split('?')[0] ?? '';
if (!dbName.toLowerCase().includes('test')) {
  console.error(`\nABBRUCH: nur gegen eine Testdatenbank ausführen. Ziel: "${dbName}"\n`);
  process.exit(1);
}

const prisma = new PrismaClient();

(async () => {
  const teacher = await prisma.teacher.findFirstOrThrow({ where: { name: 'Lukas Sonnenschein' } });

  const email = 'lehrkraft@musterstadt.de';
  const password = await bcrypt.hash('lehrkraft123', 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: { password, role: 'TEACHER' },
    create: { email, password, role: 'TEACHER', name: teacher.name },
  });

  await prisma.teacher.update({ where: { id: teacher.id }, data: { userId: user.id } });

  console.log(`Login für ${teacher.name} eingerichtet: ${email} / lehrkraft123`);
})().catch(e => { console.error('\nAbbruch:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
