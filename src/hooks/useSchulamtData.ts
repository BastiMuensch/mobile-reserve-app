import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { getCurrentSchoolYear, getLastSchoolYear, getNextSchoolYear } from "@/lib/schoolYear";
import { TeacherData, RequestData, SchoolData, TemplateSettingsForm } from "@/types/models";
import { detectOutbreaks } from "@/lib/urgency";

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

export interface UseSchulamtDataOptions {
  /**
   * Welche Endpunkte geladen werden. Die Schulamt-Seiten wurden aus einem einzigen
   * Dashboard in vier Routen aufgeteilt – jede Seite fragt hier nur noch das ab, was sie
   * auch tatsächlich rendert (z.B. braucht die Statistik-Seite keine Schulen). Default:
   * alle vier Endpunkte, wie im ursprünglichen Dashboard.
   */
  endpoints?: SchulamtDataEndpoint[];
  /**
   * Geteiltes Schuljahr, z.B. aus dem SchulamtYearContext im Layout. Ist es gesetzt,
   * verwaltet dieser Hook keinen eigenen selectedYear-State mehr, sondern liest/schreibt
   * über diese Werte – so bleibt die Jahresauswahl über alle vier Schulamt-Seiten hinweg
   * synchron, obwohl jede Seite ihre eigene Hook-Instanz hat.
   */
  year?: string;
  setYear?: (year: string) => void;
}

export function useSchulamtData(options: UseSchulamtDataOptions = {}) {
  const endpoints = options.endpoints ?? ALL_ENDPOINTS;
  const endpointsKey = endpoints.join(',');

  const [internalYear, setInternalYear] = useState(getCurrentSchoolYear());
  const selectedYear = options.year ?? internalYear;
  const setSelectedYear = options.setYear ?? setInternalYear;
  const availableYears = [getLastSchoolYear(), getCurrentSchoolYear(), getNextSchoolYear()];

  const [teachers, setTeachers] = useState<TeacherData[]>([]);
  const [requests, setRequests] = useState<RequestData[]>([]);
  const [schools, setSchools] = useState<SchoolData[]>([]);
  const [profile, setProfile] = useState<TemplateSettingsForm | null>(null);

  const [searchTeacherQuery, setSearchTeacherQuery] = useState("");
  const [searchRequestQuery, setSearchRequestQuery] = useState("");

  // Use ref so loadData is stable and never causes re-renders when selectedYear changes
  const selectedYearRef = useRef(selectedYear);
  useEffect(() => {
    selectedYearRef.current = selectedYear;
  }, [selectedYear]);

  const loadData = useCallback(async (yearOverride?: string) => {
    try {
      const targetYear = yearOverride ?? selectedYearRef.current;
      const active = endpointsKey.split(',').filter(Boolean) as SchulamtDataEndpoint[];
      const wantTeachers = active.includes('teachers');
      const wantRequests = active.includes('requests');
      const wantSchools = active.includes('schools');
      const wantProfile = active.includes('profile');

      const [tRes, rRes, sRes, pRes] = await Promise.all([
        wantTeachers ? fetch(`/api/teachers?year=${encodeURIComponent(targetYear)}&t=${Date.now()}`, { cache: 'no-store' }) : null,
        wantRequests ? fetch(`/api/requests?year=${encodeURIComponent(targetYear)}&t=${Date.now()}`, { cache: 'no-store' }) : null,
        wantSchools ? fetch(`/api/schools?t=${Date.now()}`, { cache: 'no-store' }) : null,
        wantProfile ? fetch(`/api/schulamt/profile?t=${Date.now()}`, { cache: 'no-store' }) : null,
      ]);

      if (tRes?.ok) setTeachers(await tRes.json());
      if (rRes?.ok) setRequests(await rRes.json());
      if (sRes?.ok) setSchools(await sRes.json());
      if (pRes?.ok) setProfile(await pRes.json());
    } catch (error) {
      console.error('Failed to load data:', error);
    }
  }, [endpointsKey]); // stable unless the set of requested endpoints changes; year comes from the ref

  useEffect(() => {
    loadData(selectedYear);

    const handleRefresh = () => loadData(selectedYear);
    window.addEventListener('app-refresh', handleRefresh);
    return () => window.removeEventListener('app-refresh', handleRefresh);
  }, [selectedYear, loadData]);

  const filteredTeachers = useMemo(() => [...teachers]
    .filter(t => {
      const q = searchTeacherQuery.toLowerCase();
      return (t.name || "").toLowerCase().includes(q) ||
             (t.stammschule?.name || "").toLowerCase().includes(q) ||
             (t.qualifications || "").toLowerCase().includes(q);
    })
    .sort((a, b) => a.name.localeCompare(b.name)), [teachers, searchTeacherQuery]);

  const filteredRequests = useMemo(() => [...requests]
    .filter(r => {
      const q = searchRequestQuery.toLowerCase();
      return (r.school?.name || "").toLowerCase().includes(q) ||
             (r.priority || "").toLowerCase().includes(q);
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()), [requests, searchRequestQuery]);

  const sortedSchools = useMemo(() => [...schools].sort((a, b) => a.name.localeCompare(b.name)), [schools]);

  const activeTeacherCount = useMemo(() => teachers.filter(t => t.status === 'ACTIVE' && !isOnLongTermLeave(t)).length, [teachers]);
  const onLeaveTeachers = useMemo(() => teachers.filter(isOnLongTermLeave), [teachers]);
  const openRequestCount = useMemo(() => requests.filter(r => r.status === 'PENDING' || r.status === 'PARTIALLY_FILLED').length, [requests]);
  const filledRequestCount = useMemo(() => requests.filter(r => r.status === 'FILLED').length, [requests]);
  const sickTeacherCount = useMemo(() => teachers.filter(isUnavailableToday).length, [teachers]);

  // Häufungen bewusst über ALLE Anfragen erkennen, nicht über die gefilterten: Sonst
  // verschwände die Häufung, sobald jemand die Suche benutzt.
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
    searchTeacherQuery,
    setSearchTeacherQuery,
    searchRequestQuery,
    setSearchRequestQuery,
    filteredTeachers,
    filteredRequests,
    sortedSchools,
    activeTeacherCount,
    openRequestCount,
    filledRequestCount,
    sickTeacherCount,
    openRequests,
    filledRequests,
    sickTeachers,
    onLeaveTeachers,
    outbreakDays,
    profile,
    loadData
  };
}
