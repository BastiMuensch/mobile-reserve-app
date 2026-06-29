import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const profiles = await prisma.schulamtProfile.findMany();
  console.log(profiles);
}
main().catch(console.error).finally(() => prisma.$disconnect());
