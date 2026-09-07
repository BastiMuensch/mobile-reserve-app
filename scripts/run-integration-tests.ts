import { spawn } from 'child_process';

const testDbUrl = process.env.TEST_DATABASE_URL;

if (!testDbUrl || testDbUrl.trim() === '') {
  console.error('\n❌ FEHLER: test:integration darf ausschließlich gegen eine explizite Test-Datenbank ausgeführt werden.');
  console.error('Bitte setzen Sie die Umgebungsvariable TEST_DATABASE_URL (z. B. postgresql://user:pass@localhost:5432/test_db).\n');
  process.exit(1);
}

// Hard stop unless the database name itself is clearly a test database. A host
// such as test.example.org is not sufficient evidence that its production
// database is safe to migrate and populate.
let databaseName = '';
try {
  databaseName = decodeURIComponent(new URL(testDbUrl).pathname).replace(/^\/+|\/+$/g, '');
} catch {
  console.error('❌ FEHLER: TEST_DATABASE_URL ist keine gültige Datenbank-URL.');
  process.exit(1);
}
if (!/(^|[_-])test(?:[_-]|$)/i.test(databaseName)) {
  console.error(`❌ FEHLER: Die Datenbank "${databaseName || '(leer)'}" ist nicht eindeutig als Testdatenbank benannt.`);
  console.error('Der Name muss test als eigenständigen Bestandteil enthalten, z. B. mobile_reserve_test.\n');
  process.exit(1);
}

console.log('🚀 Führe Integrationstests gegen Test-Datenbank aus...');
const env = { ...process.env, DATABASE_URL: testDbUrl };

function run(command: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', env, shell: false });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function main() {
  const migrationCode = await run('npx', ['prisma', 'migrate', 'deploy']);
  if (migrationCode !== 0) process.exit(migrationCode);

  const testCode = await run('npx', [
    'tsx', '--test',
    'tests/assignmentConcurrency.integration.test.ts',
    'tests/batchApproval.integration.test.ts',
    'tests/absenceAssignmentConcurrency.integration.test.ts',
    'tests/backupRoundTrip.integration.test.ts',
    'tests/requestIdempotency.integration.test.ts',
    'tests/transactionalOutbox.integration.test.ts',
    'tests/exportAndTeacherProfile.integration.test.ts',
  ]);
  process.exit(testCode);
}

void main();
