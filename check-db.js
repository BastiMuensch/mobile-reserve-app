const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    include: { school: true }
  });
  console.log(users.filter(u => u.role === 'SCHOOL').map(u => ({ email: u.email, school: u.school?.name })));
}
main().catch(console.error).finally(() => prisma.$disconnect());
