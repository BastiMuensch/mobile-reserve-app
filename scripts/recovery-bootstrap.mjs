// One-shot initialization for NEW managed deployments. No existing volume or
// role is overwritten and application roles never receive cluster privileges.
import { mkdir, chown } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { waitForReadiness } from './recovery-coordinator.mjs';

const app = new URL(process.env.DATABASE_URL || '');
const adminUrl = process.env.RECOVERY_DATABASE_URL;
const role = decodeURIComponent(app.username), database = decodeURIComponent(app.pathname.slice(1)), password = decodeURIComponent(app.password);
if (!adminUrl || !/^[a-z][a-z0-9_]{0,40}$/.test(role) || !/^[a-z][a-z0-9_]{0,40}$/.test(database) || ['postgres', 'template0', 'template1'].includes(database) || password.length < 32) throw new Error('Managed deployment credentials are invalid');
const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
try {
  await waitForReadiness(async () => { await admin.$queryRawUnsafe('SELECT 1'); return true; });
  const roles = await admin.$queryRawUnsafe(`SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname='${role}'`);
  if (!roles.length) await admin.$executeRawUnsafe(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password.replaceAll("'", "''")}'`);
  else if (roles[0].rolsuper || roles[0].rolcreatedb || roles[0].rolcreaterole) throw new Error('Existing application role has excessive privileges');
  const databases = await admin.$queryRawUnsafe(`SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname='${database}'`);
  if (!databases.length) await admin.$executeRawUnsafe(`CREATE DATABASE ${database} OWNER ${role} TEMPLATE template0`);
  else if (databases[0].owner !== role) throw new Error('Existing database belongs to another role');
  await admin.$executeRawUnsafe(`REVOKE CONNECT, TEMPORARY ON DATABASE ${database} FROM PUBLIC`);
  await admin.$executeRawUnsafe('REVOKE CONNECT, TEMPORARY ON DATABASE postgres FROM PUBLIC');
  const baseline = new PrismaClient({ datasources: { db: { url: app.href } } });
  try { await baseline.$queryRawUnsafe('SELECT 1'); } finally { await baseline.$disconnect(); }
  for (const dir of ['/app/recovery-state', '/app/recovery-runtime', '/app/recovery-data', '/app/public/uploads', '/app/private-uploads']) {
    await mkdir(dir, { recursive: true, mode: 0o700 }); await chown(dir, 1000, 1000);
  }
  console.log('Managed recovery directories and limited application database prepared.');
} catch { console.error('Managed bootstrap failed. Existing data was not replaced. Check separate manager/application credentials.'); process.exitCode = 1; }
finally { await admin.$disconnect(); }
