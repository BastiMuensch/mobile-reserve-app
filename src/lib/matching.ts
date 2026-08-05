import { Teacher, School, Request, Absence, LeavePeriod } from '@prisma/client'

// Earth radius in kilometers
const R = 6371

/**
 * Bewertung einer Lehrkraft für eine Anfrage. Bewusst als exportierte Konstanten statt
 * als Zahlen im Code: Die Sammel-Besetzung (src/lib/batchMatching.ts) bewertet nach
 * demselben Schema, und zwei getrennte Zahlenreihen würden über kurz oder lang
 * auseinanderlaufen.
 */
export const SCORE_STAMMSCHULE = 1000      // eigene Lehrkraft der anfragenden Schule
export const SCORE_QUALIFICATION = 500     // geforderte Qualifikation (oder "Alles")
export const SCORE_PREFERRED_TYPE = 15     // gewünschte Schulart passt
export const SCORE_WRONG_TYPE = -10        // andere Schulart gewünscht (außer "BOTH")
export const SCORE_DISTANCE_FACTOR = 100   // Nähe als Feinabstufung: FACTOR / (1 + km)
export const SCORE_OVERTIME = -5000        // Wochenstunden bereits ausgeschöpft
export const SCORE_CONFLICT = -8000        // an einem der Tage schon verplant

// Haversine formula to calculate distance between two lat/lng coordinates in km
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * (Math.PI / 180)
  const dLon = (lon2 - lon1) * (Math.PI / 180)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export type TeacherAssignmentForMatching = { hours: number; date: Date; status: string }

// Only the fields we need from an Absence record for matching purposes
export type AbsenceForMatching = Pick<Absence, 'teacherId' | 'date'>

// Longer absence over a date range (Mutterschutz, Elternzeit, ...). endDate === null
// means open-ended ("bis auf Weiteres").
export type LeavePeriodForMatching = Pick<LeavePeriod, 'teacherId' | 'startDate' | 'endDate'>

export type TeacherWithDistance = Teacher & {
  distanceToSchool: number;
  matchScore: number;
  assignedHours: number;
  isOvertime?: boolean;
  hasConflict?: boolean;
  conflictDates?: string[];
}

// Normalize a date-like value to local midnight so that pure day/week comparisons
// aren't skewed by time-of-day or DST effects.
export function toLocalDayStart(date: Date | string): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Format a Date as a local YYYY-MM-DD key (no UTC conversion), consistent with holidays.ts
export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Monday-Sunday boundaries (local time) of the week containing `date`.
// Uses setDate on a Date object so month/year rollovers are handled correctly by the JS Date engine.
export function getWeekBounds(date: Date): { weekStart: Date; weekEnd: Date } {
  const d = toLocalDayStart(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Correct Monday calculation (Sunday = day 0)
  const weekStart = new Date(d);
  weekStart.setDate(diff);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  return { weekStart, weekEnd };
}

/** Die Felder einer Anforderung, die für die Zeitraum-Berechnung gebraucht werden. */
export type RequestForDays = {
  date: Date | string;
  endDate?: Date | string | null;
  hours: number;
  schedule?: string | null;
  /** "Bis auf Weiteres" - das Ende ist noch nicht bekannt (siehe OPEN_ENDED_HORIZON_DAYS). */
  isOpenEnded?: boolean | null;
};

/**
 * Wie weit ein Bedarf ohne bekanntes Ende im Voraus besetzt wird: eine Schulwoche.
 *
 * Irgendeine Grenze braucht es, sonst wüsste die Besetzung nicht, wie viele Tage sie
 * abdecken soll. Eine Woche ist bei einer Erkrankung der realistische Horizont - sie
 * blockiert die Mobilen Reserven nicht für Wochen an einem Fall, dessen Ende offen ist,
 * und wächst täglich mit, weil sie immer ab heute gerechnet wird.
 */
export const OPEN_ENDED_HORIZON_DAYS = 5;

/**
 * Der tatsächlich zu besetzende Zeitraum einer Anforderung.
 *
 * Für einen laufenden offenen Bedarf beginnt er beim späteren von Anforderungsbeginn und
 * heute - vergangene Tage sind nicht mehr besetzbar - und reicht über die nächsten
 * OPEN_ENDED_HORIZON_DAYS Werktage.
 */
export function getEffectiveRange(
  request: RequestForDays,
  today: Date = new Date()
): { start: Date; end: Date } {
  const requestStart = toLocalDayStart(request.date);

  if (request.isOpenEnded && !request.endDate) {
    const from = toLocalDayStart(today) > requestStart ? toLocalDayStart(today) : requestStart;
    const end = new Date(from);
    let workdays = 0;
    // Der Horizont zählt Werktage, nicht Kalendertage: Sonst schrumpfte eine am Donnerstag
    // gemeldete Erkrankung effektiv auf zwei besetzbare Tage.
    while (workdays < OPEN_ENDED_HORIZON_DAYS) {
      const isoWeekday = end.getDay() === 0 ? 7 : end.getDay();
      if (isoWeekday <= 5) workdays += 1;
      if (workdays < OPEN_ENDED_HORIZON_DAYS) end.setDate(end.getDate() + 1);
    }
    return { start: from, end };
  }

  const end = request.endDate ? toLocalDayStart(request.endDate) : requestStart;
  return end < requestStart ? { start: requestStart, end: requestStart } : { start: requestStart, end };
}

/**
 * The (inclusive) local-day range covered by a request: date..endDate, or just date if
 * there's no endDate.
 *
 * Ein laufender Bedarf "bis auf Weiteres" hat kein Enddatum, ist aber auch kein
 * Einzeltag: Für ihn gilt der rollierende Horizont oben, damit die harten Filter
 * (Abwesenheit, längere Abwesenheit, Doppelbuchung) und die Wochenstundenprüfung über
 * den echten Zeitraum laufen statt nur über den Starttag.
 */
export function getRequestDateRange(request: Request): { start: Date; end: Date } {
  return getEffectiveRange(request);
}

// Every calendar day (as a local YYYY-MM-DD key) covered by the request.
export function getRequestedDateKeys(request: Request): string[] {
  const { start, end } = getRequestDateRange(request);
  const keys: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    keys.push(toLocalDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

// Every distinct Monday-Sunday week touched by the request's date range.
export function getRelevantWeeks(request: Request): { weekStart: Date; weekEnd: Date }[] {
  const { start, end } = getRequestDateRange(request);
  const weeks: { weekStart: Date; weekEnd: Date }[] = [];
  const seen = new Set<string>();
  const cursor = new Date(start);
  while (cursor <= end) {
    const bounds = getWeekBounds(cursor);
    const key = toLocalDateKey(bounds.weekStart);
    if (!seen.has(key)) {
      seen.add(key);
      weeks.push(bounds);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return weeks;
}

/**
 * Does a longer absence cover this particular day? Both ends are inclusive; a missing
 * endDate means the period is still open, so every day from startDate on is covered.
 * Everything is compared on local day boundaries so a time-of-day component in the
 * stored dates can't shift the result by a day.
 */
export function leaveCoversDay(leave: LeavePeriodForMatching, day: Date): boolean {
  const target = toLocalDayStart(day);
  if (target < toLocalDayStart(leave.startDate)) return false;
  if (!leave.endDate) return true;
  return target <= toLocalDayStart(leave.endDate);
}

/** The days out of `dateKeys` (local YYYY-MM-DD) that fall into one of the given periods. */
export function daysCoveredByLeave(leaves: LeavePeriodForMatching[], dateKeys: string[]): string[] {
  return dateKeys.filter(key => {
    const [year, month, day] = key.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return leaves.some(l => leaveCoversDay(l, date));
  });
}

/**
 * Die Grundbewertung ohne die situationsabhängigen Abzüge (Mehrarbeit, Terminkonflikt).
 * Wird sowohl vom Einzel-Matching als auch von der Sammel-Besetzung genutzt, damit beide
 * dieselbe Vorstellung von "passt gut" haben.
 */
export function baseMatchScore(input: {
  isStammschule: boolean;
  hasAllQuals: boolean;
  preferredType: string | null;
  requestedSchoolType: string;
  distance: number;
}): number {
  let score = 0
  if (input.isStammschule) score += SCORE_STAMMSCHULE
  if (input.hasAllQuals) score += SCORE_QUALIFICATION

  if (input.preferredType) {
    if (input.preferredType === input.requestedSchoolType) score += SCORE_PREFERRED_TYPE
    else if (input.preferredType !== 'BOTH') score += SCORE_WRONG_TYPE
  }

  // Nähe nur als Feinabstufung - sie soll Stammschule und Qualifikation nie überstimmen.
  score += SCORE_DISTANCE_FACTOR / (1 + input.distance)
  return score
}

/** Erfüllt die Lehrkraft die geforderten Qualifikationen? "Alles" deckt alles ab. */
export function hasRequiredQualifications(teacherQualifications: string, requestedQualifications: string): boolean {
  const reqQuals = requestedQualifications.split(',').filter(Boolean)
  const teacherQuals = teacherQualifications.split(',').filter(Boolean)
  return teacherQuals.includes('Alles') || reqQuals.length === 0 || reqQuals.every(q => teacherQuals.includes(q))
}

// Rank candidates based on Priority Logic
export function rankCandidates(
  request: Request,
  requestingSchool: School,
  allTeachers: (Teacher & { assignments: TeacherAssignmentForMatching[] })[],
  absences: AbsenceForMatching[] = [],
  leavePeriods: LeavePeriodForMatching[] = []
): TeacherWithDistance[] {

  const eligibleTeachers: TeacherWithDistance[] = []

  // Reference week(s) come from the REQUEST, not from today - a request three weeks out
  // must be checked against its own week(s), not the current one.
  const relevantWeeks = getRelevantWeeks(request);
  const requestedDateKeys = getRequestedDateKeys(request);
  const requestedDateKeySet = new Set(requestedDateKeys);

  // Group reported absences per teacher for quick lookup
  const absencesByTeacher = new Map<string, Set<string>>();
  for (const absence of absences) {
    const key = toLocalDateKey(toLocalDayStart(absence.date));
    if (!absencesByTeacher.has(absence.teacherId)) {
      absencesByTeacher.set(absence.teacherId, new Set());
    }
    absencesByTeacher.get(absence.teacherId)!.add(key);
  }

  // Same for longer absences - kept as ranges instead of expanded into days, since a
  // parental leave can easily span a whole school year.
  const leavesByTeacher = new Map<string, LeavePeriodForMatching[]>();
  for (const leave of leavePeriods) {
    const list = leavesByTeacher.get(leave.teacherId);
    if (list) list.push(leave);
    else leavesByTeacher.set(leave.teacherId, [leave]);
  }

  for (const teacher of allTeachers) {
    // b) Hard Filter: Sick/Leave status
    if (teacher.status !== 'ACTIVE') continue

    // Hard Filter: teacher has reported an unplanned absence on one of the requested days
    const teacherAbsenceDays = absencesByTeacher.get(teacher.id);
    if (teacherAbsenceDays && requestedDateKeys.some(k => teacherAbsenceDays.has(k))) {
      continue;
    }

    // Hard Filter: a longer absence (Mutterschutz, Elternzeit, ...) covers one of the
    // requested days. Anything that touches the period disqualifies the teacher for this
    // request - a partial assignment would silently plan them into days they are away.
    const teacherLeaves = leavesByTeacher.get(teacher.id);
    if (teacherLeaves && daysCoveredByLeave(teacherLeaves, requestedDateKeys).length > 0) {
      continue;
    }

    // Only non-rejected assignments count towards workload/conflicts - rejected ones (e.g. from a
    // reported absence) free up the slot again.
    const activeAssignments = teacher.assignments.filter(a => a.status !== 'REJECTED')

    // Calculate weekly hours for every week touched by the request, and use the most heavily
    // loaded one (conservative) for assignedHours/isOvertime.
    let currentHours = 0;
    for (const { weekStart, weekEnd } of relevantWeeks) {
      const weekHours = activeAssignments
        .filter(a => { const d = new Date(a.date); return d >= weekStart && d <= weekEnd; })
        .reduce((sum, a) => sum + a.hours, 0)
      if (weekHours > currentHours) currentHours = weekHours;
    }

    // Check Max Weekly Hours - Mark as overtime if exceeded (using the busiest relevant week)
    const isOvertime = currentHours >= teacher.maxWeeklyHours;

    // Double-booking check: does the teacher already have a non-rejected assignment on a day
    // this request also needs?
    const conflictDates = Array.from(new Set(
      activeAssignments
        .map(a => toLocalDateKey(toLocalDayStart(a.date)))
        .filter(key => requestedDateKeySet.has(key))
    ));
    const hasConflict = conflictDates.length > 0;

    // d) Check Part-Time Schedule Match
    if (teacher.isPartTime && teacher.schedule) {
      try {
        const schedule = JSON.parse(teacher.schedule);
        // Denselben Zeitraum verwenden wie die übrigen Prüfungen - insbesondere für einen
        // laufenden Bedarf "bis auf Weiteres", der sonst nur an seinem Starttag geprüft würde.
        const { start: reqStart, end: reqEnd } = getRequestDateRange(request);

        let isAvailable = true;
        const reqSchedule = request.schedule ? JSON.parse(request.schedule) : null;

        // Loop through each day in the requested period
        for (let d = new Date(reqStart); d <= reqEnd; d.setDate(d.getDate() + 1)) {
          const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay(); // 1=Mon, 7=Sun
          if (dayOfWeek > 5) continue; // Skip weekends

          // The required hours for each day
          let requiredHours: number[] = [];
          if (reqSchedule) {
            requiredHours = reqSchedule[dayOfWeek.toString()] || [];
          } else {
            requiredHours = Array.from({ length: request.hours }, (_, i) => request.startHour + i);
          }

          // If no hours required on this day, skip check
          if (requiredHours.length === 0) continue;

          // Check if teacher schedule has all required hours for this dayOfWeek
          const teacherDaySchedule = schedule[dayOfWeek.toString()] || [];
          const hasHours = requiredHours.every(h => teacherDaySchedule.includes(h));

          if (!hasHours) {
            isAvailable = false;
            break;
          }
        }

        if (!isAvailable) continue;
      } catch (e) {
        console.error("Invalid schedule JSON for teacher", teacher.id);
        continue;
      }
    }

    // c) Qualifications Match (Soft Filter)
    const reqQuals = request.qualifications.split(',').filter(Boolean)
    const teacherQuals = teacher.qualifications.split(',').filter(Boolean)

    // If teacher has "Alles", they perfectly match any qualification.
    const hasAllQuals = teacherQuals.includes('Alles') ||
      (reqQuals.length === 0) ||
      reqQuals.every(q => teacherQuals.includes(q));

    const distance = calculateDistance(requestingSchool.latitude, requestingSchool.longitude, teacher.homeLat, teacher.homeLng)

    let score = baseMatchScore({
      isStammschule: teacher.stammschuleId === requestingSchool.id,
      hasAllQuals,
      preferredType: teacher.preferredType,
      requestedSchoolType: request.schoolType,
      distance,
    })

    if (isOvertime) {
      score += SCORE_OVERTIME; // Penalize overtime heavily so they appear at the bottom
    }

    if (hasConflict) {
      score += SCORE_CONFLICT; // Double-booking is worse than overtime - push these below overtime candidates
    }

    eligibleTeachers.push({
      ...teacher,
      distanceToSchool: distance,
      matchScore: score,
      assignedHours: currentHours,
      isOvertime,
      hasConflict,
      conflictDates
    })
  }

  // Sort by highest score first
  return eligibleTeachers.sort((a, b) => b.matchScore - a.matchScore)
}
