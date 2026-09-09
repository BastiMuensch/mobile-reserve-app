import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';

export const models = ['user', 'school', 'teacher', 'request', 'assignment', 'absence', 'leavePeriod', 'schulamtProfile', 'systemSetting', 'teacherInvitation', 'passwordResetToken', 'pushSubscription', 'uploadedAsset', 'emailOutbox', 'postalCodeGeocode'];
export function demoDates(start = '2026-09-14') {
  const date = new Date(`${start}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(+date) || date.toISOString().slice(0, 10) !== start) throw new Error('Ungültiges Startdatum (YYYY-MM-DD).');
  if ([0, 6].includes(date.getUTCDay())) throw new Error('Das Startdatum muss ein Montag bis Freitag sein.');
  const days = [];
  while (days.length < 25) {
    if (![0, 6].includes(date.getUTCDay())) days.push(date.toISOString());
    date.setUTCDate(date.getUTCDate() + 1);
  }
  const year = dateKeyYear(start);
  if (days.some(day => dateKeyYear(day.slice(0, 10)) !== year)) throw new Error('Die fünf Demowochen müssen innerhalb eines Schuljahres liegen.');
  return { days, year };
}
function dateKeyYear(day) {
  const year = Number(day.slice(0, 4)) - (Number(day.slice(5, 7)) < 9 ? 1 : 0);
  return `${year}/${year + 1}`;
}

export async function createDemo(start) {
  const { days, year } = demoDates(start);
  const data = Object.fromEntries(models.map(model => [model, []]));
  const credentials = [];
  async function account(name, email, role, isActive = true) {
    const password = randomBytes(18).toString('base64url');
    const user = { id: randomUUID(), name, email, role, password: await bcrypt.hash(password, 12), isActive };
    data.user.push(user);
    credentials.push({ name, email, role, password, isActive });
    return user;
  }
  const office = await account('Schulamt Sonnenhain · DEMO', 'schulamt@sonnenhain.example', 'SCHULAMT');
  data.schulamtProfile.push({ id: randomUUID(), userId: office.id, headerText: 'DEMO · Schulamt Sonnenhain', returnAddress: 'DEMO · Rathausplatz 1 · 80331 Sonnenhain', contactAddress: 'Rathausplatz 1\n80331 Sonnenhain\nFiktive Anschrift – keine Post zustellen', contactPerson: 'Dr. Jule Linden · Demo-Ansprechperson', city: 'Sonnenhain (Demo)', amtsleitungName: 'Dr. Jule Linden', amtsleitungTitle: 'Schulamtsdirektorin (fiktiv)', latitude: 48.14, longitude: 11.57, mailProvider: 'NONE', documentSubject: 'DEMO – Verwendung als mobile Reserve', documentIntro: 'Fiktives Demonstrationsdokument, keine dienstliche Verfügung. Zur Verwendung als mobile Reserve werden Sie wie folgt eingesetzt:', documentClosing: 'Mit freundlichen Grüßen\nDEMO – nicht zur Vorlage bestimmt' });
  // Legal text deliberately omitted: the unchanged Prisma default is used.
  data.systemSetting.push(...Object.entries({ demoMode: 'true', publicInstanceName: 'MobileReserve.digital · DEMO Sonnenhain', publicSupportContact: 'Demonstrationsinstanz – bitte keine echten personenbezogenen Daten eingeben.', impressum: '', privacyPolicy: '', loginLogoUrl: '', loginLogoAlt: '' }).map(([id, value]) => ({ id, value })));
  const schoolNames = ['Grundschule am Sonnenpark', 'Mittelschule Lindenhöhe', 'Grundschule am Mühlbach', 'Mittelschule Am Birkenrain', 'Grundschule Regenbogen', 'Grundschule An der Waldwiese'];
  for (const [index, name] of schoolNames.entries()) {
    const user = await account(name, `schule${index + 1}@sonnenhain.example`, 'SCHOOL');
    const id = randomUUID(), latitude = 48.12 + index * .009, longitude = 11.54 + (index % 3) * .025;
    user.schoolId = id;
    data.school.push({ id, name, schulamtId: office.id, address: `Fiktiver Schulweg ${index + 1}, 80331 Sonnenhain`, type: index === 1 || index === 3 ? 'MITTELSCHULE' : 'GRUNDSCHULE', latitude, longitude, entranceLat: latitude, entranceLng: longitude, parkingLat: latitude + .0003, parkingLng: longitude + .0004, geocodingStatus: 'MANUAL', isSmall: index === 5, generalInfo: 'DEMO: Eingang und Parkplatz sind Beispielpins, keine tatsächlichen Schulstandorte. Bitte zuerst im Sekretariat melden. Unterrichtsmaterial liegt bereit.' });
  }
  const names = ['Mara Linden', 'Jonas Falken', 'Nele Sommerfeld', 'Emil Wiesen', 'Lina Buchen', 'Theo Morgen', 'Frieda Seebach', 'Anton Bergfeld', 'Clara Fichten', 'Oskar Sternau', 'Ida Rosenfeld', 'Paul Winterhain'];
  for (const [index, name] of names.entries()) {
    const user = await account(name, `reserve${index + 1}@sonnenhain.example`, 'TEACHER', index !== 10);
    const teacher = { id: randomUUID(), userId: user.id, name, email: user.email, stammschuleId: data.school[index % 6].id, maxWeeklyHours: index === 7 ? 15 : 28, isPartTime: index === 7, schedule: index === 7 ? JSON.stringify({ 1: [1, 2, 3], 2: [1, 2, 3], 3: [1, 2, 3], 4: [1, 2, 3], 5: [1, 2, 3] }) : null, qualifications: index % 2 ? 'Deutsch,Mathematik,Englisch' : 'Deutsch,Mathematik,Sport', status: index === 10 ? 'PENDING' : 'ACTIVE', address: `Fiktiver Wohnweg ${index + 1}, 80331 Sonnenhain`, postalCode: '80331', homeLat: 48.105 + index * .005, homeLng: 11.52 + (index % 4) * .023, preferredType: index === 6 ? 'MITTELSCHULE' : 'BOTH', schoolYear: year };
    data.teacher.push(teacher);
    if (index === 11) teacher.schoolYear = `${Number(year.slice(0, 4)) - 1}/${year.slice(0, 4)}`;
    if (index === 8) data.absence.push({ id: randomUUID(), teacherId: teacher.id, date: days[2], type: 'UNAVAILABLE', reason: 'Fiktive Nichtverfügbarkeit für die Demonstration' });
    if (index === 9) data.leavePeriod.push({ id: randomUUID(), teacherId: teacher.id, startDate: days[0], endDate: days[9], reportedBy: 'SCHULAMT' });
  }
  // Five requests per week: two open, one partial, two filled. No overlap
  // between seeded assignments; all assigned teachers are active full-time.
  for (let index = 0; index < 25; index++) {
    const school = data.school[index % 6], date = days[index];
    const kind = index % 5, hours = 4, assignedHours = kind === 2 ? 2 : kind >= 3 ? 4 : 0;
    const request = { id: randomUUID(), schoolId: school.id, date, hours, weeklyHours: hours, startHour: 1, schoolType: school.type, substitutedTeacher: `Alex Beispiel ${index + 1}`, qualifications: 'Deutsch,Mathematik', priority: ['UNPLANNED_ABSENCE', 'FORTBILDUNG', 'SCHULINTERN'][index % 3], comments: 'DEMO – fiktive Vertretungsanfrage. Material und Raumplan liegen im Sekretariat.', status: !assignedHours ? 'PENDING' : assignedHours < hours ? 'PARTIALLY_FILLED' : 'FILLED' };
    data.request.push(request);
    if (assignedHours) data.assignment.push({ id: randomUUID(), requestId: request.id, teacherId: data.teacher[index % 6].id, date, hours: assignedHours, status: kind === 3 ? 'ACCEPTED' : 'PENDING' });
  }
  return { seed: { format: 'mobile-reserve-demo-v1', start: days[0].slice(0, 10), schoolYear: year, data }, credentials };
}
