import { assignmentDay, getAssignmentSeries, type ProofAssignment } from './assignmentSeries';

type GroupableAssignment = ProofAssignment & { requestId: string; teacherId: string };

/** Same teacher/request boundaries and consecutive-day rules as the PDF endpoint. */
export function groupAssignmentProofs<T extends GroupableAssignment>(assignments: T[]): T[][] {
  const byRequest = new Map<string, T[]>();
  for (const assignment of assignments) {
    const key = JSON.stringify([assignment.teacherId, assignment.requestId]);
    const rows = byRequest.get(key) ?? [];
    rows.push(assignment);
    byRequest.set(key, rows);
  }
  const groups: T[][] = [];
  for (const rows of byRequest.values()) {
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      const series = getAssignmentSeries(row, rows);
      series.forEach(item => seen.add(item.id));
      groups.push(series);
    }
  }
  return groups.sort((a, b) => assignmentDay(b[b.length - 1].date).localeCompare(assignmentDay(a[a.length - 1].date)) || a[0].id.localeCompare(b[0].id));
}
