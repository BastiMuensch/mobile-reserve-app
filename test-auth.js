const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({ where: { email: 'gs-mindelheim@schule.de' } });
  console.log("Hash in DB:", user.password);
  console.log("Starts with $2:", user.password.startsWith('$2'));
  const match = await bcrypt.compare('password123', user.password);
  console.log("Matches 'password123':", match);
}
main().catch(console.error).finally(() => prisma.$disconnect());
