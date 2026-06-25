import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Updating database records to remove health-related terminology...');
  
  const updatedTeachers = await prisma.teacher.updateMany({
    where: { status: 'SICK' },
    data: { status: 'UNAVAILABLE' }
  });
  console.log(`Updated ${updatedTeachers.count} teachers from SICK to UNAVAILABLE.`);

  const updatedRequests = await prisma.request.updateMany({
    where: { priority: 'ERKRANKUNG' },
    data: { priority: 'UNPLANNED_ABSENCE' }
  });
  console.log(`Updated ${updatedRequests.count} requests from ERKRANKUNG to UNPLANNED_ABSENCE.`);

  const updatedAbsences = await prisma.absence.updateMany({
    where: { type: 'SICK' },
    data: { type: 'UNAVAILABLE' }
  });
  console.log(`Updated ${updatedAbsences.count} absences from SICK to UNAVAILABLE.`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
