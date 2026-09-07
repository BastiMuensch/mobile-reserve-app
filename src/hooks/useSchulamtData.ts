import React, { useState, useEffect, useMemo, useCallback, useRef, createContext, useContext } from "react";
import { getCurrentSchoolYear, getLastSchoolYear, getNextSchoolYear } from "@/lib/schoolYear";
import { TeacherData, RequestData, SchoolData, TemplateSettingsForm } from "@/types/models";
import { detectOutbreaks } from "@/lib/urgency";
import { handleUnauthorized } from "@/lib/authClient";

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
  loadData: (yearOverride?: string) => Promise<void>;
  activeTeacherCount: number;
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
  const revisionRef = useRef(0);
  const currentSnapshot = snapshot?.year === selectedYear ? snapshot : null;
  const teachers = currentSnapshot?.teachers ?? EMPTY_TEACHERS;
  const requests = currentSnapshot?.requests ?? EMPTY_REQUESTS;
  const schools = currentSnapshot?.schools ?? EMPTY_SCHOOLS;
  const profile = currentSnapshot?.profile ?? null;
  const error = failure?.year === selectedYear ? failure.message : null;

  const selectedYearRef = useRef(selectedYear);
  useEffect(() => {
    selectedYearRef.current = selectedYear;
  }, [selectedYear]);

  const abortControllerRef = useRef<AbortController | null>(null);

  const loadData = useCallback(async (yearOverride?: string) => {
    // Abort previous in-flight request before starting a new one
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const targetYear = yearOverride ?? selectedYearRef.current;
    if (!endpointsKey) return;
    setIsRefreshing(true);
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 20_000);

    try {
      const active = endpointsKey.split(',').filter(Boolean) as SchulamtDataEndpoint[];
      if (active.length === 0) return;
      const wantTeachers = active.includes('teachers');
      const wantRequests = active.includes('requests');
      const wantSchools = active.includes('schools');
      const wantProfile = active.includes('profile');

      const [tRes, rRes, sRes, pRes] = await Promise.all([
        wantTeachers ? fetch(`/api/teachers?year=${encodeURIComponent(targetYear)}&t=${Date.now()}`, { cache: 'no-store', signal: controller.signal }) : null,
        wantRequests ? fetch(`/api/requests?year=${encodeURIComponent(targetYear)}&t=${Date.now()}`, { cache: 'no-store', signal: controller.signal }) : null,
        wantSchools ? fetch(`/api/schools?t=${Date.now()}`, { cache: 'no-store', signal: controller.signal }) : null,
        wantProfile ? fetch(`/api/schulamt/profile?t=${Date.now()}`, { cache: 'no-store', signal: controller.signal }).catch(() => null) : null,
      ]);

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
      if (controller.signal.aborted) return;
      if (!Array.isArray(teachers) || !Array.isArray(requests) || !Array.isArray(schools)) {
        throw new Error('Der Server hat unvollständige Daten geliefert. Bitte erneut versuchen.');
      }
      const revision = ++revisionRef.current;
      setSnapshot(previous => ({ year: targetYear, teachers, requests, schools,
        profile: profile ?? previous?.profile ?? null, updatedAt: new Date(), revision }));
      setProfileWarning(wantProfile && !profile ? 'Die Schulamts-Einstellungen konnten nicht aktualisiert werden. Die Bedarfsplanung bleibt verfügbar.' : null);
      setFailure(null);
    } catch (error: unknown) {
      if (controller.signal.aborted && !timedOut) {
        // Request was deliberately aborted, ignore silently
        return;
      }
      setFailure({ year: targetYear, message: timedOut
        ? 'Das Laden dauert zu lange. Bitte prüfen Sie die Verbindung und versuchen Sie es erneut.'
        : error instanceof Error ? error.message : 'Die Daten konnten nicht geladen werden.' });
    } finally {
      clearTimeout(timeout);
      if (abortControllerRef.current === controller) setIsRefreshing(false);
    }
  }, [endpointsKey]);

  useEffect(() => {
    loadData(selectedYear);

    const handleRefresh = () => loadData(selectedYear);
    window.addEventListener('app-refresh', handleRefresh);
    return () => {
      window.removeEventListener('app-refresh', handleRefresh);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [selectedYear, loadData]);

  const activeTeacherCount = useMemo(() => teachers.filter(t => t.status === 'ACTIVE' && !isOnLongTermLeave(t) && !isUnavailableToday(t)).length, [teachers]);
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
    .sort((a, b) => a.name.localeCompare(b.name)), [baseData.teachers, searchTeacherQuery]);

  const filteredRequests = useMemo(() => [...baseData.requests]
    .filter(r => {
      const q = searchRequestQuery.toLowerCase();
      return (r.school?.name || "").toLowerCase().includes(q) ||
             (r.priority || "").toLowerCase().includes(q);
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
