import ExcelJS from 'exceljs';
import { calculateReportTotals, governmentReportInputSchema, type GovernmentReportInput } from './governmentReport';
import { parseDateKeyStrict } from './dateKey';

/** Mirrors the supplied government form, including sheet name and A8:K8 output.
 * Only aggregate data is exported. No teacher names, reasons or internal review data. */
export async function createGovernmentReportWorkbook(input: GovernmentReportInput) {
  const report = governmentReportInputSchema.parse(input);
  if (!report.reviewed) throw new Error('Die Meldung wurde noch nicht geprüft.');
  const totals = calculateReportTotals(report.entries);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Mobile Reserve';
  const sheet = workbook.addWorksheet('Vertretungssituation', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1, printArea: 'A1:K8',
      margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0, footer: 0 } },
  });
  sheet.columns = [9, 13, 21, 22, 19, 18, 16, 14, 14, 15, 15].map(width => ({ width }));
  sheet.mergeCells('A2:K2');
  sheet.getCell('A2').value = 'Vertretungssituation an Grund- und Mittelschulen (Lehrer)';
  sheet.getCell('A2').font = { name: 'Arial', size: 16, bold: true };
  sheet.getRow(2).height = 28;
  sheet.mergeCells('A4:K4'); sheet.getCell('A4').value = 'Einsatzsituation';
  sheet.mergeCells('A5:B5'); sheet.getCell('A5').value = 'allg.';
  ['1a', '1b', '2', '3', '4', '5a', '5b', '6a', '6b'].forEach((label, i) => { sheet.getCell(5, i + 3).value = label; });
  const headers = ['Schulamt', 'Stichtag',
    'Stand der Mobilen Reserve (einschließlich Gewinne bzw. Verluste durch z.B. neue Zuweisung, Mutterschutz, Erziehungsurlaub, Ruhestandsversetzungen)\nin Personen',
    'Stand der Mobilen Reserve (einschließlich Gewinne bzw. Verluste durch z.B. neue Zuweisung, Mutterschutz, Erziehungsurlaub, Ruhestandsversetzungen)\nin Lehrerwochenstunden',
    'Längerfristige Vertretungen (mehr als 4 Wochen) ("Personen")',
    'Kurzfristige Vertretungen (z.B. Lehrgänge, Erkrankungen) in "Personen"',
    'insgesamt im Einsatz ("Personen")'];
  headers.forEach((text, i) => { sheet.mergeCells(6, i + 1, 7, i + 1); sheet.getCell(6, i + 1).value = text; });
  sheet.mergeCells('H6:I6'); sheet.getCell('H6').value = 'nicht im Einsatz ("Personen")';
  sheet.mergeCells('J6:K6'); sheet.getCell('J6').value = 'Anzahl der über schulhausinterne Maßnahmen versorgten Klassen';
  ['Gesamtzahl', 'davon einsatzfähig', 'kurzfristig', 'langfristig'].forEach((text, i) => { sheet.getCell(7, i + 8).value = text; });
  sheet.getRow(6).height = 160; sheet.getRow(7).height = 35; sheet.getRow(8).height = 30;
  const values = [report.office, parseDateKeyStrict(report.date), totals.people, totals.hours, totals.long, totals.short, totals.deployed, totals.idle, totals.ready, report.internalShort, report.internalLong];
  values.forEach((value, i) => { sheet.getCell(8, i + 1).value = value; });
  sheet.getCell('B8').numFmt = 'dd.mm.yyyy'; sheet.getCell('D8').numFmt = '0.##';
  for (let row = 4; row <= 8; row++) for (let col = 1; col <= 11; col++) {
    const cell = sheet.getCell(row, col);
    cell.font = { name: 'Arial', size: 10, bold: row === 5 || row === 8 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    if (row < 8) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
  }
  return workbook.xlsx.writeBuffer();
}
