/** Synthetic, isolated browser-test fixtures. Never run against an application DB. */
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { getCurrentSchoolYear } from '../src/lib/schoolYear';

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/(^|[_-])test([_-]|$)/i.test(new URL(url).pathname.slice(1))) {
    throw new Error('An explicitly named TEST_DATABASE_URL is required.');
  }
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    if (await db.user.count() || await db.school.count()) throw new Error('UI fixtures require an empty test database.');
    const password = await hash('Ui-Test-Reserve-2026!', 12);
    const office = await db.user.create({ data: { email: 'schulamt@ui-test.local', password, name: 'Schulamt · UI-Test', role: 'SCHULAMT' } });
    await db.schulamtProfile.create({ data: {
      userId: office.id, headerText: 'Schulamt · UI-Test', returnAddress: 'Teststraße 1 · 80331 Beispielstadt',
      contactAddress: 'Teststraße 1 · 80331 Beispielstadt', contactPerson: 'Erika Beispiel', city: 'Beispielstadt',
      amtsleitungName: 'Erika Beispiel', amtsleitungTitle: 'Schulamtsdirektorin', mailProvider: 'NONE',
      latitude: 48.14, longitude: 11.57, lastBackupDate: new Date(),
    } });
    const schools = await Promise.all(['Grundschule am Park', 'Mittelschule Nord', 'Grundschule an der Au'].map((name, index) => db.school.create({ data: {
      name, address: `Beispielweg ${index + 1}, 80331 Beispielstadt`, schulamtId: office.id,
      type: index === 1 ? 'MITTELSCHULE' : 'GRUNDSCHULE', latitude: 48.13 + index * .017, longitude: 11.56 + index * .013,
      geocodingStatus: 'MANUAL', generalInfo: 'Bitte im Sekretariat melden. Dies sind ausschließlich Testdaten.',
      user: { create: { email: `schule${index + 1}@ui-test.local`, password, role: 'SCHOOL' } },
    } })));
    const teachers = await Promise.all(['Anna Beispiel', 'Lukas Muster', 'Mia Beispiel', 'Jonas Muster', 'Sofia Beispiel', 'Paul Muster', 'Eva Beispiel', 'Ben Muster'].map((name, index) => db.teacher.create({ data: {
      name, email: `reserve${index + 1}@ui-test.local`, address: `Testweg ${index + 10}, 80331 Beispielstadt`, postalCode: '80331',
      stammschule: { connect: { id: schools[index % 3].id } }, maxWeeklyHours: 28, qualifications: 'Deutsch,Mathematik',
      status: index > 5 ? 'PENDING' : 'ACTIVE', schoolYear: getCurrentSchoolYear(), preferredType: 'BOTH',
      homeLat: 48.12 + index * .008, homeLng: 11.53 + (index % 4) * .025,
      user: { create: { email: `reserve${index + 1}@ui-test.local`, password, role: 'TEACHER', isActive: index < 6 } },
    } })));
    const day = new Date(); day.setHours(12, 0, 0, 0);
    while (day.getDay() === 0 || day.getDay() === 6) day.setDate(day.getDate() + 1);
    for (let index = 0; index < 4; index++) {
      const date = new Date(day); date.setDate(date.getDate() + index);
      const request = await db.request.create({ data: { schoolId: schools[index % 3].id, date, hours: 4, weeklyHours: 4, startHour: 1,
        schoolType: schools[index % 3].type, substitutedTeacher: 'Testlehrkraft', qualifications: 'Deutsch,Mathematik',
        status: index === 3 ? 'FILLED' : 'PENDING', comments: 'UI-Test: Keine reale Vertretungsanfrage.',
      } });
      if (index === 3) await db.assignment.create({ data: { requestId: request.id, teacherId: teachers[0].id, date, hours: 4, status: 'PENDING' } });
    }
    await db.emailOutbox.create({ data: { schulamtId: office.id, status: 'FAILED', lastError: 'UI-Test: SMTP nicht eingerichtet.' } });
    console.log('Synthetic UI fixtures created; mail disabled. Accounts: schulamt@ui-test.local, schule1@ui-test.local, reserve1@ui-test.local. Test-only password: Ui-Test-Reserve-2026!');
  } finally { await db.$disconnect(); }
}
void main();
