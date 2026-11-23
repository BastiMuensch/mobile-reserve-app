import ExcelJS from 'exceljs';
import { parseDateKeyStrict } from './dateKey';
import { isMultiDayDeployment, type DailyDeployment } from './dailyDeploymentList';

const headings = ['Schule', 'Lehrkraft', 'Zeitraum', 'Vertretung', 'Stammschule'];
const shortDateFormat = 'dd"."mm"."yy';
const shortDate = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(2, 4)}`;
const solidFill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const cellBorder = { style: 'thin', color: { argb: 'FFD9D9D9' } } as const;

export async function createDailyDeploymentWorkbook(day: string, rows: DailyDeployment[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('SVS-Tagesliste', {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.columns = [35, 29, 26, 30, 35].map(width => ({ width }));
  sheet.getCell('A1').value = 'Einsatztag';
  sheet.getCell('B1').value = parseDateKeyStrict(day);
  sheet.getCell('B1').numFmt = 'dd"."mm"."yyyy';
  sheet.getRow(1).font = { name: 'Calibri', size: 12, bold: true };
  sheet.getRow(1).height = 23;

  const groups = [
    { name: 'Langzeitvertretungen', label: 'Langzeitvertretungen', rows: rows.filter(isMultiDayDeployment) },
    { name: 'EintaegigeVertretungen', label: 'Eintägige Vertretungen', rows: rows.filter(row => !isMultiDayDeployment(row)) },
  ];
  let startRow = 3;
  for (const group of groups) {
    if (group.rows.length === 0) continue;
    sheet.mergeCells(startRow, 1, startRow, headings.length);
    const band = sheet.getCell(startRow, 1);
    band.value = group.label;
    band.fill = solidFill('FF00B8E4');
    band.font = { name: 'Calibri', size: 11 };
    band.alignment = { vertical: 'middle' };
    sheet.getRow(startRow).height = 17;

    const headerRow = startRow + 1;
    sheet.addTable({
      name: group.name,
      ref: `A${headerRow}`,
      headerRow: true,
      style: { theme: 'TableStyleLight1' },
      columns: headings.map(name => ({ name, filterButton: true })),
      rows: group.rows.map(row => [
        row.school, row.substitutedTeacher, parseDateKeyStrict(row.start),
        row.pending ? `${row.teacher}\nBestätigung ausstehend` : row.teacher, row.homeSchool ?? '',
      ]),
    });

    const header = sheet.getRow(headerRow);
    header.height = 21;
    header.eachCell(cell => {
      cell.font = { name: 'Calibri', size: 11, bold: true };
      cell.fill = solidFill('FFFFFFFF');
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = { bottom: cellBorder };
    });

    group.rows.forEach((deployment, index) => {
      const row = sheet.getRow(headerRow + index + 1);
      row.eachCell({ includeEmpty: true }, cell => {
        cell.font = { name: 'Calibri', size: 11 };
        cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        cell.border = { bottom: cellBorder, right: cellBorder };
      });
      // Store a real Excel date for chronological sorting. The suffix completes the displayed period.
      row.getCell(3).numFmt = deployment.openEnded ? `${shortDateFormat}" -"`
        : deployment.start === deployment.end ? shortDateFormat : `${shortDateFormat}" - ${shortDate(deployment.end)}"`;
    });
    startRow = headerRow + group.rows.length + 2;
  }
  if (rows.length === 0) sheet.getCell('A3').value = 'Für diesen Tag liegen keine aktiven Zuweisungen vor.';

  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
