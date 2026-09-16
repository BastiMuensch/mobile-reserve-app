/** Local synthetic UI fixture. Never connects to a database or starts the app. */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { RecoveryCoordinator } from './recovery-coordinator.mjs';
import { createGateway } from './recovery-gateway.mjs';

if (process.env.NODE_ENV === 'production') throw new Error('Local preview only');
const root = await mkdtemp(path.join(tmpdir(), 'mr-recovery-preview-'));
const config = {
  origin: 'http://127.0.0.1:3139', secure: false,
  web: new URL('http://127.0.0.1:3140'),
  stateDir: path.join(root, 'state'), runtimeDir: path.join(root, 'runtime'),
  dataRoot: path.join(root, 'data'),
};
const counts = { users: 12, schools: 3, teachers: 8, requests: 5, assignments: 2 };
const coordinator = new RecoveryCoordinator({ ...config,
  control: async () => { await delay(350); }, ready: async () => { await delay(350); },
  inspect: async ({ password }) => {
    await delay(1000);
    if (password !== 'a'.repeat(32)) throw new Error('Synthetic invalid password');
    return { summary: { createdAt: '2026-09-16T12:00:00.000Z', appVersion: '0.1.8', counts } };
  },
  restore: async ({ id }) => {
    await delay(2500);
    return { descriptor: { generation: id, environment: {}, paused: true, notificationsPaused: true }, counts };
  },
});
await coordinator.initialize();
const archive = path.join(root, 'synthetic.mrbackup');
await writeFile(archive, 'MRBACKUP1' + 'x'.repeat(100), { mode: 0o600 });
const server = createGateway({ config, coordinator,
  authorize: async (_, credential) => credential.body[credential.mode] === 'UI-Testpasswort',
});
server.listen(3139, '127.0.0.1', () => {
  console.log('Synthetic preview: http://127.0.0.1:3139/_recovery/');
  console.log('Test login: UI-Testpasswort; backup password: 32 lowercase a characters');
  console.log(`Synthetic file: ${archive}`);
});
