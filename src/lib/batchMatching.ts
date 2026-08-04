import {
  calculateDistance,
  baseMatchScore,
  hasRequiredQualifications,
  toLocalDayStart,
  toLocalDateKey,
  getWeekBounds,
  leaveCoversDay,
  SCORE_OVERTIME,
  type AbsenceForMatching,
  type LeavePeriodForMatching,
} from '@/lib/matching';
import { getOpenRequestDays, type OpenDay } from '@/lib/requestDays';
import { requestUrgencyScore, urgencyReasons, detectOutbreaks, isSchoolInOutbreak } from '@/lib/urgency';

/**
 * Idealbesetzung: ein Besetzungsvorschlag für ALLE offenen Anforderungen bis zu einem
 * Stichtag auf einmal.
 *
 * Zwei Regeln prägen das Verfahren und sind wichtiger als die reine Punktzahl:
 *
 *  1. KEINE SCHULE GEHT LEER AUS. Ein naives Greedy über alle Paarungen (absteigend nach
 *     Punkten) wäre naheliegend, führt hier aber zu einem unhaltbaren Ergebnis: Der
 *     Stammschul-Bonus (+1000) überstrahlt alles, also räumt eine Schule mit vielen
 *     eigenen Lehrkräften der Reihe nach alles ab, und die Nachbarschule bleibt bei
 *     Knappheit komplett leer. Deshalb ein Rundenverfahren - je Runde bekommt jede
 *     Schule höchstens eine Anforderung besetzt, bevor irgendeine ihre zweite bekommt.
 *
 *  2. KONTINUITÄT VOR PUNKTEN. Für eine Klasse sind fünf verschiedene Vertretungen in
 *     fünf Tagen schlechter als eine durchgehende, auch wenn jede einzelne besser
 *     passen würde. Innerhalb einer Anforderung gewinnt deshalb, wer den längsten
 *     zusammenhängenden Block abdecken kann (CONTINUITY_PER_DAY).
 *
 * Reine Berechnung ohne Datenbankzugriff - die Route lädt die Daten und ruft nur auf.
 */

/**
 * Punkte je zusammenhängend abgedecktem Tag. Bewusst über dem Stammschul-Bonus (1000):
 * Sonst bliebe die Kontinuität wirkungslos, sobald eine Stammschullehrkraft im Spiel
 * ist. Bei eintägigen Anforderungen bekommt jede Kandidatin denselben Bonus, dort
 * entscheidet also weiterhin allein die Passung.
 */
export const CONTINUITY_PER_DAY = 1200;

export type BatchRequest = {
  id: string;
  schoolId: string;
  date: Date | string;
  endDate?: Date | string | null;
  hours: number;
  weeklyHours: number;
  startHour: number;
  schedule?: string | null;
  qualifications: string;
  schoolType: string;
  substitutedTeacher: string;
  comments?: string | null;
  priority?: string | null;
  status: string;
  assignments?: { date: Date | string; hours: number; status: string }[];
};

export type BatchSchool = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  isSmall?: boolean | null;
  outbreakUntil?: Date | string | null;
  outbreakDismissedUntil?: Date | string | null;
};

export type BatchTeacher = {
  id: string;
  name: string;
  status: string;
  stammschuleId: string;
  maxWeeklyHours: number;
  isPartTime: boolean;
  schedule?: string | null;
  qualifications: string;
  preferredType: string;
  homeLat: number;
  homeLng: number;
  assignments?: { date: Date | string; hours: number; status: string }[];
};

export type ProposedSegment = {
  teacherId: string;
  teacherName: string;
  entries: { date: string; hours: number }[];
  score: number;
  reasons: string[];
  /** Nächstbeste Lehrkräfte, die GENAU diese Tage übernehmen könnten (für den Tausch). */
  alternatives: { teacherId: string; name: string; score: number; reasons: string[] }[];
};

export type Proposal = {
  requestId: string;
  segments: ProposedSegment[];
  coverage: { assignedHours: number; requiredHours: number };
  urgency: { score: number; reasons: string[] };
};

export type UnfillableRequest = {
  requestId: string;
  reason: string;
};

export type SchoolProposal = {
  schoolId: string;
  schoolName: string;
  coverage: { filledRequests: number; totalRequests: number; assignedHours: number; requiredHours: number };
  proposals: Proposal[];
  unfillable: UnfillableRequest[];
};

export type BatchInput = {
  until: Date | string;
  requests: BatchRequest[];
  schools: BatchSchool[];
  teachers: BatchTeacher[];
  absences: AbsenceForMatching[];
  leavePeriods: LeavePeriodForMatching[];
  /** Nur für Tests, damit das Ergebnis nicht vom Kalender abhängt. */
  today?: Date;
};

const OPEN_STATUSES = new Set(['PENDING', 'PARTIALLY_FILLED']);

/** Laufender Verfügbarkeitsstand einer Lehrkraft, echte plus im Vorschlag vergebene Tage. */
type TeacherState = {
  teacher: BatchTeacher;
  bookedDays: Set<string>;
  /** Wochenstunden je Wochenanfang (lokaler Tagesschlüssel des Montags). */
  weekHours: Map<string, number>;
  absentDays: Set<string>;
  leaves: LeavePeriodForMatching[];
  schedule: Record<string, number[]> | null;
};

function parseSchedule(raw?: string | null): Record<string, number[]> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function weekKeyOf(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return toLocalDateKey(getWeekBounds(new Date(y, m - 1, d)).weekStart);
}

function isoWeekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  const wd = new Date(y, m - 1, d).getDay();
  return wd === 0 ? 7 : wd;
}

/** Kann die Lehrkraft an diesem Tag die geforderten Stunden übernehmen? */
function canWorkOn(state: TeacherState, day: OpenDay): boolean {
  if (state.bookedDays.has(day.date)) return false;
  if (state.absentDays.has(day.date)) return false;

  const [y, m, d] = day.date.split('-').map(Number);
  const asDate = new Date(y, m - 1, d);
  if (state.leaves.some(l => leaveCoversDay(l, asDate))) return false;

  // Teilzeit: der hinterlegte Stundenplan muss den Tag mit genügend Stunden abdecken.
  if (state.teacher.isPartTime && state.schedule) {
    const available = state.schedule[String(isoWeekdayOf(day.date))]?.length ?? 0;
    if (available < day.hours) return false;
  }
  return true;
}

/** Längster zusammenhängender Block innerhalb von `days`, den die Lehrkraft übernehmen kann. */
function longestRun(state: TeacherState, days: OpenDay[]): OpenDay[] {
  let best: OpenDay[] = [];
  let current: OpenDay[] = [];
  for (const day of days) {
    if (canWorkOn(state, day)) {
      current.push(day);
      if (current.length > best.length) best = [...current];
    } else {
      current = [];
    }
  }
  return best;
}

function wouldBeOvertime(state: TeacherState, block: OpenDay[]): boolean {
  const perWeek = new Map<string, number>();
  for (const day of block) {
    const wk = weekKeyOf(day.date);
    perWeek.set(wk, (perWeek.get(wk) ?? 0) + day.hours);
  }
  for (const [wk, hours] of perWeek) {
    if ((state.weekHours.get(wk) ?? 0) + hours > state.teacher.maxWeeklyHours) return true;
  }
  return false;
}

function bookBlock(state: TeacherState, block: OpenDay[]): void {
  for (const day of block) {
    state.bookedDays.add(day.date);
    const wk = weekKeyOf(day.date);
    state.weekHours.set(wk, (state.weekHours.get(wk) ?? 0) + day.hours);
  }
}

type Candidate = {
  state: TeacherState;
  block: OpenDay[];
  selectionScore: number;
  matchScore: number;
  distance: number;
  isOvertime: boolean;
  reasons: string[];
};

/**
 * Bewertet eine Lehrkraft für die noch offenen Tage einer Anforderung. `null`, wenn sie
 * keinen einzigen Tag übernehmen kann.
 */
function evaluate(
  state: TeacherState,
  request: BatchRequest,
  school: BatchSchool,
  openDays: OpenDay[]
): Candidate | null {
  if (state.teacher.status !== 'ACTIVE') return null;

  const block = longestRun(state, openDays);
  if (block.length === 0) return null;

  const distance = calculateDistance(school.latitude, school.longitude, state.teacher.homeLat, state.teacher.homeLng);
  const isStammschule = state.teacher.stammschuleId === school.id;
  const hasQuals = hasRequiredQualifications(state.teacher.qualifications, request.qualifications);

  const matchScore = baseMatchScore({
    isStammschule,
    hasAllQuals: hasQuals,
    preferredType: state.teacher.preferredType,
    requestedSchoolType: request.schoolType,
    distance,
  });

  const isOvertime = wouldBeOvertime(state, block);

  // Kontinuität dominiert die Auswahl, die Passung entscheidet innerhalb gleicher Länge.
  let selectionScore = block.length * CONTINUITY_PER_DAY + matchScore;
  if (isOvertime) selectionScore += SCORE_OVERTIME;

  const reasons: string[] = [];
  if (block.length === openDays.length && openDays.length > 1) reasons.push('Durchgehend');
  if (isStammschule) reasons.push('Stammschule');
  if (hasQuals) reasons.push('Qualifikation passt');
  reasons.push(`${distance.toFixed(1)} km`);
  if (isOvertime) reasons.push('Mehrarbeit');

  return { state, block, selectionScore, matchScore, distance, isOvertime, reasons };
}

/** Kandidatinnen, die exakt die Tage eines Segments übernehmen könnten – für den Tausch. */
function findAlternatives(
  states: TeacherState[],
  chosenTeacherId: string,
  request: BatchRequest,
  school: BatchSchool,
  block: OpenDay[]
): ProposedSegment['alternatives'] {
  const out: ProposedSegment['alternatives'] = [];
  for (const state of states) {
    if (state.teacher.id === chosenTeacherId) continue;
    if (state.teacher.status !== 'ACTIVE') continue;
    if (!block.every(day => canWorkOn(state, day))) continue;

    const distance = calculateDistance(school.latitude, school.longitude, state.teacher.homeLat, state.teacher.homeLng);
    const score = baseMatchScore({
      isStammschule: state.teacher.stammschuleId === school.id,
      hasAllQuals: hasRequiredQualifications(state.teacher.qualifications, request.qualifications),
      preferredType: state.teacher.preferredType,
      requestedSchoolType: request.schoolType,
      distance,
    });

    const reasons: string[] = [];
    if (state.teacher.stammschuleId === school.id) reasons.push('Stammschule');
    if (hasRequiredQualifications(state.teacher.qualifications, request.qualifications)) reasons.push('Qualifikation passt');
    reasons.push(`${distance.toFixed(1)} km`);
    if (wouldBeOvertime(state, block)) reasons.push('Mehrarbeit');

    out.push({ teacherId: state.teacher.id, name: state.teacher.name, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

export function buildBatchProposal(input: BatchInput): SchoolProposal[] {
  const today = toLocalDayStart(input.today ?? new Date());
  const until = toLocalDayStart(input.until);

  const schoolsById = new Map(input.schools.map(s => [s.id, s]));

  // Nur offene Anforderungen, die bis zum Stichtag beginnen. FILLED, CANCELLED und
  // besonders UNFILLED bleiben außen vor - eine bewusste Absage des Schulamts darf ein
  // Sammelvorschlag nicht stillschweigend wieder aufleben lassen.
  const relevant = input.requests.filter(r =>
    OPEN_STATUSES.has(r.status) &&
    schoolsById.has(r.schoolId) &&
    toLocalDayStart(r.date) <= until
  );

  // --- Verfügbarkeitsstand je Lehrkraft aufbauen ---
  const absentByTeacher = new Map<string, Set<string>>();
  for (const a of input.absences) {
    const key = toLocalDateKey(toLocalDayStart(a.date));
    if (!absentByTeacher.has(a.teacherId)) absentByTeacher.set(a.teacherId, new Set());
    absentByTeacher.get(a.teacherId)!.add(key);
  }

  const leavesByTeacher = new Map<string, LeavePeriodForMatching[]>();
  for (const l of input.leavePeriods) {
    const list = leavesByTeacher.get(l.teacherId);
    if (list) list.push(l);
    else leavesByTeacher.set(l.teacherId, [l]);
  }

  const states: TeacherState[] = input.teachers.map(teacher => {
    const bookedDays = new Set<string>();
    const weekHours = new Map<string, number>();
    for (const a of teacher.assignments ?? []) {
      if (a.status === 'REJECTED') continue;
      const key = toLocalDateKey(toLocalDayStart(a.date));
      bookedDays.add(key);
      const wk = weekKeyOf(key);
      weekHours.set(wk, (weekHours.get(wk) ?? 0) + a.hours);
    }
    return {
      teacher,
      bookedDays,
      weekHours,
      absentDays: absentByTeacher.get(teacher.id) ?? new Set(),
      leaves: leavesByTeacher.get(teacher.id) ?? [],
      schedule: parseSchedule(teacher.schedule),
    };
  });

  // --- Dringlichkeit je Anforderung ---
  const outbreakDays = detectOutbreaks(
    relevant.map(r => ({ date: r.date, endDate: r.endDate, priority: r.priority, status: r.status, schoolId: r.schoolId })),
    { today }
  );

  const urgencyOf = (request: BatchRequest) => {
    const school = schoolsById.get(request.schoolId)!;
    const forUrgency = { date: request.date, endDate: request.endDate, priority: request.priority, status: request.status };
    const isOutbreak = isSchoolInOutbreak(school, outbreakDays, { ...forUrgency, schoolId: request.schoolId }, { today });
    return {
      score: requestUrgencyScore(forUrgency, school, { isOutbreak, today }),
      reasons: urgencyReasons(forUrgency, school, { isOutbreak, today }),
    };
  };

  // --- Warteschlange je Schule, dringlichste Anforderung zuerst ---
  const queues = new Map<string, BatchRequest[]>();
  for (const request of relevant) {
    const list = queues.get(request.schoolId);
    if (list) list.push(request);
    else queues.set(request.schoolId, [request]);
  }
  for (const [, list] of queues) {
    list.sort((a, b) => {
      const diff = urgencyOf(b).score - urgencyOf(a).score;
      if (diff !== 0) return diff;
      return toLocalDayStart(a.date).getTime() - toLocalDayStart(b.date).getTime();
    });
  }

  const results = new Map<string, SchoolProposal>();
  for (const [schoolId, list] of queues) {
    const school = schoolsById.get(schoolId)!;
    results.set(schoolId, {
      schoolId,
      schoolName: school.name,
      coverage: { filledRequests: 0, totalRequests: list.length, assignedHours: 0, requiredHours: 0 },
      proposals: [],
      unfillable: [],
    });
  }

  /** Besetzt eine einzelne Anforderung so weit wie möglich. */
  const fillRequest = (request: BatchRequest): void => {
    const school = schoolsById.get(request.schoolId)!;
    const result = results.get(request.schoolId)!;

    let openDays = getOpenRequestDays(request, request.assignments ?? []);
    const requiredHours = openDays.reduce((sum, d) => sum + d.hours, 0);
    result.coverage.requiredHours += requiredHours;

    if (openDays.length === 0) return;

    const segments: ProposedSegment[] = [];
    let assignedHours = 0;
    let sawAnyCandidate = false;

    // Blockweise auffüllen: immer die Lehrkraft mit dem längsten zusammenhängenden
    // Block, danach mit den verbliebenen Tagen weiter. Höchstens so viele Durchläufe
    // wie Tage - jeder Durchlauf entfernt mindestens einen Tag.
    for (let guard = 0; guard < openDays.length + 1 && openDays.length > 0; guard++) {
      const candidates = states
        .map(state => evaluate(state, request, school, openDays))
        .filter((c): c is Candidate => c !== null);

      if (candidates.length === 0) break;
      sawAnyCandidate = true;

      candidates.sort((a, b) => {
        if (b.selectionScore !== a.selectionScore) return b.selectionScore - a.selectionScore;
        if (a.distance !== b.distance) return a.distance - b.distance;
        return a.state.teacher.name.localeCompare(b.state.teacher.name);
      });

      const chosen = candidates[0];
      const blockKeys = new Set(chosen.block.map(d => d.date));

      // Alternativen VOR der Buchung ermitteln, sonst blockiert sich die Gewählte selbst.
      const alternatives = findAlternatives(states, chosen.state.teacher.id, request, school, chosen.block);

      bookBlock(chosen.state, chosen.block);
      segments.push({
        teacherId: chosen.state.teacher.id,
        teacherName: chosen.state.teacher.name,
        entries: chosen.block.map(d => ({ date: d.date, hours: d.hours })),
        score: Math.round(chosen.matchScore),
        reasons: chosen.reasons,
        alternatives,
      });
      assignedHours += chosen.block.reduce((sum, d) => sum + d.hours, 0);
      openDays = openDays.filter(d => !blockKeys.has(d.date));
    }

    if (segments.length === 0) {
      result.unfillable.push({
        requestId: request.id,
        reason: sawAnyCandidate
          ? 'An diesen Tagen ist keine Mobile Reserve mehr frei.'
          : 'Keine passende Lehrkraft verfügbar (Qualifikation, Schulart, Stundenplan oder Abwesenheit).',
      });
      return;
    }

    result.proposals.push({
      requestId: request.id,
      segments,
      coverage: { assignedHours, requiredHours },
      urgency: urgencyOf(request),
    });
    result.coverage.assignedHours += assignedHours;
    if (assignedHours >= requiredHours) result.coverage.filledRequests += 1;
  };

  // --- Rundenverfahren: reihum über die Schulen ---
  // Jede Runde besetzt je Schule höchstens EINE Anforderung. Dadurch verteilt sich
  // Knappheit über die Schulen, statt dass eine Schule alles bekommt und die nächste
  // nichts. Die Runde terminiert zwingend, weil jeder Durchlauf mindestens eine
  // Anforderung aus einer Warteschlange nimmt.
  let guard = 0;
  const maxRounds = relevant.length + 1;
  while (guard < maxRounds) {
    guard += 1;
    const active = Array.from(queues.entries()).filter(([, list]) => list.length > 0);
    if (active.length === 0) break;

    active.sort(([aId, aList], [bId, bList]) => {
      const diff = urgencyOf(bList[0]).score - urgencyOf(aList[0]).score;
      if (diff !== 0) return diff;
      // Bei gleicher Dringlichkeit zuerst die Schule, die bisher am schlechtesten
      // versorgt ist - erst danach der Name, damit das Ergebnis reproduzierbar bleibt.
      const aCov = results.get(aId)!.coverage;
      const bCov = results.get(bId)!.coverage;
      const aRatio = aCov.totalRequests ? aCov.filledRequests / aCov.totalRequests : 1;
      const bRatio = bCov.totalRequests ? bCov.filledRequests / bCov.totalRequests : 1;
      if (aRatio !== bRatio) return aRatio - bRatio;
      return results.get(aId)!.schoolName.localeCompare(results.get(bId)!.schoolName);
    });

    for (const [, list] of active) {
      const request = list.shift();
      if (request) fillRequest(request);
    }
  }

  return Array.from(results.values())
    .filter(r => r.proposals.length > 0 || r.unfillable.length > 0)
    .sort((a, b) => a.schoolName.localeCompare(b.schoolName));
}
