import { createHash } from 'crypto';
import fs from 'fs/promises';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { assignmentDay, type ProofAssignment } from './assignmentSeries';
import { createDeploymentProof } from './deploymentProof';
import { createGovernmentReportWorkbook } from './governmentReportExport';
import { governmentReportInputSchema, type GovernmentReportInput } from './governmentReport';
import { getImageRatioFromBuffer, getPdfImageFormatFromBuffer, safeMediaPath, safePublicPath, sanitizeFilenamePart } from './pdfGenerator';
import { buildRequestYearOverlapFilter } from './requestYearFilter';
import { schoolYearSchema } from './schoolYear';
import { createYearExportWorkbook, type YearExportRequest } from './yearExport';
import { ARCHIVE_MAX_BYTES } from './schoolYearArchiveZip';

const MAX_REQUESTS = 2_000;
const MAX_ASSIGNMENTS = 50_000;
const MAX_REPORTS = 24;
const MAX_PROOFS = 2_000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;

type ArchiveProfile = {
  headerText: string; returnAddress: string; contactAddress: string; contactPerson: string; city: string;
  documentSubject: string; documentIntro: string; documentClosing: string; amtsleitungName: string;
  amtsleitungTitle: string; logoUrl: string | null; signatureUrl: string | null;
};
type ArchiveAssignment = ProofAssignment & { teacherId: string; teacher: { id: string; name: string; address: string; gender: string | null; stammschule: { name: string; address: string } } };
type ArchiveRequest = Omit<YearExportRequest, 'school' | 'assignments'> & {
  id: string; status: string; substitutedTeacher: string | null; priority: string;
  school: { name: string; address: string }; assignments: ArchiveAssignment[];
};

export interface ArchiveBrandingAsset { url: string; sha256: string; bytes: number; data: Uint8Array; ratio: number; format: 'PNG' | 'JPEG' }
export interface ArchiveBrandingSnapshot { logo: ArchiveBrandingAsset | null; signature: ArchiveBrandingAsset | null }
export interface ArchiveReportSnapshot { date: Date; updatedAt: Date; payload: GovernmentReportInput }
export interface SchoolYearArchiveData {
  schulamtId: string;
  schoolYear: string;
  snapshotAt: string;
  period: { start: Date; end: Date };
  profile: ArchiveProfile;
  branding: ArchiveBrandingSnapshot;
  requests: ArchiveRequest[];
  reports: ArchiveReportSnapshot[];
  warnings: string[];
}
export interface ArchiveSummary {
  schoolYear: string;
  createdAt: string;
  requestCount: number;
  assignmentCount: number;
  proofCount: number;
  reportCount: number;
  warnings: string[];
}
export interface ArchiveFile { path: string; data: Uint8Array }
export class SchoolYearArchiveLimitError extends Error {
  readonly code = 'ARCHIVE_LIMIT';
  constructor(message: string) { super(message); this.name = 'SchoolYearArchiveLimitError'; }
}
const limitError = (message: string): never => { throw new SchoolYearArchiveLimitError(message); };

function validSchoolYear(value: string): string {
  const parsed = schoolYearSchema.safeParse(value);
  if (!parsed.success) throw new Error('Ungültiges Schuljahr.');
  const start = Number(value.slice(0, 4));
  if (start < 2000 || start > 2100) throw new Error('Schuljahr liegt außerhalb des zulässigen Archivbereichs.');
  return parsed.data;
}
function hash(data: Uint8Array) { return createHash('sha256').update(data).digest('hex'); }
function safeAssetPath(url: string, signature: boolean) { return signature ? safeMediaPath(url) : safePublicPath(url); }
async function snapshotAsset(url: string | null, signature: boolean): Promise<ArchiveBrandingAsset | null> {
  if (!url) return null;
  const file = safeAssetPath(url, signature);
  if (!file) throw new Error('Konfiguriertes Dokumentenbild hat keinen sicheren Speicherpfad.');
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 5 * 1024 * 1024) limitError('Dokumentenbild überschreitet die sichere Größe.');
  let data: Buffer;
  try { data = await fs.readFile(file); } catch { throw new Error('Konfiguriertes Dokumentenbild konnte nicht gelesen werden.'); }
  if (!data.length || data.length > MAX_FILE_BYTES) throw new Error('Konfiguriertes Dokumentenbild überschreitet die Archivgrenze.');
  // createDeploymentProof intentionally tolerates absent/bad files for ordinary UI use; an archive must fail closed instead.
  const format = getPdfImageFormatFromBuffer(data); const ratio = getImageRatioFromBuffer(data);
  return { url, sha256: hash(data), bytes: data.length, data: new Uint8Array(data), ratio, format };
}
const dateKey = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
const html = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
function filePart(value: string) { return sanitizeFilenamePart(value).replace(/^_+|_+$/g, '').slice(0, 80) || 'Lehrkraft'; }

/** Reads a strictly bounded, tenant-scoped repeatable-read snapshot. It never selects account credentials. */
export async function loadSchoolYearArchiveData(schulamtId: string, schoolYear: string): Promise<SchoolYearArchiveData> {
  if (!schulamtId || schulamtId.length > 200) throw new Error('Ungültige Schulamtskennung.');
  const year = validSchoolYear(schoolYear);
  // Both boundaries are Berlin local midnight (CEST on 1 September / 31 August), not UTC midnight.
  const start = new Date(`${year.slice(0, 4)}-09-01T00:00:00.000+02:00`);
  const end = new Date(`${Number(year.slice(0, 4)) + 1}-08-31T23:59:59.999+02:00`);
  const reportStart = new Date(`${year.slice(0, 4)}-09-01T00:00:00.000Z`);
  const reportEnd = new Date(`${Number(year.slice(0, 4)) + 1}-09-01T00:00:00.000Z`);
  const snapshot = await prisma.$transaction(async tx => {
    const overlap = buildRequestYearOverlapFilter(start, end);
    const requestWhere = { school: { schulamtId }, OR: [overlap, { assignments: { some: { date: { gte: start, lte: end } } } }] };
    const [requestCount, assignmentCount, reportCount] = await Promise.all([
      tx.request.count({ where: requestWhere }),
      tx.assignment.count({ where: { date: { gte: start, lte: end }, request: requestWhere } }),
      tx.governmentReport.count({ where: { schulamtId, date: { gte: reportStart, lt: reportEnd } } }),
    ]);
    if (requestCount > MAX_REQUESTS) limitError(`Zu viele Anforderungen für ein Archiv (maximal ${MAX_REQUESTS}).`);
    if (assignmentCount > MAX_ASSIGNMENTS) limitError(`Zu viele Einsätze für ein Archiv (maximal ${MAX_ASSIGNMENTS}).`);
    if (reportCount > MAX_REPORTS) limitError(`Zu viele Monatsmeldungen für ein Archiv (maximal ${MAX_REPORTS}).`);
    // Measure serialized rows on the database, before Prisma materializes any
    // historical free-text/JSON or repeats teacher data for each assignment.
    const scopedIds = await tx.request.findMany({ where: requestWhere, select: { id: true }, take: MAX_REQUESTS });
    const idList = scopedIds.length ? Prisma.join(scopedIds.map(row => row.id)) : Prisma.sql`NULL`;
    const [size] = await tx.$queryRaw<Array<{ bytes: bigint }>>(Prisma.sql`
      SELECT COALESCE(SUM(n),0)::bigint AS bytes FROM (
        SELECT octet_length(row_to_json(r)::text) + octet_length(row_to_json(s)::text) AS n
        FROM "Request" r JOIN "School" s ON s.id = r."schoolId" WHERE r.id IN (${idList})
        UNION ALL
        SELECT octet_length(row_to_json(a)::text) + octet_length(row_to_json(t)::text) + octet_length(row_to_json(s)::text)
        FROM "Assignment" a JOIN "Teacher" t ON t.id = a."teacherId" JOIN "School" s ON s.id = t."stammschuleId"
        WHERE a."requestId" IN (${idList}) AND a.date >= ${start} AND a.date <= ${end}
        UNION ALL
        SELECT octet_length(row_to_json(g)::text) FROM "GovernmentReport" g
        WHERE g."schulamtId" = ${schulamtId} AND g.date >= ${reportStart} AND g.date < ${reportEnd}
        UNION ALL
        SELECT octet_length(row_to_json(p)::text) FROM "SchulamtProfile" p WHERE p."userId" = ${schulamtId}
      ) sizes`);
    if (!size || size.bytes > BigInt(MAX_SOURCE_BYTES)) limitError('Quelldaten überschreiten die sichere Speichergrenze.');
    const [requests, reports, profile] = await Promise.all([
      tx.request.findMany({ where: requestWhere, take: MAX_REQUESTS, orderBy: [{ date: 'asc' }, { id: 'asc' }], include: {
        school: { select: { name: true, address: true } }, assignments: { where: { date: { gte: start, lte: end } }, take: MAX_ASSIGNMENTS,
          orderBy: [{ date: 'asc' }, { id: 'asc' }], include: { teacher: { select: { id: true, name: true, address: true, gender: true, stammschule: { select: { name: true, address: true } } } } } },
      } }),
      tx.governmentReport.findMany({ where: { schulamtId, date: { gte: reportStart, lt: reportEnd } }, take: MAX_REPORTS, orderBy: [{ date: 'asc' }, { id: 'asc' }], select: { date: true, updatedAt: true, payload: true } }),
      tx.schulamtProfile.findUnique({ where: { userId: schulamtId }, select: {
        headerText: true, returnAddress: true, contactAddress: true, contactPerson: true, city: true, documentSubject: true,
        documentIntro: true, documentClosing: true, amtsleitungName: true, amtsleitungTitle: true, logoUrl: true, signatureUrl: true,
      } }),
    ]);
    if (!profile || [profile.headerText, profile.returnAddress, profile.contactAddress, profile.contactPerson, profile.city, profile.amtsleitungName, profile.amtsleitungTitle, profile.documentSubject, profile.documentIntro, profile.documentClosing].some(value => !value.trim())) throw new Error('Schulamtsprofil ist unvollständig; Einsatznachweise können nicht konsistent erzeugt werden.');
    return { requests, reports, profile, requestCount, assignmentCount, snapshotAt: new Date().toISOString() };
  }, { isolationLevel: 'RepeatableRead', timeout: 20_000, maxWait: 5_000 });

  const warnings = [
    'Archiv basiert auf dem zum Erstellungszeitpunkt verfügbaren Datenbestand; gelöschte Datensätze können nicht nachgewiesen werden.',
    'Einzelne Betriebsdaten können nach 30 Tagen bzw. 400 Tagen nicht mehr verfügbar sein; bereits gelöschte Daten bleiben auch in diesem Archiv unbekannt.',
  ];
  const reports: ArchiveReportSnapshot[] = [];
  const reportMonths = new Set<string>();
  for (const report of snapshot.reports) {
    const parsed = governmentReportInputSchema.safeParse(report.payload);
    const month = dateKey(report.date).slice(0, 7);
    if (!parsed.success) {
      if (report.payload && typeof report.payload === 'object' && (report.payload as { reviewed?: unknown }).reviewed === true) throw new Error(`Geprüfte Monatsmeldung ${month} ist technisch ungültig und kann nicht unverändert als XLSX gerendert werden.`);
      warnings.push(`Monatsmeldung ${month} ist nicht geprüft/freigegeben und wurde nicht archiviert.`);
      continue;
    }
    if (parsed.data.date !== dateKey(report.date)) throw new Error(`Geprüfte Monatsmeldung ${month} enthält einen abweichenden Stichtag.`);
    if (!parsed.data.reviewed) {
      warnings.push(`Monatsmeldung ${month} ist nicht geprüft/freigegeben und wurde nicht archiviert.`);
      continue;
    }
    reports.push({ date: report.date, updatedAt: report.updatedAt, payload: parsed.data }); reportMonths.add(month);
  }
  for (let month = 9; month <= 20; month++) {
    const yearPart = Number(year.slice(0, 4)) + Math.floor((month - 1) / 12);
    const monthPart = ((month - 1) % 12) + 1;
    const key = `${yearPart}-${String(monthPart).padStart(2, '0')}`;
    if (new Date(`${key}-01T00:00:00.000+01:00`) <= new Date() && !reportMonths.has(key)) warnings.push(`Keine geprüfte gespeicherte Monatsmeldung für ${key} vorhanden.`);
  }
  const branding = { logo: await snapshotAsset(snapshot.profile.logoUrl, false), signature: await snapshotAsset(snapshot.profile.signatureUrl, true) };
  return { schulamtId, schoolYear: year, snapshotAt: snapshot.snapshotAt, period: { start, end }, profile: snapshot.profile,
    branding, requests: snapshot.requests, reports, warnings };
}

function reportPdfStatus(request: ArchiveRequest, series: ArchiveAssignment[]) {
  const pending = request.status === 'PENDING' || series.some(item => item.status === 'PENDING');
  return pending ? 'ARCHIVKOPIE – neu erzeugt · VORLÄUFIG, Bestätigung offen' : 'ARCHIVKOPIE – neu mit aktuellem Schulamtsprofil erzeugt';
}

/** Sort each teacher's assignments once, then split in one pass. Avoid repeated
 * full-array filtering/sorting for every day of a long deployment. */
export function groupArchiveAssignments(assignments: ArchiveAssignment[]): ArchiveAssignment[][] {
  const teachers = new Map<string, ArchiveAssignment[]>();
  const groups: ArchiveAssignment[][] = [];
  for (const item of assignments) {
    if (!['PENDING', 'ACCEPTED', 'REJECTED'].includes(item.status)) throw new Error('Unbekannter Einsatzstatus.');
    if (item.status === 'REJECTED') { groups.push([item]); continue; }
    const rows = teachers.get(item.teacherId) ?? [];
    rows.push(item); teachers.set(item.teacherId, rows);
  }
  for (const rows of teachers.values()) {
    const sorted = rows.map(row => ({ row, day: assignmentDay(row.date) })).sort((a, b) => a.day.localeCompare(b.day) || a.row.id.localeCompare(b.row.id));
    let current: ArchiveAssignment[] = [];
    let next = '';
    for (const { row, day } of sorted) {
      if (day !== next) { current = []; groups.push(current); }
      current.push(row);
      const date = new Date(`${day}T00:00:00Z`);
      do { date.setUTCDate(date.getUTCDate() + 1); } while ([0, 6].includes(date.getUTCDay()));
      next = date.toISOString().slice(0, 10);
    }
  }
  return groups;
}

/** Pure renderer: consumes a completed snapshot and creates no database writes. */
export async function buildSchoolYearArchiveFiles(data: SchoolYearArchiveData): Promise<{ files: ArchiveFile[]; summary: ArchiveSummary }> {
  validSchoolYear(data.schoolYear);
  const createdAt = new Date().toISOString();
  const warnings = [...data.warnings];
  const files: ArchiveFile[] = [];
  const immutableImages = {
    logo: data.branding.logo ? { data: Buffer.from(data.branding.logo.data).toString('base64'), ratio: data.branding.logo.ratio, format: data.branding.logo.format } : null,
    signature: data.branding.signature ? { data: Buffer.from(data.branding.signature.data).toString('base64'), ratio: data.branding.signature.ratio, format: data.branding.signature.format } : null,
  };
  let totalBytes = 0;
  const addFile = (file: ArchiveFile) => { totalBytes += file.data.byteLength; if (file.data.byteLength > MAX_FILE_BYTES) limitError('Archivdatei überschreitet die zulässige Größe.'); if (totalBytes > ARCHIVE_MAX_BYTES) limitError('Archiv überschreitet die zulässige Gesamtgröße.'); files.push(file); };
  addFile({ path: 'Jahresuebersicht.xlsx', data: await createYearExportWorkbook({ requests: data.requests }) });
  let proofCount = 0;
  for (const request of data.requests) {
    const activeOnCancelled = request.status === 'CANCELLED' && request.assignments.some(item => item.status !== 'REJECTED');
    if (activeOnCancelled) { warnings.push(`Anforderung ${request.id}: storniert mit nicht-stornierter Zuweisung; kein gültiger Einsatznachweis erzeugt.`); continue; }
    const seriesGroups = groupArchiveAssignments(request.assignments);
    if (proofCount + seriesGroups.length > MAX_PROOFS) limitError(`Zu viele Einsatznachweise für ein Archiv (maximal ${MAX_PROOFS}).`);
    for (const series of seriesGroups) {
      const assignment = series[0];
      const first = series[0];
      if (++proofCount > MAX_PROOFS) limitError(`Zu viele Einsatznachweise für ein Archiv (maximal ${MAX_PROOFS}).`);
      const doc = await createDeploymentProof({ teacher: assignment.teacher, school: request.school, profile: data.profile, assignments: series,
        substitutedTeacher: request.substitutedTeacher, priority: request.priority, now: new Date(createdAt), immutableImages });
      const status = reportPdfStatus(request, series as ArchiveAssignment[]);
      const pages = doc.getNumberOfPages();
      for (let page = 1; page <= pages; page++) { doc.setPage(page); doc.setFont('Helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100); doc.text(status, 25, 281); }
      const pdf = new Uint8Array(doc.output('arraybuffer'));
      if (!pdf.length || pdf.length > MAX_FILE_BYTES) throw new Error('Einsatznachweis überschreitet die Archivgrenze.');
      const prefix = series.every(item => item.status === 'REJECTED') ? 'STORNIERT_' : series.some(item => item.status === 'PENDING') || request.status === 'PENDING' ? 'VORLAEUFIG_' : '';
      addFile({ path: `Einsatznachweise/${filePart(assignment.teacher.name).slice(0, 40)}--${assignment.teacherId}/${prefix}${dateKey(new Date(first.date))}--${request.id}--${first.id}.pdf`, data: pdf });
    }
  }
  for (const report of data.reports) {
    const bytes = new Uint8Array(await createGovernmentReportWorkbook(report.payload));
    addFile({ path: `Monatsmeldungen/${dateKey(report.date)}.xlsx`, data: bytes });
  }
  files.sort((a, b) => a.path.localeCompare(b.path, 'de'));
  const manifestEntries = files.map(file => ({ path: file.path, bytes: file.data.byteLength, sha256: hash(file.data) }));
  const manifest = { format: 'mobile-reserve-school-year-archive/v1', schoolYear: data.schoolYear, createdAt, snapshotAt: data.snapshotAt,
    source: { requestCount: data.requests.length, assignmentCount: data.requests.reduce((sum, request) => sum + request.assignments.length, 0), reportRevisions: data.reports.map(report => ({ date: dateKey(report.date), updatedAt: report.updatedAt.toISOString() })) },
    branding: { logo: data.branding.logo && { url: data.branding.logo.url, sha256: data.branding.logo.sha256, bytes: data.branding.logo.bytes }, signature: data.branding.signature && { url: data.branding.signature.url, sha256: data.branding.signature.sha256, bytes: data.branding.signature.bytes } }, warnings, files: manifestEntries };
  const indexRows = manifestEntries.map(file => `<li><a href="${html(file.path.split('/').map(encodeURIComponent).join('/'))}">${html(file.path)}</a><small>${file.bytes.toLocaleString('de-DE')} Bytes</small></li>`).join('');
  const index = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Schuljahresarchiv ${html(data.schoolYear)}</title><style>body{font:16px/1.6 system-ui,sans-serif;color:#182e29;background:#f4f7f6;margin:0}main{max-width:960px;margin:40px auto;padding:0 24px}header,section{background:white;border:1px solid #dce5e1;border-radius:16px;padding:24px;margin:20px 0}h1{font-size:clamp(24px,4vw,36px);line-height:1.2;margin:8px 0 20px}h2{font-size:22px}a{color:#08795d;overflow-wrap:anywhere}small{display:block;color:#52665f}li{margin:10px 0;overflow-wrap:anywhere}ul{padding-left:22px}.label{color:#08795d;font-weight:600}.notice{border-left:5px solid #bd8c35}footer{padding:12px 0 32px;color:#52665f;font-size:14px}@media print{body{background:white}main{margin:0;max-width:none}section,header{break-inside:avoid}}</style></head><body><main><header><p class="label">MobileReserve.digital · Offline-Dokumentation</p><h1>Schuljahresarchiv ${html(data.schoolYear)}</h1><p>Erstellt: ${html(createdAt)}<br>Datenbankaufnahme: ${html(data.snapshotAt)}</p><p>${data.requests.length} Bedarfe · ${proofCount} PDF-Nachweise · ${data.reports.length} gespeicherte Monatsmeldungen</p></header><section class="notice"><h2>Datenstand und Grenzen</h2><p>Einsatznachweise sind neu erzeugte Ausfertigungen mit aktuellem Schulamtsprofil. Monatsmeldungen enthalten den zuletzt gespeicherten, freigegebenen Stand, nicht zwingend die tatsächlich versandte Fassung. Dieses Paket ersetzt kein Vollbackup und belegt keine vollständige historische Akte.</p><ul>${warnings.map(value => `<li>${html(value)}</li>`).join('')}</ul></section><section><h2>Unterlagen</h2><ul>${indexRows}</ul><p><a href="Pruefbericht.json">Technischen Prüfbericht mit SHA-256-Prüfsummen öffnen</a></p></section><footer>Die entpackten Unterlagen sind nicht mehr verschlüsselt. Bitte nur in der vorgesehenen zugriffsgeschützten Ablage aufbewahren. Das Inhaltsverzeichnis benötigt weder eine Internetverbindung noch die App.</footer></main></body></html>`;
  addFile({ path: 'Inhaltsverzeichnis.html', data: new TextEncoder().encode(index) });
  const indexFile = files[files.length - 1];
  manifestEntries.push({ path: indexFile.path, bytes: indexFile.data.byteLength, sha256: hash(indexFile.data) });
  addFile({ path: 'Pruefbericht.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
  return { files, summary: { schoolYear: data.schoolYear, createdAt, requestCount: data.requests.length,
    assignmentCount: data.requests.reduce((sum, request) => sum + request.assignments.length, 0), proofCount, reportCount: data.reports.length, warnings } };
}
