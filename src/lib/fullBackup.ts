import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { prisma } from '@/lib/prisma';
import { getPrivateSignaturesDir, getPublicUploadsDir } from '@/lib/mediaStorage';
import { captureEnvironment, createFullBackup } from '../../scripts/full-backup-runtime.mjs';
import { encryptBackup } from '../../scripts/full-backup-format.mjs';

const BACKUP_LOCK = 721084129;

export async function createEncryptedInstanceBackup(password: string) {
  const environment = captureEnvironment();
  const privateRoot = process.env.FULL_BACKUP_PRIVATE_ROOT || path.join(process.cwd(), 'private-uploads');
  const customSignatures = path.resolve(getPrivateSignaturesDir()) !== path.join(privateRoot, 'signatures');
  const roots: Record<string, string> = { 'public-uploads': getPublicUploadsDir(), 'private-uploads': privateRoot };
  if (customSignatures) roots['custom-signatures'] = getPrivateSignaturesDir();
  const deploymentCompose = await readFile(path.join(process.cwd(), 'docker-compose.prod.yml'), 'utf8');
  const payload = await prisma.$transaction(async tx => {
    const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${BACKUP_LOCK}) AS locked`;
    if (!lock.locked) throw new Error('BACKUP_BUSY');
    const [snapshot] = await tx.$queryRaw<{ snapshot: string; version: string }[]>`SELECT pg_export_snapshot() AS snapshot, current_setting('server_version') AS version`;
    const profiles = await tx.schulamtProfile.findMany({ select: { logoUrl: true, signatureUrl: true } });
    const schools = await tx.school.findMany({ select: { imageUrl: true } });
    const logo = await tx.systemSetting.findUnique({ where: { id: 'loginLogoUrl' } });
    const urls = [...profiles.flatMap(p => [p.logoUrl, p.signatureUrl]), ...schools.map(s => s.imageUrl), logo?.value];
    const requiredFiles = urls.flatMap(url => {
      if (!url) return [];
      if (url.startsWith('/uploads/')) return [`public-uploads/${url.slice('/uploads/'.length)}`];
      if (url.startsWith('/api/media/')) return [`${customSignatures ? 'custom-signatures' : 'private-uploads/signatures'}/${url.slice('/api/media/'.length)}`];
      return [];
    });
    return createFullBackup({ databaseUrl: environment.DATABASE_URL, snapshot: snapshot.snapshot, environment, roots, requiredFiles,
      appVersion: process.env.APP_VERSION || 'development', appCommit: process.env.APP_COMMIT_SHA || 'unknown',
      postgresVersion: snapshot.version, deploymentCompose });
  }, { isolationLevel: 'RepeatableRead', maxWait: 10000, timeout: 180000 });
  return encryptBackup(payload, password);
}
