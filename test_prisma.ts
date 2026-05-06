import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const t = await prisma.teacher.findMany({
    where: {
      stammschule: { schulamtId: "54d23d8b-01e1-4b6a-b6de-a75b3a01ff25" },
      schoolYear: "2025/2026"
    }
  });
  console.log("Teachers found:", t.length);
}
main();
