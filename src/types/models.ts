/**
 * Längere Abwesenheit über einen Zeitraum. Bewusst ohne Grund – dieser ist ein
 * Gesundheitsdatum nach Art. 9 DSGVO und wird nicht in der Anwendung erfasst.
 */
export type LeavePeriodData = {
  id: string;
  teacherId: string;
  startDate: string;
  /** null = bis auf Weiteres */
  endDate: string | null;
  reportedBy: string;
};

export type TeacherData = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  stammschuleId: string;
  maxWeeklyHours: number;
  isPartTime: boolean;
  schedule?: string;
  qualifications: string;
  status: string;
  gender?: string | null;
  homeLat: number;
  homeLng: number;
  preferredType: string;
  schoolYear: string;
  stammschule: SchoolData;
  assignments: AssignmentData[];
  /** Heute gemeldete Abwesenheiten (nur der heutige Tag wird geladen). */
  absences?: { id: string; date: string; type: string; reason?: string | null }[];
  /** True, wenn die Lehrkraft für den heutigen Tag einen Ausfall gemeldet hat. */
  isAbsentToday?: boolean;
  /** Laufende und künftige Langzeitabwesenheiten. */
  leavePeriods?: LeavePeriodData[];
  /** Der heute laufende Abwesenheitszeitraum, falls es einen gibt. */
  currentLeave?: LeavePeriodData | null;
  distanceToSchool?: number;
  matchScore?: number;
  assignedHours?: number;
  isOvertime?: boolean;
  hasConflict?: boolean;
  conflictDates?: string[];
};

export type SchoolData = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  type: string;
  generalInfo?: string;
  imageUrl?: string;
  pinLat?: number;
  pinLng?: number;
  user?: { id: string; email: string; role: string };
  /** Vom Schulamt gesetzt: kleines Kollegium, das Ausfälle kaum selbst auffangen kann. */
  isSmall?: boolean;
  /** Manuelle Häufungs-Markierung des Schulamts, befristet gültig bis zu diesem Datum. */
  outbreakUntil?: string | null;
  /** Manuelle Abwahl einer automatisch erkannten Häufung, befristet gültig bis zu diesem Datum. */
  outbreakDismissedUntil?: string | null;
};

export type AssignmentData = {
  id: string;
  requestId: string;
  teacherId: string;
  date: string;
  hours: number;
  status: string;
  teacher?: TeacherData;
  request?: RequestData;
};

export type RequestData = {
  id: string;
  schoolId: string;
  date: string;
  endDate?: string;
  priority: string;
  startHour: number;
  hours: number;
  weeklyHours: number;
  schoolType: string;
  substitutedTeacher: string;
  schedule?: string;
  qualifications: string;
  comments?: string;
  status: string;
  school: SchoolData;
  assignments: AssignmentData[];
  /** Begründung des Schulamts, warum keine Reserve gefunden wurde (status === 'UNFILLED'). */
  unfilledReason?: string | null;
  /** Zeitpunkt, zu dem das Schulamt die Anfrage als unbesetzbar markiert hat. */
  unfilledAt?: string | null;
  /** Bis auf Weiteres: kein Enddatum bekannt, der Bedarf läuft bis zur Rückkehrmeldung. */
  isOpenEnded?: boolean;
  /** Zeitpunkt, zu dem eine offene Anfrage beendet (Rückkehr gemeldet) wurde. */
  endedAt?: string | null;
};

// --- Form types (used in UI state, not DB models) ---

export type NewTeacherForm = {
  name: string;
  stammschuleId: string;
  maxWeeklyHours: string;
  qualifications: string;
  preferredType: string;
  address: string;
  isPartTime: boolean;
  email: string;
  password: string;
  phone: string;
  gender: string;
  schoolYear: string;
};

export type EditTeacherForm = {
  id: string;
  name: string;
  stammschuleId: string;
  maxWeeklyHours: string;
  qualifications: string;
  preferredType: string;
  address: string;
  isPartTime: boolean;
  email: string;
  password: string;
  phone: string;
  gender: string;
};

export type NewSchoolForm = {
  name: string;
  address: string;
  type: string;
  email: string;
  password: string;
  /** Kleines Kollegium, das Ausfälle kaum selbst auffangen kann – erhöht die Dringlichkeit. */
  isSmall?: boolean;
};

export type SystemSettingsForm = {
  smtpHost: string;
  smtpUser: string;
  smtpPass: string;
  impressum?: string;
};

export type TemplateSettingsForm = {
  headerText: string;
  returnAddress: string;
  logoUrl: string;
  latitude?: number | null;
  longitude?: number | null;
  contactAddress: string;
  contactPerson: string;
  city: string;
  amtsleitungName: string;
  amtsleitungTitle: string;
  signatureUrl: string;
  smtpHost?: string;
  smtpUser?: string;
  smtpPass?: string;
  lastBackupDate?: string | Date | null;
};

export type AssignmentFormEntry = {
  date: string;
  hours: string;
  selected: boolean;
};

export type AssignFormData = {
  teacherId: string;
  assignments: AssignmentFormEntry[];
};
