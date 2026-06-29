import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const user = await prisma.user.findUnique({ where: { email: 'admin@schulamt-unterallgaeu.de' }});
  const teachers = await prisma.teacher.findMany({
    where: {
      stammschule: { schulamtId: user?.id },
      schoolYear: '2025/2026'
    },
    include: { stammschule: true }
  });
  console.log("Teachers length:", teachers.length);
  if (teachers.length > 0) {
    console.log("First teacher:", teachers[0].name, teachers[0].stammschule.name);
  }
}
main();
