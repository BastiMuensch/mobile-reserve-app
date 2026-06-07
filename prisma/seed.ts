import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function hashPw(pw: string) {
  return bcrypt.hash(pw, 10);
}

async function main() {
  console.log('Clearing database...')
  await prisma.absence.deleteMany()
  await prisma.assignment.deleteMany()
  await prisma.request.deleteMany()
  await prisma.teacher.deleteMany()
  await prisma.schulamtProfile.deleteMany()
  await prisma.user.deleteMany()
  await prisma.school.deleteMany()

  console.log('Seeding users and schools...')
  
  // Seed System Admin
  await prisma.user.create({
    data: {
      email: 'sebastian@cloud-muensch.de',
      password: await hashPw('4dm1np0rt4l'),
      name: 'System-Administrator',
      role: 'ADMIN',
    }
  })

  // Seed a default Schulamt account
  const defaultSchulamt = await prisma.user.create({
    data: {
      email: 'admin@schulamt-unterallgaeu.de',
      password: await hashPw('password123'),
      name: 'Schulamt Unterallgäu',
      role: 'SCHULAMT',
      schulamtProfile: {
        create: {
          headerText: "Staatliche Schulämter im Landkreis Unterallgäu und in der Stadt Memmingen",
          returnAddress: "Staatliches Schulamt Unterallgäu - Kaiser-Max-Str. 1 - 87719 Mindelheim",
          logoUrl: null, // Renders default fallback image
          contactAddress: "Memminger Str. 18\n87719 Mindelheim\nTelefon 08261 995 341\nTelefax 08261 995 383",
          contactPerson: "Tamara Schmidt\nDurchwahl: 08261 995 441\nSchA\nschulamts@lra.unterallgaeu.de\nwww.schulamt.mm.unterallgaeu.de",
          city: "Mindelheim",
          amtsleitungName: "Ursula Abt",
          amtsleitungTitle: "Schulamtsdirektorin",
          signatureUrl: null // Renders default fallback signature
        }
      }
    }
  })

  // Schools
  const gsMindelheim = await prisma.school.create({
    data: {
      name: 'Grundschule Mindelheim',
      address: 'Brennerstraße 1, 87719 Mindelheim',
      latitude: 48.0494,
      longitude: 10.4859,
      type: 'GRUNDSCHULE',
      schulamtId: defaultSchulamt.id,
      user: {
        create: {
          email: 'gs-mindelheim@schule.de',
          password: await hashPw('password123'),
          role: 'SCHOOL'
        }
      }
    }
  })

  const msMindelheim = await prisma.school.create({
    data: {
      name: 'Mittelschule Mindelheim',
      address: 'Siedlerweg 2, 87719 Mindelheim',
      latitude: 48.0416,
      longitude: 10.4900,
      type: 'MITTELSCHULE',
      schulamtId: defaultSchulamt.id,
      user: {
        create: {
          email: 'ms-mindelheim@schule.de',
          password: await hashPw('password123'),
          role: 'SCHOOL'
        }
      }
    }
  })

  const gsBadWoerishofen = await prisma.school.create({
    data: {
      name: 'Grundschule Bad Wörishofen',
      address: 'Pestalozzistraße 2, 86825 Bad Wörishofen',
      latitude: 48.0069,
      longitude: 10.5950,
      type: 'GRUNDSCHULE',
      schulamtId: defaultSchulamt.id,
      user: {
        create: {
          email: 'gs-badwoerishofen@schule.de',
          password: await hashPw('password123'),
          role: 'SCHOOL'
        }
      }
    }
  })

  const msOttobeuren = await prisma.school.create({
    data: {
      name: 'Mittelschule Ottobeuren',
      address: 'Bergstraße 74, 87724 Ottobeuren',
      latitude: 47.9392,
      longitude: 10.2974,
      type: 'MITTELSCHULE',
      schulamtId: defaultSchulamt.id,
      user: {
        create: {
          email: 'ms-ottobeuren@schule.de',
          password: await hashPw('password123'),
          role: 'SCHOOL'
        }
      }
    }
  })

  console.log('Seeding teachers...')

  const annaUser = await prisma.user.create({
    data: {
      email: 'anna@schule.de',
      password: await hashPw('password123'),
      name: 'Anna Müller',
      role: 'TEACHER'
    }
  })

  const teachers = [
    {
      name: 'Anna Müller',
      email: 'anna@schule.de',
      phone: '2309109283709',
      stammschuleId: gsMindelheim.id,
      maxWeeklyHours: 28,
      qualifications: 'Grundschule',
      status: 'ACTIVE',
      address: 'Bgm.-Krach-Str. 4, 87719 Mindelheim',
      gender: 'FEMALE',
      homeLat: 48.0450, // Mindelheim area
      homeLng: 10.4800,
      preferredType: 'GRUNDSCHULE',
      userId: annaUser.id
    },
    {
      name: 'Markus Schmidt',
      stammschuleId: msMindelheim.id,
      maxWeeklyHours: 24,
      qualifications: 'Mittelschule',
      status: 'ACTIVE',
      address: 'Landsberger Str. 12, 87719 Mindelheim',
      gender: 'MALE',
      homeLat: 48.0350, // Mindelheim south
      homeLng: 10.4850,
      preferredType: 'MITTELSCHULE'
    },
    {
      name: 'Julia Weber',
      stammschuleId: gsBadWoerishofen.id,
      maxWeeklyHours: 14, // Part-time
      qualifications: 'Alles',
      status: 'ACTIVE',
      address: 'Fidel-Kreuzer-Str. 9, 86825 Bad Wörishofen',
      gender: 'FEMALE',
      homeLat: 48.0100, // Bad Wörishofen area
      homeLng: 10.6000,
      preferredType: 'BOTH'
    },
    {
      name: 'Thomas Wagner',
      stammschuleId: msOttobeuren.id,
      maxWeeklyHours: 28,
      qualifications: 'Mittelschule,Förderschule',
      status: 'SICK', // Currently sick
      address: 'Luitpoldstraße 3, 87724 Ottobeuren',
      gender: 'MALE',
      homeLat: 47.9400, // Ottobeuren area
      homeLng: 10.3000,
      preferredType: 'MITTELSCHULE'
    },
    {
      name: 'Sabine Becker',
      stammschuleId: gsMindelheim.id,
      maxWeeklyHours: 20,
      qualifications: 'Grundschule,Mittelschule',
      status: 'ACTIVE',
      address: 'Memminger Str. 45, 87719 Mindelheim',
      gender: 'FEMALE',
      homeLat: 48.0600, // North of Mindelheim
      homeLng: 10.4900,
      preferredType: 'GRUNDSCHULE'
    },
    {
      name: 'Stefan Hoffmann',
      stammschuleId: msMindelheim.id,
      maxWeeklyHours: 28,
      qualifications: 'Alles',
      status: 'ACTIVE',
      address: 'Ortsstraße 17, 87719 Mindelheim',
      gender: 'MALE',
      homeLat: 48.0200, // Between Mindelheim and Bad Wörishofen
      homeLng: 10.5300,
      preferredType: 'MITTELSCHULE'
    },
    {
      name: 'Lisa Bauer',
      stammschuleId: gsBadWoerishofen.id,
      maxWeeklyHours: 28,
      qualifications: 'Grundschule',
      status: 'LEAVE', // On leave
      address: 'Kaufbeurer Str. 22, 86825 Bad Wörishofen',
      gender: 'FEMALE',
      homeLat: 47.9800, 
      homeLng: 10.6100,
      preferredType: 'BOTH'
    }
  ]

  const createdTeachers: Record<string, string> = {};
  for (const teacher of teachers) {
    const t = await prisma.teacher.create({ data: teacher });
    createdTeachers[t.name] = t.id;
  }

  console.log('Seeding past requests and assignments...');
  
  // Seeding a past request (e.g. May 15, 2026)
  const pastRequest = await prisma.request.create({
    data: {
      schoolId: gsMindelheim.id,
      date: new Date('2026-05-15T08:00:00Z'),
      priority: 'ERKRANKUNG',
      hours: 6,
      weeklyHours: 6,
      schoolType: 'GRUNDSCHULE',
      substitutedTeacher: 'Frau Meier',
      qualifications: 'Grundschule',
      status: 'FILLED'
    }
  });

  // Seeding a past assignment assigned to Anna Müller
  await prisma.assignment.create({
    data: {
      requestId: pastRequest.id,
      teacherId: createdTeachers['Anna Müller'],
      date: new Date('2026-05-15T08:00:00Z'),
      hours: 6,
      status: 'ACCEPTED'
    }
  });

  console.log('Seed completed successfully.');
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
