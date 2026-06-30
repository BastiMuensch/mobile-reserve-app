import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function hashPw(pw: string) {
  return bcrypt.hash(pw, 10);
}

async function main() {
  console.log('Suche Schulamt Musterstadt...')
  
  let musterstadtUser = await prisma.user.findUnique({
    where: { email: 'admin@schulamt-musterstadt.de' }
  });

  if (!musterstadtUser) {
    console.log('Schulamt Musterstadt nicht gefunden! Erstelle es neu...');
    musterstadtUser = await prisma.user.create({
      data: {
        email: 'admin@schulamt-musterstadt.de',
        password: await hashPw('musterstadt123'),
        name: 'Schulamt Musterstadt',
        role: 'SCHULAMT',
        schulamtProfile: {
          create: {
            headerText: "Staatliches Schulamt Musterstadt",
            returnAddress: "Schulamt Musterstadt - Marktplatz 1 - 87700 Memmingen",
            contactAddress: "Marktplatz 1\n87700 Memmingen\nTelefon 08331 12345",
            contactPerson: "Max Mustermann\nSchulamtsdirektor",
            city: "Memmingen",
            amtsleitungName: "Max Mustermann",
            amtsleitungTitle: "Schulamtsdirektor",
          }
        }
      }
    });
  }

  console.log('Erstelle Fantasieschulen...');

  const s1 = await prisma.school.create({
    data: {
      name: 'Grundschule am Marktplatz',
      address: 'Marktplatz 1, 87700 Memmingen',
      latitude: 47.9868,
      longitude: 10.1813,
      type: 'GRUNDSCHULE',
      schulamtId: musterstadtUser.id,
      user: {
        create: { email: 'marktplatz@musterstadt.de', password: await hashPw('schule123'), role: 'SCHOOL' }
      }
    }
  });

  const s2 = await prisma.school.create({
    data: {
      name: 'Burg-Mittelschule',
      address: 'Burg 1, 87719 Mindelheim', // Mindelburg
      latitude: 48.0375,
      longitude: 10.4812,
      type: 'MITTELSCHULE',
      schulamtId: musterstadtUser.id,
      user: {
        create: { email: 'burg@musterstadt.de', password: await hashPw('schule123'), role: 'SCHOOL' }
      }
    }
  });

  const s3 = await prisma.school.create({
    data: {
      name: 'Basilika-Grundschule',
      address: 'Sebastian-Kneipp-Straße 1, 87724 Ottobeuren', // Kloster
      latitude: 47.9405,
      longitude: 10.2985,
      type: 'GRUNDSCHULE',
      schulamtId: musterstadtUser.id,
      user: {
        create: { email: 'basilika@musterstadt.de', password: await hashPw('schule123'), role: 'SCHOOL' }
      }
    }
  });

  const s4 = await prisma.school.create({
    data: {
      name: 'Kurpark-Grundschule',
      address: 'Kneippstraße 1, 86825 Bad Wörishofen', // Kurpark
      latitude: 48.0031,
      longitude: 10.5926,
      type: 'GRUNDSCHULE',
      schulamtId: musterstadtUser.id,
      user: {
        create: { email: 'kurpark@musterstadt.de', password: await hashPw('schule123'), role: 'SCHOOL' }
      }
    }
  });

  const s5 = await prisma.school.create({
    data: {
      name: 'Flugplatz-Mittelschule',
      address: 'Am Flughafen 42, 87766 Memmingerberg', // Allgäu Airport
      latitude: 47.9890,
      longitude: 10.2395,
      type: 'MITTELSCHULE',
      schulamtId: musterstadtUser.id,
      user: {
        create: { email: 'flugplatz@musterstadt.de', password: await hashPw('schule123'), role: 'SCHOOL' }
      }
    }
  });

  console.log('Erstelle Lehrkräfte...');

  const teachers = [
    { name: 'Lukas Sonnenschein', stammschuleId: s1.id, maxWeeklyHours: 28, qualifications: 'Grundschule', status: 'ACTIVE', address: 'Buxacher Str. 12, 87700 Memmingen', gender: 'MALE', homeLat: 47.986, homeLng: 10.170, preferredType: 'GRUNDSCHULE' },
    { name: 'Julia Zauberwald', stammschuleId: s2.id, maxWeeklyHours: 24, qualifications: 'Mittelschule', status: 'ACTIVE', address: 'Kaufbeurer Str. 20, 87719 Mindelheim', gender: 'FEMALE', homeLat: 48.040, homeLng: 10.495, preferredType: 'MITTELSCHULE' },
    { name: 'Felix Sternenstaub', stammschuleId: s3.id, maxWeeklyHours: 14, isPartTime: true, qualifications: 'Alles', status: 'ACTIVE', address: 'Luitpoldstraße 5, 87724 Ottobeuren', gender: 'MALE', homeLat: 47.940, homeLng: 10.300, preferredType: 'BOTH' },
    { name: 'Sabrina Mondlicht', stammschuleId: s4.id, maxWeeklyHours: 28, qualifications: 'Grundschule', status: 'UNAVAILABLE', address: 'Hermann-Aust-Straße 10, 86825 Bad Wörishofen', gender: 'FEMALE', homeLat: 48.005, homeLng: 10.590, preferredType: 'GRUNDSCHULE' },
    { name: 'Tobias Wolkenflug', stammschuleId: s5.id, maxWeeklyHours: 28, qualifications: 'Mittelschule,Sport', status: 'ACTIVE', address: 'Augsburger Str. 30, 87766 Memmingerberg', gender: 'MALE', homeLat: 47.990, homeLng: 10.230, preferredType: 'MITTELSCHULE' },
    { name: 'Leonie Rosenrot', stammschuleId: s1.id, maxWeeklyHours: 20, qualifications: 'Grundschule,Musik', status: 'ACTIVE', address: 'Donaustraße 15, 87700 Memmingen', gender: 'FEMALE', homeLat: 47.995, homeLng: 10.180, preferredType: 'GRUNDSCHULE' },
    { name: 'Maximilian Sturmbringer', stammschuleId: s2.id, maxWeeklyHours: 28, qualifications: 'Mittelschule,Technik', status: 'ACTIVE', address: 'Frundsbergstraße 8, 87719 Mindelheim', gender: 'MALE', homeLat: 48.045, homeLng: 10.485, preferredType: 'MITTELSCHULE' },
    { name: 'Elena Regenmacher', stammschuleId: s3.id, maxWeeklyHours: 28, qualifications: 'Grundschule', status: 'LEAVE', address: 'Klosterwald 1, 87724 Ottobeuren', gender: 'FEMALE', homeLat: 47.935, homeLng: 10.290, preferredType: 'GRUNDSCHULE' },
  ];

  for (const t of teachers) {
    await prisma.teacher.create({ data: { ...t, schoolYear: '2025/2026' } });
  }

  console.log('Seed abgeschlossen!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
