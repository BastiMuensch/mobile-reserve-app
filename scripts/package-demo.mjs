import { mkdir, copyFile, readFile, writeFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

process.umask(0o077);
const output = path.resolve('output/standalone-demo-2026-09-14');
await mkdir(output, { mode: 0o700 });
const application = path.join(output, 'app');
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const rootFiles = ['Dockerfile', '.dockerignore', 'package.json', 'package-lock.json', 'tsconfig.json', 'next.config.ts', 'postcss.config.mjs', 'prisma.config.ts', 'LICENSE'];
const scripts = ['recover-schulamt-account.mjs', 'migrate-private-signatures.mjs', 'demo-seed.mjs', 'demo-data.mjs', 'demo-instance.mjs'].map(name => `scripts/${name}`);
const files = [...new Set([...rootFiles, ...scripts, 'src/lib/demoMode.ts', ...tracked.filter(file => file.startsWith('src/') || (file.startsWith('public/') && !file.startsWith('public/uploads/')) || file.startsWith('prisma/migrations/') || file === 'prisma/schema.prisma' || file === 'prisma/seed.ts')])];
for (const file of files) {
  const target = path.join(application, file);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
  await copyFile(file, target);
  await chmod(target, 0o644);
}
for (const file of ['compose.yml', 'start.sh', 'reset.sh', 'ANLEITUNG.md']) {
  await copyFile(`demo/${file}`, path.join(output, file));
  await chmod(path.join(output, file), 0o644);
}
await mkdir(path.join(output, 'data'), { mode: 0o755 });
await chmod(path.join(output, 'data'), 0o755);
await copyFile('output/demo-sonnenhain-2026-09-14/demo-seed.json', path.join(output, 'data/demo-seed.json'));
await chmod(path.join(output, 'data/demo-seed.json'), 0o644);
const dbPassword = randomBytes(24).toString('hex');
const env = { DEMO_PORT: '3110', DEMO_PUBLIC_URL: 'https://demo.bdb-uamm.de', DEMO_DB_PASSWORD: dbPassword, DEMO_JWT_SECRET: randomBytes(32).toString('hex'), DEMO_SMTP_KEY: randomBytes(32).toString('base64'), DEMO_INVITATION_PEPPER: randomBytes(32).toString('hex'), DEMO_INSTANCE_ID: randomBytes(16).toString('hex') };
await writeFile(path.join(output, '.env'), Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
const credentials = await readFile('output/demo-sonnenhain-2026-09-14/ZUGANGSDATEN.md', 'utf8');
await writeFile(path.resolve('output/DEMO-ZUGANGSDATEN.md'), `${credentials}\n## Eigene Demo-Datenbank\n\nNur intern im Demo-Netzwerk erreichbar; kein NAS-Port.\n\n- Host: demo-db\n- Datenbank: mobile_reserve_demo\n- Benutzer: reserve_demo\n- Passwort: ${dbPassword}\n\nDie zufälligen Sitzungsschlüssel stehen in der separaten Serverdatei .env im Paket. Diese nicht an Interessenten weitergeben. Es gibt kein zusätzliches technisches Admin-Webkonto.\n`, { flag: 'wx', mode: 0o600 });
execFileSync('tar', ['-czf', path.resolve('output/MobileReserve-Demo-Eigenstaendig.tar.gz'), '-C', output, 'compose.yml', '.env', 'start.sh', 'reset.sh', 'ANLEITUNG.md', 'data', 'app']);
console.log('Eigenständiges Paket und separate DEMO-ZUGANGSDATEN.md unter output/ erstellt. Kein Produktivsystem verändert.');
