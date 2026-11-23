import { parseDateKeyStrict, toLocalDateInputValue } from './dateKey';

// BayMBl. 2022 Nr. 747: https://www.verkuendung-bayern.de/baymbl/2022-747/
// Inclusive ranges, including summer 2030. Extend before planning 2030/31.
const vacations = [
  ['2024-07-29','2024-09-09'],['2024-10-28','2024-10-31'],['2024-12-23','2025-01-03'],
  ['2025-03-03','2025-03-07'],['2025-04-14','2025-04-25'],['2025-06-10','2025-06-20'],
  ['2025-08-01','2025-09-15'],['2025-11-03','2025-11-07'],['2025-12-22','2026-01-05'],
  ['2026-02-16','2026-02-20'],['2026-03-30','2026-04-10'],['2026-05-26','2026-06-05'],
  ['2026-08-03','2026-09-14'],['2026-11-02','2026-11-06'],['2026-12-24','2027-01-08'],
  ['2027-02-08','2027-02-12'],['2027-03-22','2027-04-02'],['2027-05-18','2027-05-28'],
  ['2027-08-02','2027-09-13'],['2027-11-02','2027-11-05'],['2027-12-24','2028-01-07'],
  ['2028-02-28','2028-03-03'],['2028-04-10','2028-04-21'],['2028-06-06','2028-06-16'],
  ['2028-07-31','2028-09-11'],['2028-10-30','2028-11-03'],['2028-12-23','2029-01-05'],
  ['2029-02-12','2029-02-16'],['2029-03-26','2029-04-06'],['2029-05-22','2029-06-01'],
  ['2029-07-30','2029-09-10'],['2029-10-29','2029-11-02'],['2029-12-24','2030-01-04'],
  ['2030-03-04','2030-03-08'],['2030-04-15','2030-04-26'],['2030-06-11','2030-06-21'],
  ['2030-07-29','2030-09-09'],
];
function easter(year: number): Date {
  const a=year%19, b=Math.floor(year/100), c=year%100, d=Math.floor(b/4), e=b%4;
  const f=Math.floor((b+8)/25), g=Math.floor((b-f+1)/3), h=(19*a+b-d-g+15)%30;
  const i=Math.floor(c/4), k=c%4, l=(32+2*e+2*i-h-k)%7, m=Math.floor((a+11*h+22*l)/451);
  const n=h+l-7*m+114;
  return new Date(Date.UTC(year, Math.floor(n/31)-1, n%31+1));
}
/** Unterrichtsfrei does not imply dienstfrei. Regional August holidays fall in summer vacation. */
export function schoolFreeReason(value: Date | string): string | null {
  const key = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : toLocalDateInputValue(new Date(value));
  const date = parseDateKeyStrict(key);
  if ([0,6].includes(date.getUTCDay())) return 'Wochenende';
  const year = date.getUTCFullYear();
  const fixed: Record<string,string> = {'01-01':'Neujahr','01-06':'Heilige Drei Könige','05-01':'Tag der Arbeit','10-03':'Tag der Deutschen Einheit','11-01':'Allerheiligen','12-25':'1. Weihnachtstag','12-26':'2. Weihnachtstag'};
  if (fixed[key.slice(5)]) return fixed[key.slice(5)];
  const repentance = new Date(Date.UTC(year,10,22));
  repentance.setUTCDate(22-(repentance.getUTCDay()-3+7)%7);
  if (key === repentance.toISOString().slice(0,10)) return 'Buß- und Bettag (unterrichtsfrei)';
  const distance = (date.getTime()-easter(year).getTime())/86400000;
  const movable: Record<number,string> = {'-2':'Karfreitag',1:'Ostermontag',39:'Christi Himmelfahrt',50:'Pfingstmontag',60:'Fronleichnam'};
  if (movable[distance]) return movable[distance];
  if (vacations.some(([start,end]) => key >= start && key <= end)) return 'Bayerische Schulferien';
  return null;
}

export function assignmentCalendarWarning(
  assignment: { date: Date | string; status: string },
  today: string,
) {
  if (assignment.status !== 'PENDING' && assignment.status !== 'ACCEPTED') return null;
  const date = toLocalDateInputValue(new Date(assignment.date));
  const reason = date >= today ? schoolFreeReason(date) : null;
  return reason ? { date, reason } : null;
}
