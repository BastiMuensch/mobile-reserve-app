export function getCurrentSchoolYear(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 1-12
  
  if (month >= 9) {
    return `${year}/${year + 1}`;
  } else {
    return `${year - 1}/${year}`;
  }
}

export function getLastSchoolYear(): string {
  const current = getCurrentSchoolYear();
  const startYear = parseInt(current.split('/')[0]);
  return `${startYear - 1}/${startYear}`;
}

export function getNextSchoolYear(): string {
  const current = getCurrentSchoolYear();
  const startYear = parseInt(current.split('/')[0]);
  return `${startYear + 1}/${startYear + 2}`;
}

export function getSchoolYearDates(schoolYearStr: string): { start: Date, end: Date } {
  // Format: "2025/2026"
  const parts = schoolYearStr.split('/');
  const startYear = parseInt(parts[0]);
  const endYear = parseInt(parts[1]);
  
  return {
    start: new Date(`${startYear}-09-01T00:00:00.000Z`),
    end: new Date(`${endYear}-08-31T23:59:59.999Z`)
  };
}
