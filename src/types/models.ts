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
  distanceToSchool?: number;
  matchScore?: number;
  assignedHours?: number;
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
};

export type MailSettings = {
  smtpHost: string;
  smtpUser: string;
  smtpPass: string;
};

export type TemplateSettingsForm = {
  headerText: string;
  returnAddress: string;
  logoUrl: string;
  contactAddress: string;
  contactPerson: string;
  city: string;
  amtsleitungName: string;
  amtsleitungTitle: string;
  signatureUrl: string;
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
