const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany();
  let updated = 0;
  for (const u of users) {
    const fixed = u.email.trim().toLowerCase();
    if (fixed !== u.email) {
      await prisma.user.update({ where: { id: u.id }, data: { email: fixed } });
      updated++;
      console.log(`Fixed email for user ${u.id}: "${u.email}" -> "${fixed}"`);
    }
  }
  console.log(`Updated ${updated} users.`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
