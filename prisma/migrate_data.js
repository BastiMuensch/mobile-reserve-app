const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const bcrypt = require('bcryptjs')

async function main() {
  console.log('Migrating existing data...');
  // Find a Schulamt
  let schulamt = await prisma.user.findFirst({
    where: { role: 'SCHULAMT' }
  });
  
  if (!schulamt) {
    console.log('No Schulamt found. Creating one...');
    schulamt = await prisma.user.create({
      data: {
        email: 'admin@schulamt-unterallgaeu.de',
        password: await bcrypt.hash('password123', 10),
        name: 'Schulamt Unterallgäu',
        role: 'SCHULAMT',
      }
    });
  }

  // Update System Admin if exists to new credentials, or create
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  const newAdminPassword = await bcrypt.hash('4dm1np0rt4l', 10);
  
  if (admin) {
    await prisma.user.update({
      where: { id: admin.id },
      data: { email: 'sebastian@cloud-muensch.de', password: newAdminPassword }
    });
    console.log('Updated existing Admin user.');
  } else {
    await prisma.user.create({
      data: {
        email: 'sebastian@cloud-muensch.de',
        password: newAdminPassword,
        name: 'System-Administrator',
        role: 'ADMIN',
      }
    });
    console.log('Created Admin user.');
  }

  // Associate all existing schools with this Schulamt
  const result = await prisma.school.updateMany({
    where: { schulamtId: null },
    data: { schulamtId: schulamt.id }
  });
  
  console.log(`Updated ${result.count} schools to belong to Schulamt ${schulamt.name}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
