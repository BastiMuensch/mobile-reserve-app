import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const schulamtId = "some-uuid";
  const schoolIds: string[] = [];
  const teacherIds: string[] = [];
  
  try {
    const usersRaw = await prisma.user.findMany({
      where: {
        OR: [
          { schoolId: { in: schoolIds } },
          { teachers: { some: { id: { in: teacherIds } } } }
        ]
      }
    });
    console.log("Success:", usersRaw.length);
  } catch (e) {
    console.error("Error:", e);
  }
}
main()
