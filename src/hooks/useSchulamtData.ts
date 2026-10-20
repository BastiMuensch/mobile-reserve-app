import React, { useState, useEffect, useMemo, useCallback, useRef, createContext, useContext } from "react";
import { getCurrentSchoolYear, getLastSchoolYear, getNextSchoolYear } from "@/lib/schoolYear";
import { TeacherData, RequestData, SchoolData, TemplateSettingsForm } from "@/types/models";
import { detectOutbreaks } from "@/lib/urgency";
import { handleUnauthorized } from "@/lib/authClient";
import { compareTeachersByLastName, getAvailableTeachersToday } from "@/lib/teacherOverview";
import { requestPriorityLabel } from '@/lib/requestPriority';
import { createRefreshQueue, type RefreshTask } from '@/lib/refreshQueue';

/**
 * "Ungeplante Ausfälle" speist sich aus zwei Quellen: dem manuell vom Schulamt gesetzten
 * Status UNAVAILABLE und der Selbstmeldung einer Lehrkraft für den heutigen Tag – letztere
 * schreibt einen Absence-Datensatz, statt den Status dauerhaft umzustellen.
 */
const isUnavailableToday = (t: TeacherData) => t.status === 'UNAVAILABLE' || t.isAbsentToday === true;

/**
 * Eine laufende Langzeitabwesenheit (Mutterschutz, Elternzeit, ...) ist kein
 * "ungeplanter Ausfall" – sie ist ja lange bekannt. Für die Einsatzplanung ist die
 * Lehrkraft aber genauso wenig verfügbar, deshalb zählt sie nicht als aktiv.
 */
const isOnLongTermLeave = (t: TeacherData) => !!t.currentLeave;

export type SchulamtDataEndpoint = 'teachers' | 'requests' | 'schools' | 'profile';

const ALL_ENDPOINTS: SchulamtDataEndpoint[] = ['teachers', 'requests', 'schools', 'profile'];
const EMPTY_TEACHERS: TeacherData[] = [];
const EMPTY_REQUESTS: RequestData[] = [];
const EMPTY_SCHOOLS: SchoolData[] = [];

export interface UseSchulamtDataOptions {
  endpoints?: SchulamtDataEndpoint[];
  year?: string;
  setYear?: (year: string) => void;
  isolated?: boolean;
}

export interface SchulamtSharedData {
  selectedYear: string;
  setSelectedYear: (year: string) => void;
  availableYears: string[];
  teachers: TeacherData[];
  requests: RequestData[];
  schools: SchoolData[];
  profile: TemplateSettingsForm | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  lastUpdated: Date | null;
  revision: number;
  profileWarning: string | null;
  loadData: () => Promise<void>;
  activeTeacherCount: number;
  availableTeachersToday: TeacherData[];
  openRequestCount: number;
  filledRequestCount: number;
  sickTeacherCount: number;
  openRequests: RequestData[];
  filledRequests: RequestData[];
  sickTeachers: TeacherData[];
  onLeaveTeachers: TeacherData[];
  outbreakDays: ReturnType<typeof detectOutbreaks>;
}

export const SchulamtDataContext = createContext<SchulamtSharedData | null>(null);

export function SchulamtDataProvider({
  value,
  children,
}: {
  value: SchulamtSharedData;
  children: React.ReactNode;
}) {
  return React.createElement(SchulamtDataContext.Provider, { value }, children);
}

export function useCreateSchulamtData(options: UseSchulamtDataOptions = {}): SchulamtSharedData {
  const endpoints = options.endpoints ?? ALL_ENDPOINTS;
  const endpointsKey = endpoints.join(',');

  const [internalYear, setInternalYear] = useState(getCurrentSchoolYear());
  const selectedYear = options.year ?? internalYear;
  const setSelectedYear = options.setYear ?? setInternalYear;
  const availableYears = [getLastSchoolYear(), getCurrentSchoolYear(), getNextSchoolYear()];

  // Publish one complete, year-bound snapshot: never mix endpoints or school years.
  const [snapshot, setSnapshot] = useState<{
    year: string; teachers: TeacherData[]; requests: RequestData[];
    schools: SchoolData[]; profile: TemplateSettingsForm | null; updatedAt: Date; revision: number;
  } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [failure, setFailure] = useState<{ year: string; message: string } | null>(null);
  const [profileWarning, setProfileWarning] = useState<string | null>(null);
  const currentSnapshot = snapshot?.year === selectedYear ? snapshot : null;
  const snapshotTeachers = currentSnapshot?.teachers ?? EMPTY_TEACHERS;
  const teachers = useMemo(() => [...snapshotTeachers].sort(compareTeachersByLastName), [snapshotTeachers]);
  const requests = currentSnapshot?.requests ?? EMPTY_REQUESTS;
  const schools = currentSnapshot?.schools ?? EMPTY_SCHOOLS;
  const profile = currentSnapshot?.profile ?? null;
  const error = failure?.year === selectedYear ? failure.message : null;

  const loadSnapshot = useCallback(async (task: RefreshTask) => {
    const { signal } = task;
    const targetYear = selectedYear;
    if (!endpointsKey) return;
    setIsRefreshing(true);

    try {
      const active = endpointsKey.split(',').filter(Boolean) as SchulamtDataEndpoint[];
      if (active.length === 0) return;
      const wantTeachers = active.includes('teachers');
      const wantRequests = active.includes('requests');
      const wantSchools = active.includes('schools');
      const wantProfile = active.includes('profile');

      const [tRes, rRes, sRes, pRes] = await Promise.all([
        wantTeachers ? fetch(`/api/teachers?year=${encodeURIComponent(targetYear)}&t=${Date.now()}`, { cache: 'no-store', signal }) : null,
        wantRequests ? fetch(`/api/requests?year=${encodeURIComponent(targetYear)}&t=${Date.now()}`, { cache: 'no-store', signal }) : null,
        wantSchools ? fetch(`/api/schools?t=${Date.now()}`, { cache: 'no-store', signal }) : null,
        wantProfile ? fetch(`/api/schulamt/profile?t=${Date.now()}`, { cache: 'no-store', signal }).catch(() => null) : null,
      ]);
      if (task.cancelled) return;
      if (task.timedOut) throw new Error('timeout');

      // Check for 401 unauthorized to prevent polling cascades
      if (tRes?.status === 401 || rRes?.status === 401 || sRes?.status === 401 || pRes?.status === 401) {
        handleUnauthorized();
        return;
      }

      if ([tRes, rRes, sRes].some(res => res && !res.ok)) {
        throw new Error('Die Daten konnten nicht vollständig geladen werden. Bitte erneut versuchen.');
      }
      const [teachers, requests, schools, profile] = await Promise.all([
        tRes ? tRes.json() : [], rRes ? rRes.json() : [],
        sRes ? sRes.json() : [], pRes?.ok ? pRes.json().catch(() => null) : null,
      ]);
      if (task.cancelled) return;
      if (task.timedOut) throw new Error('timeout');
      if (!Array.isArray(teachers) || !Array.isArray(requests) || !Array.isArray(schools)) {
        throw new Error('Der Server hat unvollständige Daten geliefert. Bitte erneut versuchen.');
      }
      setSnapshot(previous => ({ year: targetYear, teachers, requests, schools,
        profile: profile ?? previous?.profile ?? null, updatedAt: new Date(), revision: (previous?.revision ?? 0) + 1 }));
      setProfileWarning(wantProfile && !profile ? 'Die Schulamts-Einstellungen konnten nicht aktualisiert werden. Die Bedarfsplanung bleibt verfügbar.' : null);
      setFailure(null);
    } catch (error: unknown) {
      if (task.cancelled) {
        // Request was deliberately aborted, ignore silently
        return;
      }
      setFailure({ year: targetYear, message: task.timedOut
        ? 'Das Laden dauert zu lange. Bitte prüfen Sie die Verbindung und versuchen Sie es erneut.'
        : error instanceof Error ? error.message : 'Die Daten konnten nicht geladen werden.' });
    } finally {
      if (!task.cancelled) setIsRefreshing(false);
    }
  }, [endpointsKey, selectedYear]);
  const refreshQueue = useMemo(() => createRefreshQueue(loadSnapshot), [loadSnapshot]);
  const activeQueueRef = useRef<typeof refreshQueue | null>(null);
  // Mutation handlers may finish after a school-year change. Their stable
  // callback must refresh the active view, never revive the old year's queue.
  const loadData = useCallback(() =>
    activeQueueRef.current?.refresh() ?? Promise.resolve(), []);

  useEffect(() => {
    activeQueueRef.current = refreshQueue;
    void refreshQueue.refresh();

    const handleRefresh = () => void refreshQueue.refresh();
    window.addEventListener('app-refresh', handleRefresh);
    return () => {
      window.removeEventListener('app-refresh', handleRefresh);
      if (activeQueueRef.current === refreshQueue) activeQueueRef.current = null;
      refreshQueue.cancel();
    };
  }, [selectedYear, refreshQueue]);

  const availableTeachersToday = useMemo(() => getAvailableTeachersToday(teachers), [teachers]);
  const activeTeacherCount = availableTeachersToday.length;
  const onLeaveTeachers = useMemo(() => teachers.filter(isOnLongTermLeave), [teachers]);
  const openRequestCount = useMemo(() => requests.filter(r => r.status === 'PENDING' || r.status === 'PARTIALLY_FILLED').length, [requests]);
  const filledRequestCount = useMemo(() => requests.filter(r => r.status === 'FILLED').length, [requests]);
  const sickTeacherCount = useMemo(() => teachers.filter(isUnavailableToday).length, [teachers]);

  const outbreakDays = useMemo(() => detectOutbreaks(requests), [requests]);

  const openRequests = useMemo(() => requests.filter(r => r.status === 'PENDING' || r.status === 'PARTIALLY_FILLED'), [requests]);
  const filledRequests = useMemo(() => requests.filter(r => r.status === 'FILLED'), [requests]);
  const sickTeachers = useMemo(() => teachers.filter(isUnavailableToday), [teachers]);

  return {
    selectedYear,
    setSelectedYear,
    availableYears,
    teachers,
    requests,
    schools,
    profile,
    isLoading: !currentSnapshot && !!endpointsKey,
    isRefreshing,
    error,
    lastUpdated: currentSnapshot?.updatedAt ?? null,
    revision: currentSnapshot?.revision ?? 0,
    profileWarning,
    loadData,
    activeTeacherCount,
    availableTeachersToday,
    openRequestCount,
    filledRequestCount,
    sickTeacherCount,
    openRequests,
    filledRequests,
    sickTeachers,
    onLeaveTeachers,
    outbreakDays,
  };
}

export function useSchulamtData(options: UseSchulamtDataOptions = {}) {
  const sharedContext = useContext(SchulamtDataContext);
  const createdData = useCreateSchulamtData(
    !options.isolated && sharedContext ? { endpoints: [] } : options
  );

  const baseData = (!options.isolated && sharedContext) ? sharedContext : createdData;

  const [searchTeacherQuery, setSearchTeacherQuery] = useState("");
  const [searchRequestQuery, setSearchRequestQuery] = useState("");

  const filteredTeachers = useMemo(() => [...baseData.teachers]
    .filter(t => {
      const q = searchTeacherQuery.toLowerCase();
      return (t.name || "").toLowerCase().includes(q) ||
             (t.stammschule?.name || "").toLowerCase().includes(q) ||
             (t.qualifications || "").toLowerCase().includes(q);
    })
    .sort(compareTeachersByLastName), [baseData.teachers, searchTeacherQuery]);

  const filteredRequests = useMemo(() => [...baseData.requests]
    .filter(r => {
      const q = searchRequestQuery.toLowerCase();
      return (r.school?.name || "").toLowerCase().includes(q) ||
             requestPriorityLabel(r.priority).toLowerCase().includes(q);
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()), [baseData.requests, searchRequestQuery]);

  const sortedSchools = useMemo(() => [...baseData.schools].sort((a, b) => a.name.localeCompare(b.name)), [baseData.schools]);

  return {
    ...baseData,
    searchTeacherQuery,
    setSearchTeacherQuery,
    searchRequestQuery,
    setSearchRequestQuery,
    filteredTeachers,
    filteredRequests,
    sortedSchools,
  };
}
