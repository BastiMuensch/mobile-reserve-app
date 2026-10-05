import { deploymentSchoolName } from "@/lib/schoolLocations";
import ExcelJS from 'exceljs';

export interface YearExportAssignment {
  date: Date | string;
  hours: number;
  status: string;
  teacher: { name: string };
}

export interface YearExportRequest {
  location?: { name: string } | null;
  date: Date | string;
  endDate: Date | string | null;
  school: { name: string };
  schoolType: string;
  weeklyHours: number;
  hours: number;
  priority: string;
  status: string;
  substitutedTeacher: string | null;
  comments: string | null;
  assignments: YearExportAssignment[];
}

/** Keep spreadsheet text inert even when a database value starts with a formula prefix. */
export function sanitizeExportCell(value: unknown): unknown {
  return typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

const formatDate = (date: Date | string) => new Date(date).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });

/** Shared annual overview used by the regular export and by the school-year archive. */
export async function createYearExportWorkbook(input: { requests: YearExportRequest[] }): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Anforderungen');
  const assignmentsSheet = workbook.addWorksheet('Einsätze');
  assignmentsSheet.columns = [
    { header: 'Datum', width: 14 }, { header: 'Schule', width: 35 }, { header: 'Lehrkraft', width: 30 },
    { header: 'Stunden', width: 12 }, { header: 'Status', width: 20 }, { header: 'Aktive Stunden (ohne Stornierungen)', width: 35 },
  ];
  const statusLabels: Record<string, string> = { REJECTED: 'Storniert', ACCEPTED: 'Bestätigt', PENDING: 'Bestätigung offen' };
  worksheet.columns = [
    { header: 'Datum', width: 12 }, { header: 'Bis Datum', width: 12 }, { header: 'Schule', width: 30 },
    { header: 'Schulart', width: 14 }, { header: 'Bedarf pro Woche / Einzeltag', width: 28 }, { header: 'Priorität', width: 14 },
    { header: 'Status', width: 16 }, { header: 'Zu vertreten', width: 20 }, { header: 'Kommentar', width: 30 },
    { header: 'Aktiv zugeteilte Lehrkräfte', width: 40 }, { header: 'Aktive Einsatzdaten im Schuljahr', width: 40 },
  ];

  for (const req of input.requests) {
    const active = req.assignments.filter(a => a.status !== 'REJECTED');
    worksheet.addRow([
      formatDate(req.date), req.endDate ? formatDate(req.endDate) : '–', sanitizeExportCell(deploymentSchoolName(req)),
      sanitizeExportCell(req.schoolType), req.weeklyHours || req.hours, sanitizeExportCell(req.priority),
      sanitizeExportCell(req.status), sanitizeExportCell(req.substitutedTeacher || '–'), sanitizeExportCell(req.comments || '–'),
      sanitizeExportCell([...new Set(active.map(a => a.teacher.name))].join(', ') || '–'),
      sanitizeExportCell(active.map(a => `${formatDate(a.date)}: ${a.hours}h`).join(', ') || '–'),
    ]);
    for (const assignment of req.assignments) assignmentsSheet.addRow([
      formatDate(assignment.date), sanitizeExportCell(deploymentSchoolName(req)), sanitizeExportCell(assignment.teacher.name), assignment.hours,
      statusLabels[assignment.status] || assignment.status, assignment.status === 'REJECTED' ? 0 : assignment.hours,
    ]);
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
