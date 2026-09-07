import {
  calculateDistance,
  baseMatchScore,
  hasRequiredQualifications,
  toLocalDayStart,
  toLocalDateKey,
  getWeekBounds,
  leaveCoversDay,
  canTeacherCoverRequestHours,
  SCORE_OVERTIME,
  type AbsenceForMatching,
  type LeavePeriodForMatching,
} from '@/lib/matching';
import { toLocalDateInputValue } from '@/lib/dateKey';
import { getOpenRequestDays, type OpenDay } from '@/lib/requestDays';
import { requestUrgencyScore, urgencyReasons, detectOutbreaks, isSchoolInOutbreak } from '@/lib/urgency';
import { getSchoolYearForDate } from '@/lib/schoolYear';

/**
 * Idealbesetzung: ein Besetzungsvorschlag für ALLE offenen Anforderungen bis zu einem
 * Stichtag auf einmal.
 *
 * Zwei Regeln prägen das Verfahren und sind wichtiger als die reine Punktzahl:
 *
 *  1. FAIRE VERTEILUNG. Ein naives Greedy über alle Paarungen (absteigend nach
 *     Punkten) wäre naheliegend, führt hier zu einem unhaltbaren Ergebnis: Der
 *     Stammschul-Bonus (+1000) überstrahlt alles, also räumt eine Schule mit vielen
 *     eigenen Lehrkräften der Reihe nach alles ab, und die Nachbarschule bleibt bei
 *     Knappheit komplett leer. Deshalb ein Rundenverfahren - je Runde bekommt jede
 *     Schule höchstens eine Anforderung besetzt, bevor irgendeine ihre zweite bekommt.
 *     Das verbessert die Verteilung, kann bei echter Unverfügbarkeit aber keine
 *     Versorgung jeder Schule garantieren.
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
  /** "Bis auf Weiteres" – wird über den rollierenden Horizont ab heute besetzt. */
  isOpenEnded?: boolean | null;
  /** Von der Schule gemeldete vorzeitige Rückkehr. */
  endedAt?: Date | string | null;
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
  latitude: number | null;
  longitude: number | null;
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
  schoolYear: string;
  assignments?: { date: Date | string; hours: number; status: string }[];
};

export type ProposedSegment = {
  teacherId: string;
  teacherName: string;
  entries: { date: string; hours: number }[];
  score: number;
  reasons: string[];
  /** Nicht blockierende Hinweise; die Freigabe prüft Mehrarbeit verbindlich erneut. */
  warnings?: string[];
  /** Nächstbeste Lehrkräfte, die GENAU diese Tage übernehmen könnten (für den Tausch). */
  alternatives: { teacherId: string; name: string; score: number; reasons: string[]; warnings?: string[] }[];
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
  /** Beschränkt den Vorschlag auf Einsatztage im ausgewählten Schuljahr. */
  schoolYear?: string;
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
};

function weekKeyOf(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return toLocalDateKey(getWeekBounds(new Date(y, m - 1, d)).weekStart);
}

/** Berliner Kalendertag als lokales Date-Objekt, unabhängig von der Server-Zeitzone. */
function berlinDayStart(value: Date | string): Date {
  const key = toLocalDateInputValue(new Date(value));
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Kann die Lehrkraft an diesem Tag die geforderten Stunden übernehmen? */
function canWorkOn(state: TeacherState, request: BatchRequest, day: OpenDay): boolean {
  if (state.bookedDays.has(day.date)) return false;
  if (state.absentDays.has(day.date)) return false;

  const [y, m, d] = day.date.split('-').map(Number);
  const asDate = new Date(y, m - 1, d);
  if (state.leaves.some(l => leaveCoversDay(l, asDate))) return false;

  return canTeacherCoverRequestHours(state.teacher, request, day.date, day.hours);
}

/** Längster zusammenhängender Block innerhalb von `days`, den die Lehrkraft übernehmen kann. */
function longestRun(state: TeacherState, request: BatchRequest, days: OpenDay[]): OpenDay[] {
  let best: OpenDay[] = [];
  let current: OpenDay[] = [];
  for (const day of days) {
    if (canWorkOn(state, request, day)) {
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

function unbookBlock(state: TeacherState, block: OpenDay[]): void {
  for (const day of block) {
    state.bookedDays.delete(day.date);
    const wk = weekKeyOf(day.date);
    const next = (state.weekHours.get(wk) ?? 0) - day.hours;
    if (next > 0) state.weekHours.set(wk, next);
    else state.weekHours.delete(wk);
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

type UnmetNeed = {
  request: BatchRequest;
  result: SchoolProposal;
  proposal?: Proposal;
  days: OpenDay[];
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
  // Ein jahrgangsgebundener Lehrkraft-Datensatz darf ausschließlich die tatsächlichen
  // Einsatztage seines Schuljahres übernehmen (nicht bloß das Startdatum des Bedarfs).
  const compatibleDays = openDays.filter(day => {
    const [year, month, date] = day.date.split('-').map(Number);
    return state.teacher.schoolYear === getSchoolYearForDate(new Date(year, month - 1, date));
  });
  if (school.latitude == null || school.longitude == null) return null;

  const block = longestRun(state, request, compatibleDays);
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
    if (school.latitude == null || school.longitude == null) continue;
    if (state.teacher.id === chosenTeacherId) continue;
    if (state.teacher.status !== 'ACTIVE') continue;
    if (!block.every(day => {
      const [year, month, date] = day.date.split('-').map(Number);
      return state.teacher.schoolYear === getSchoolYearForDate(new Date(year, month - 1, date)) && canWorkOn(state, request, day);
    })) continue;

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

    const warnings = wouldBeOvertime(state, block)
      ? ['Mehrarbeit: Wochenstundenlimit wird überschritten.']
      : undefined;
    out.push({ teacherId: state.teacher.id, name: state.teacher.name, score, reasons, warnings });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

export function buildBatchProposal(input: BatchInput): SchoolProposal[] {
  const today = berlinDayStart(input.today ?? new Date());
  const until = berlinDayStart(input.until);

  const schoolsById = new Map(input.schools.map(s => [s.id, s]));
  const todayKey = toLocalDateKey(today);

  const isSelectedSchoolYearDay = (day: OpenDay): boolean => {
    if (!input.schoolYear) return true;
    const [year, month, date] = day.date.split('-').map(Number);
    return getSchoolYearForDate(new Date(year, month - 1, date)) === input.schoolYear;
  };

  // Nur offene Anforderungen, die bis zum Stichtag beginnen. FILLED, CANCELLED und
  // besonders UNFILLED bleiben außen vor - eine bewusste Absage des Schulamts darf ein
  // Sammelvorschlag nicht stillschweigend wieder aufleben lassen.
  const candidateRequests = input.requests.filter(r =>
    OPEN_STATUSES.has(r.status) &&
    schoolsById.has(r.schoolId) &&
    berlinDayStart(r.date) <= until
  );

  // Expanding a request is comparatively expensive for open-ended periods. Do it once
  // for the entire proposal and reuse exactly these date-filtered days for filling and
  // the bounded scarcity tie-break below.
  const openDaysByRequest = new Map<string, OpenDay[]>();
  for (const request of candidateRequests) {
    const openDays = getOpenRequestDays(request, request.assignments ?? [], today)
      .filter(day => day.date >= todayKey && day.date <= toLocalDateKey(until) && isSelectedSchoolYearDay(day));
    openDaysByRequest.set(request.id, openDays);
  }
  // Historical fixed needs, and requests ended before the selected range, must not
  // enter queues or outbreak counts merely because their original start lies before it.
  const relevant = candidateRequests.filter(request => (openDaysByRequest.get(request.id)?.length ?? 0) > 0);
  const requestsById = new Map(input.requests.map(request => [request.id, request]));

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
    };
  });

  // --- Dringlichkeit je Anforderung ---
  const outbreakDays = detectOutbreaks(
    relevant.map(r => ({
      date: r.date,
      endDate: r.endDate,
      isOpenEnded: r.isOpenEnded,
      endedAt: r.endedAt,
      priority: r.priority,
      status: r.status,
      schoolId: r.schoolId,
    })),
    { today }
  );

  const urgencyOf = (request: BatchRequest) => {
    const school = schoolsById.get(request.schoolId)!;
    const forUrgency = {
      date: request.date,
      // urgency.ts treats a laufender offener Bedarf specially. Nach einer gemeldeten
      // Rückkehr ist er aber nicht mehr laufend; `endedAt` ist dann sein wirksames
      // Ende für die Überfälligkeitsregel. Für die Ausbruchserkennung oben bleiben
      // beide Originalfelder erhalten.
      endDate: request.endedAt ?? request.endDate,
      isOpenEnded: Boolean(request.isOpenEnded && !request.endedAt),
      endedAt: request.endedAt,
      priority: request.priority,
      status: request.status,
    };
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

  const unmetNeeds: UnmetNeed[] = [];

  /** Besetzt eine einzelne Anforderung so weit wie möglich. */
  const fillRequest = (request: BatchRequest): void => {
    const school = schoolsById.get(request.schoolId)!;
    const result = results.get(request.schoolId)!;

    // Der Stichtag begrenzt die tatsächlichen Einsatztage, nicht nur den Start der
    // Anforderung. Sonst würde ein am 21. vorgeschlagener Mehrtagesbedarf den 24.
    // bereits mit freigeben.
    let openDays = [...(openDaysByRequest.get(request.id) ?? [])];
    const requiredHours = openDays.reduce((sum, d) => sum + d.hours, 0);
    result.coverage.requiredHours += requiredHours;

    if (openDays.length === 0) return;

    const segments: ProposedSegment[] = [];
    let assignedHours = 0;
    let sawAnyCandidate = false;

    // Blockweise auffüllen: immer die Lehrkraft mit dem längsten zusammenhängenden
    // Block, danach mit den verbliebenen Tagen weiter. Höchstens so viele Durchläufe
    // wie Tage - jeder Durchlauf entfernt mindestens einen Tag.
    // Die Obergrenze muss den ursprünglichen Umfang festhalten. Würde sie mit
    // `openDays.length` mitschrumpfen, endete eine Folge aus Ein-Tages-Segmenten nach
    // rund der Hälfte der Tage.
    const maxSegments = openDays.length;
    for (let guard = 0; guard < maxSegments && openDays.length > 0; guard++) {
      const candidates = states
        .map(state => evaluate(state, request, school, openDays))
        .filter((c): c is Candidate => c !== null);

      if (candidates.length === 0) break;
      sawAnyCandidate = true;

      const threatenedFutureDays = (candidate: Candidate): number => {
        const blockDays = new Set(candidate.block.map(day => day.date));
        let threatenedDays = 0;
        for (const [, pending] of queues) {
          for (const pendingRequest of pending) {
            const pendingSchool = schoolsById.get(pendingRequest.schoolId)!;
            const pendingDays = openDaysByRequest.get(pendingRequest.id) ?? [];
            // Scarcity is relevant only for a still-open one-day demand on a date the
            // current block would consume. A need on another date must not reserve a
            // generally flexible teacher.
            if (pendingDays.length !== 1 || !blockDays.has(pendingDays[0].date)) continue;
            if (evaluate(candidate.state, pendingRequest, pendingSchool, pendingDays)) threatenedDays += 1;
          }
        }
        return threatenedDays;
      };

      const threatened = new Map(candidates.map(candidate => [candidate, threatenedFutureDays(candidate)]));
      candidates.sort((a, b) => {
        // Kontinuität, Passung und insbesondere Mehrarbeit bleiben die primäre
        // Auswahlregel. Nur bei identischem Score und gleichem Mehrarbeitsstatus
        // schützt ein lokaler Tie-Break die Lehrkraft, die eine noch wartende
        // Ein-Tages-Anforderung am selben Datum abdecken kann. Das ist absichtlich
        // keine globale Optimierung und betrachtet nur bereits expandierte Tage.
        if (b.selectionScore !== a.selectionScore) return b.selectionScore - a.selectionScore;
        if (a.isOvertime === b.isOvertime) {
          const threatenedDiff = (threatened.get(a) ?? 0) - (threatened.get(b) ?? 0);
          if (threatenedDiff !== 0) return threatenedDiff;
        }
        if (a.distance !== b.distance) return a.distance - b.distance;
        return a.state.teacher.name.localeCompare(b.state.teacher.name);
      });

      const chosen = candidates[0];
      const blockKeys = new Set(chosen.block.map(d => d.date));

      bookBlock(chosen.state, chosen.block);
      segments.push({
        teacherId: chosen.state.teacher.id,
        teacherName: chosen.state.teacher.name,
        entries: chosen.block.map(d => ({ date: d.date, hours: d.hours })),
        score: Math.round(chosen.matchScore),
        reasons: chosen.reasons,
        warnings: chosen.isOvertime ? ['Mehrarbeit: Wochenstundenlimit wird überschritten.'] : undefined,
        // Alternativen werden nach Abschluss des gesamten Plans berechnet. So kann
        // niemand als Tauschoption erscheinen, der inzwischen am selben Tag einer
        // anderen Anforderung zugeteilt wurde.
        alternatives: [],
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
      unmetNeeds.push({ request, result, days: openDays });
      return;
    }

    const proposal: Proposal = {
      requestId: request.id,
      segments,
      coverage: { assignedHours, requiredHours },
      urgency: urgencyOf(request),
    };
    result.proposals.push(proposal);
    result.coverage.assignedHours += assignedHours;
    if (assignedHours >= requiredHours) result.coverage.filledRequests += 1;
    if (openDays.length > 0) unmetNeeds.push({ request, result, proposal, days: openDays });
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

  // Begrenzte Augmentierungs-Reparatur: Ein einziger noch offener Tag kann durch einen
  // Tausch geschlossen werden, wenn dessen einzige passende Lehrkraft gerade einen
  // anderen Ein-Tages-Abschnitt belegt. Wir bewegen diesen Abschnitt nur zu einer
  // sonst freien, ebenfalls passenden und nicht mehrarbeitspflichtigen Alternative.
  // Damit bleibt die Reparatur nachvollziehbar und endet garantiert, statt eine globale
  // Neuplanung zu versuchen.
  let repairAttempts = 0;
  const MAX_REPAIR_ATTEMPTS = Math.min(200, Math.max(1, relevant.length * 2));
  const stateByTeacherId = new Map(states.map(state => [state.teacher.id, state]));
  for (const unmet of unmetNeeds) {
    if (repairAttempts >= MAX_REPAIR_ATTEMPTS || unmet.days.length !== 1) continue;
    const targetDay = unmet.days[0];
    const targetSchool = schoolsById.get(unmet.request.schoolId)!;
    let repaired = false;

    for (const sourceResult of results.values()) {
      if (repaired || repairAttempts >= MAX_REPAIR_ATTEMPTS) break;
      const sourceSchool = schoolsById.get(sourceResult.schoolId)!;
      for (const sourceProposal of sourceResult.proposals) {
        if (repaired || repairAttempts >= MAX_REPAIR_ATTEMPTS) break;
        const sourceRequest = requestsById.get(sourceProposal.requestId)!;
        for (const sourceSegment of sourceProposal.segments) {
          if (sourceSegment.entries.length !== 1 || repaired || repairAttempts >= MAX_REPAIR_ATTEMPTS) continue;
          repairAttempts += 1;
          const sourceDay = { date: sourceSegment.entries[0].date, hours: sourceSegment.entries[0].hours, lessonHours: [] };
          const freedState = stateByTeacherId.get(sourceSegment.teacherId)!;

          // Erst die alte Buchung entfernen: so prüfen wir die reale Wochenlast nach
          // dem Tausch (auch wenn Quell- und Zieltag in derselben Woche liegen).
          unbookBlock(freedState, [sourceDay]);
          const targetCandidate = evaluate(freedState, unmet.request, targetSchool, [targetDay]);
          if (!targetCandidate || targetCandidate.isOvertime) {
            bookBlock(freedState, [sourceDay]);
            continue;
          }

          const replacement = states
            .filter(state => state.teacher.id !== freedState.teacher.id)
            .map(state => evaluate(state, sourceRequest, sourceSchool, [sourceDay]))
            .filter((candidate): candidate is Candidate => candidate !== null && !candidate.isOvertime)
            .sort((a, b) => {
              if (b.selectionScore !== a.selectionScore) return b.selectionScore - a.selectionScore;
              if (a.distance !== b.distance) return a.distance - b.distance;
              return a.state.teacher.name.localeCompare(b.state.teacher.name);
            })[0];
          if (!replacement) {
            bookBlock(freedState, [sourceDay]);
            continue;
          }

          bookBlock(replacement.state, [sourceDay]);
          bookBlock(freedState, [targetDay]);
          sourceSegment.teacherId = replacement.state.teacher.id;
          sourceSegment.teacherName = replacement.state.teacher.name;
          sourceSegment.score = Math.round(replacement.matchScore);
          sourceSegment.reasons = replacement.reasons;
          sourceSegment.warnings = undefined;
          sourceSegment.alternatives = [];

          const targetSegment: ProposedSegment = {
            teacherId: freedState.teacher.id,
            teacherName: freedState.teacher.name,
            entries: [{ date: targetDay.date, hours: targetDay.hours }],
            score: Math.round(targetCandidate.matchScore),
            reasons: targetCandidate.reasons,
            warnings: undefined,
            alternatives: [],
          };
          const targetProposal = unmet.proposal ?? {
            requestId: unmet.request.id,
            segments: [],
            coverage: {
              assignedHours: 0,
              requiredHours: (openDaysByRequest.get(unmet.request.id) ?? []).reduce((sum, day) => sum + day.hours, 0),
            },
            urgency: urgencyOf(unmet.request),
          };
          if (!unmet.proposal) {
            unmet.result.proposals.push(targetProposal);
            unmet.result.unfillable = unmet.result.unfillable.filter(item => item.requestId !== unmet.request.id);
          }
          targetProposal.segments.push(targetSegment);
          targetProposal.coverage.assignedHours += targetDay.hours;
          unmet.result.coverage.assignedHours += targetDay.hours;
          if (targetProposal.coverage.assignedHours >= targetProposal.coverage.requiredHours) {
            unmet.result.coverage.filledRequests += 1;
          }
          repaired = true;
        }
      }
    }
  }

  // Alternativen erst gegen den finalen Buchungsstand auswerten. Das ist absichtlich
  // konservativ: Schon eine Buchung am selben Tag schließt eine Lehrkraft aus, auch
  // wenn ein späterer UI-Tausch theoretisch noch weitere Umplanungen erlauben könnte.
  for (const result of results.values()) {
    const school = schoolsById.get(result.schoolId)!;
    for (const proposal of result.proposals) {
      const request = requestsById.get(proposal.requestId)!;
      for (const segment of proposal.segments) {
        const block = segment.entries.map(entry => ({
          date: entry.date,
          hours: entry.hours,
          lessonHours: [],
        }));
        segment.alternatives = findAlternatives(states, segment.teacherId, request, school, block);
        const state = states.find(item => item.teacher.id === segment.teacherId)!;
        const exceedsFinalWeek = segment.entries.some(entry =>
          (state.weekHours.get(weekKeyOf(entry.date)) ?? 0) > state.teacher.maxWeeklyHours
        );
        if (exceedsFinalWeek) {
          if (!segment.reasons.includes('Mehrarbeit')) segment.reasons.push('Mehrarbeit');
          segment.warnings = ['Mehrarbeit: Wochenstundenlimit wird überschritten.'];
        } else {
          segment.reasons = segment.reasons.filter(reason => reason !== 'Mehrarbeit');
          segment.warnings = undefined;
        }
      }
    }
  }

  return Array.from(results.values())
    .filter(r => r.proposals.length > 0 || r.unfillable.length > 0)
    .sort((a, b) => a.schoolName.localeCompare(b.schoolName));
}
