import { useState, useEffect, useMemo, useCallback } from "react";
import { getCurrentSchoolYear, getLastSchoolYear, getNextSchoolYear } from "@/lib/schoolYear";
import { TeacherData, RequestData, SchoolData, AssignmentData } from "@/types/models";

export function useSchulamtData() {
  const [selectedYear, setSelectedYear] = useState(getCurrentSchoolYear());
  const availableYears = [getLastSchoolYear(), getCurrentSchoolYear(), getNextSchoolYear()];

  const [teachers, setTeachers] = useState<TeacherData[]>([]);
  const [requests, setRequests] = useState<RequestData[]>([]);
  const [schools, setSchools] = useState<SchoolData[]>([]);
  
  const [searchTeacherQuery, setSearchTeacherQuery] = useState("");
  const [searchRequestQuery, setSearchRequestQuery] = useState("");

  const loadData = useCallback(async (year?: string) => {
    try {
      const targetYear = year || selectedYear;
      const [tRes, rRes, sRes] = await Promise.all([
        fetch(`/api/teachers?year=${encodeURIComponent(targetYear)}&t=${Date.now()}`, { cache: 'no-store' }),
        fetch(`/api/requests?year=${encodeURIComponent(targetYear)}&t=${Date.now()}`, { cache: 'no-store' }),
        fetch(`/api/schools?t=${Date.now()}`, { cache: 'no-store' })
      ]);
      
      if (tRes.ok) setTeachers(await tRes.json());
      if (rRes.ok) setRequests(await rRes.json());
      if (sRes.ok) setSchools(await sRes.json());
    } catch (error) {
      console.error('Failed to load data:', error);
    }
  }, [selectedYear]);

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

  const activeTeacherCount = useMemo(() => teachers.filter(t => t.status === 'ACTIVE').length, [teachers]);
  const openRequestCount = useMemo(() => requests.filter(r => r.status === 'PENDING' || r.status === 'PARTIALLY_FILLED').length, [requests]);
  const filledRequestCount = useMemo(() => requests.filter(r => r.status === 'FILLED').length, [requests]);
  const sickTeacherCount = useMemo(() => teachers.filter(t => t.status === 'SICK').length, [teachers]);

  const openRequests = useMemo(() => requests.filter(r => r.status === 'PENDING' || r.status === 'PARTIALLY_FILLED'), [requests]);
  const filledRequests = useMemo(() => requests.filter(r => r.status === 'FILLED'), [requests]);
  const sickTeachers = useMemo(() => teachers.filter(t => t.status === 'SICK'), [teachers]);

  return {
    selectedYear,
    setSelectedYear,
    availableYears,
    teachers,
    setTeachers,
    requests,
    setRequests,
    schools,
    setSchools,
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
    loadData
  };
}
