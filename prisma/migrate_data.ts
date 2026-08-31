import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  console.log('Migrating existing data...');
  // Find a Schulamt
  const targetEmail = process.env.TARGET_SCHULAMT_EMAIL?.trim().toLowerCase();
  if (!targetEmail) throw new Error('TARGET_SCHULAMT_EMAIL muss auf ein bereits eingerichtetes Schulamt zeigen.');
  const schulamt = await prisma.user.findUnique({ where: { email: targetEmail } });
  if (!schulamt || schulamt.role !== 'SCHULAMT') throw new Error('Ziel-Schulamt nicht gefunden. Es werden keine Konten automatisch erzeugt.');

  // Associate all existing schools with this Schulamt
  const result = await prisma.school.updateMany({
    where: { schulamtId: null },
    data: { schulamtId: schulamt.id }
  });
  
  console.log(`Updated ${result.count} schools to belong to Schulamt ${schulamt.name}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
