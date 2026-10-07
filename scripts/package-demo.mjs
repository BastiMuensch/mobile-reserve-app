import { mkdir, copyFile, readFile, writeFile, chmod, access, glob } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { normalizeDemoSeed } from './demo-data.mjs';

// An update deliberately has neither .env nor seed data: extracting it over an
// existing demo cannot replace its instance identity, logins or reset baseline.
export async function packageDemo({ output, seedDir } = {}) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const kind = seedDir ? 'Eigenstaendig' : 'Update';
  output = path.resolve(output || path.join(root, 'output', `MobileReserve-Demo-${kind}-${version}`));
  const archive = `${output}.tar.gz`;
  const credentialPath = `${output}-ZUGANGSDATEN.md`;
  for (const target of [output, archive, ...(seedDir ? [credentialPath] : [])]) {
    try { await access(target); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error(`Ausgabe existiert bereits: ${target}`);
  }
  const seed = seedDir ? normalizeDemoSeed(JSON.parse(await readFile(path.resolve(seedDir, 'demo-seed.json'), 'utf8'))) : null;
  const credentials = seedDir ? await readFile(path.resolve(seedDir, 'ZUGANGSDATEN.md'), 'utf8') : null;
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const rootFiles = ['Dockerfile', '.dockerignore', 'package.json', 'package-lock.json', 'tsconfig.json', 'next.config.ts', 'postcss.config.mjs', 'prisma.config.ts', 'LICENSE', 'docker-compose.prod.yml', 'docker-compose.managed.yml'];
  const files = new Set([...rootFiles, ...tracked.filter(file => file.startsWith('src/') || (file.startsWith('public/') && !file.startsWith('public/uploads/')) || file.startsWith('prisma/migrations/') || file === 'prisma/schema.prisma' || file === 'prisma/seed.ts')]);
  // Derive runtime inputs from Dockerfile COPY directives, including wildcards.
  // A newly added backup/setup helper must not break the next demo image build.
  const dockerfile = await readFile(path.join(root, 'Dockerfile'), 'utf8');
  for (const match of dockerfile.matchAll(/^COPY\s+--from=builder\s+(?:--\S+\s+)*\/app\/(\S+)\s+/gm)) {
    const input = match[1];
    if (['.next', 'public'].includes(input)) continue;
    const matches = await Array.fromAsync(glob(input, { cwd: root }));
    if (!matches.length) throw new Error(`Docker-Build-Datei fehlt: ${input}`);
    for (const file of matches) files.add(file);
  }
  for (const file of files) await access(path.join(root, file));
  await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  await mkdir(output, { mode: 0o700 });
  const application = path.join(output, 'app');
  for (const file of files) {
    const target = path.join(application, file);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
    await copyFile(path.join(root, file), target);
    await chmod(target, 0o644);
  }
  for (const file of ['start.sh', 'update.sh', 'reset.sh', 'ANLEITUNG.md', 'UPDATE.md']) {
    if (file.endsWith('.md')) await writeFile(path.join(output, file), (await readFile(path.join(root, 'demo', file), 'utf8')).replaceAll('VERSION', version), { flag: 'wx' });
    else await copyFile(path.join(root, 'demo', file), path.join(output, file));
    await chmod(path.join(output, file), 0o644);
  }
  const compose = (await readFile(path.join(root, 'demo/compose.yml'), 'utf8'))
    .replace('APP_VERSION: demo-package', `APP_VERSION: ${version}-demo`);
  await writeFile(path.join(output, 'compose.yml'), compose, { flag: 'wx', mode: 0o644 });
  const entries = ['compose.yml', 'start.sh', 'update.sh', 'reset.sh', 'ANLEITUNG.md', 'UPDATE.md', 'app'];
  if (seed) {
    await mkdir(path.join(output, 'data'), { mode: 0o755 });
    await chmod(path.join(output, 'data'), 0o755);
    await writeFile(path.join(output, 'data/demo-seed.json'), JSON.stringify(seed, null, 2), { flag: 'wx', mode: 0o644 });
    await chmod(path.join(output, 'data/demo-seed.json'), 0o644);
    const dbPassword = randomBytes(24).toString('hex');
    const env = { DEMO_PORT: '3110', DEMO_PUBLIC_URL: 'https://demo.bdb-uamm.de', DEMO_DB_PASSWORD: dbPassword, DEMO_JWT_SECRET: randomBytes(32).toString('hex'), DEMO_SMTP_KEY: randomBytes(32).toString('base64'), DEMO_INVITATION_PEPPER: randomBytes(32).toString('hex'), DEMO_INSTANCE_ID: randomBytes(16).toString('hex') };
    await writeFile(path.join(output, '.env'), Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
    await writeFile(credentialPath, `${credentials}\n## Eigene Demo-Datenbank\n\nNur intern im Demo-Netzwerk erreichbar.\n\n- Host: demo-db\n- Datenbank: mobile_reserve_demo\n- Benutzer: reserve_demo\n- Passwort: ${dbPassword}\n\nDie Sitzungsschlüssel stehen in der Serverdatei .env im Paket. Diese nicht an Interessenten weitergeben.\n`, { flag: 'wx', mode: 0o600 });
    entries.push('.env', 'data');
  }
  execFileSync('tar', ['-czf', archive, '-C', output, ...entries], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  await chmod(archive, 0o600);
  return { output, archive, version, kind, ...(seed ? { credentialPath } : {}) };
}

async function main() {
  process.umask(0o077);
  const options = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const key = { '--output': 'output', '--seed-dir': 'seedDir' }[args[i]];
    if (!key || !args[i + 1] || args[i + 1].startsWith('--') || options[key]) throw new Error('Erlaubt: [--output VERZEICHNIS] [--seed-dir VERZEICHNIS für eine neue Demo]. Ohne --seed-dir entsteht ein Update ohne Zugangsdaten.');
    options[key] = args[i + 1];
  }
  const result = await packageDemo(options);
  console.log(`Demo-${result.kind} ${result.version} erstellt: ${result.archive}\n${result.credentialPath ? `Separate Zugangsdaten: ${result.credentialPath}` : 'Vorhandene .env, Daten und Zugangsdaten werden beim Entpacken nicht ersetzt.'}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
