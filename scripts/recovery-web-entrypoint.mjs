import { spawn } from 'node:child_process';
import { RecoverySupervisor, main } from './recovery-supervisor.mjs';

// Migrations run only at an operator-triggered container start/update, never
// during an in-process restore switch. Restored backups must match this release.
const supervisor = new RecoverySupervisor();
try {
  const descriptor = await supervisor.readDescriptor();
  const code = await new Promise(resolve => {
    const child = spawn(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
      cwd: process.cwd(), env: supervisor.childEnvironment(descriptor), stdio: 'inherit', shell: false,
    });
    child.once('error', () => resolve(1)); child.once('exit', code => resolve(code ?? 1));
    const forward = () => child.kill('SIGTERM'); process.once('SIGTERM', forward);
    child.once('exit', () => process.off('SIGTERM', forward));
  });
  if (code !== 0) throw new Error('Migration failed');
  await main();
} catch { console.error('[recovery-web] Start nicht möglich. Datenbank/Version/Startkonfiguration prüfen.'); process.exitCode = 1; }
