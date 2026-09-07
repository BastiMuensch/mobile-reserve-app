import { PrismaClient } from '@prisma/client';
import { access, copyFile, mkdir, unlink } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

const prisma = new PrismaClient();
const SAFE_FILENAME = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(png|jpe?g)$/i;

function privateDirectory() {
  return process.env.PRIVATE_UPLOADS_DIR || path.join(process.cwd(), 'private-uploads', 'signatures');
}

function filenameFromUrl(url, prefix) {
  if (typeof url !== 'string' || !url.startsWith(prefix)) return null;
  const filename = url.slice(prefix.length);
  return SAFE_FILENAME.test(filename) ? filename : null;
}

async function exists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log('Migration öffentlicher Unterschriften wird gestartet …');
  const profiles = await prisma.schulamtProfile.findMany({
    where: { signatureUrl: { not: null } },
    select: { id: true, userId: true, signatureUrl: true },
  });

  const privateDir = privateDirectory();
  const publicDir = path.join(process.cwd(), 'public', 'uploads');
  await mkdir(privateDir, { recursive: true });
  let migratedCount = 0;
  let skippedCount = 0;

  for (const profile of profiles) {
    const url = profile.signatureUrl;
    if (!url) continue;

    const existingFilename = filenameFromUrl(url, '/api/media/');
    if (existingFilename) {
      const targetPath = path.join(privateDir, existingFilename);
      if (!await exists(targetPath)) {
        console.warn(`Übersprungen ${profile.id}: private Unterschriftsdatei fehlt.`);
        skippedCount += 1;
        continue;
      }
      await prisma.uploadedAsset.upsert({
        where: { url },
        update: { ownerUserId: profile.userId, purpose: 'signature' },
        create: { ownerUserId: profile.userId, url, purpose: 'signature' },
      });
      skippedCount += 1;
      continue;
    }

    const filename = filenameFromUrl(url, '/uploads/');
    if (!filename) {
      console.warn(`Übersprungen ${profile.id}: ungültige alte Unterschrifts-URL.`);
      skippedCount += 1;
      continue;
    }

    const sourcePath = path.join(publicDir, filename);
    if (!await exists(sourcePath)) {
      console.warn(`Übersprungen ${profile.id}: öffentliche Unterschriftsdatei fehlt.`);
      skippedCount += 1;
      continue;
    }

    const targetPath = path.join(privateDir, filename);
    const targetAlreadyExisted = await exists(targetPath);
    if (!targetAlreadyExisted) {
      await copyFile(sourcePath, targetPath, fsConstants.COPYFILE_EXCL);
    }

    const privateUrl = `/api/media/${filename}`;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.schulamtProfile.update({ where: { id: profile.id }, data: { signatureUrl: privateUrl } });
        await tx.uploadedAsset.upsert({
          where: { url: privateUrl },
          update: { ownerUserId: profile.userId, purpose: 'signature' },
          create: { ownerUserId: profile.userId, url: privateUrl, purpose: 'signature' },
        });
        await tx.uploadedAsset.deleteMany({
          where: { ownerUserId: profile.userId, url, purpose: 'signature' },
        });
      });
    } catch (error) {
      if (!targetAlreadyExisted) await unlink(targetPath).catch(() => undefined);
      throw error;
    }

    // Erst nach dauerhaft aktualisierter Datenbank wird die öffentliche Kopie entfernt.
    await unlink(sourcePath).catch((error) => {
      console.warn(`Profil ${profile.id} wurde migriert; die alte öffentliche Kopie konnte nicht entfernt werden:`, error);
    });
    migratedCount += 1;
  }

  console.log(`Migration abgeschlossen. Migriert: ${migratedCount}, übersprungen: ${skippedCount}.`);
}

main()
  .catch((error) => {
    console.error('Migration fehlgeschlagen:', error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
