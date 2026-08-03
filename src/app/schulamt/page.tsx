"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSchulamtData } from "@/hooks/useSchulamtData";
import { useSchulamtYear } from "@/hooks/useSchulamtYear";
import { useToast } from "@/components/ui/toast";
import { SchulamtMapSection } from "@/components/schulamt/SchulamtMapSection";
import { RequestsList } from "@/components/schulamt/RequestsList";
import { AssignModal } from "@/components/schulamt/dialogs/AssignModal";
import { ManualAssignModal } from "@/components/schulamt/dialogs/ManualAssignModal";
import { RequestData, TeacherData, AssignmentData, AssignFormData } from "@/types/models";

function SchulamtOverviewPage() {
  const { selectedYear, setSelectedYear } = useSchulamtYear();
  const data = useSchulamtData({ year: selectedYear, setYear: setSelectedYear });
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeRequest, setActiveRequest] = useState<RequestData | null>(null);
  const [candidates, setCandidates] = useState<TeacherData[]>([]);

  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [manualAssignModalOpen, setManualAssignModalOpen] = useState(false);
  const [assignData, setAssignData] = useState<AssignFormData | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [focusedLocation, setFocusedLocation] = useState<{ lat: number; lng: number } | null>(null);

  // Kopfzeile und Navigation liegen im Layout und haben deshalb ihre eigene, unabhängige
  // Hook-Instanz für die KPI-Zahlen. Ein einfacher data.loadData() hier würde nur diese
  // Seite aktualisieren - das app-refresh-Event (siehe useSchulamtData) sorgt dafür, dass
  // auch das Layout sofort den neuen Stand sieht statt bis zum nächsten Polling zu warten.
  const refresh = () => {
    data.loadData();
    window.dispatchEvent(new Event('app-refresh'));
  };

  const handleMatchById = async (id: string) => {
    const res = await fetch(`/api/match/${id}`);
    if (res.ok) {
      const result = await res.json();
      setActiveRequest(result.request);
      setCandidates(result.candidates);
    }
  };

  const handleMatch = (request: RequestData) => handleMatchById(request.id);

  // Die KPI-Karten im Layout und "Auf der Karte zeigen" auf der Reserven-Seite verlinken
  // hierher statt geteilten State zu benutzen, weil sie auf einer anderen Route liegen.
  useEffect(() => {
    const matchRequestId = searchParams.get('matchRequestId');
    const focusLat = searchParams.get('focusLat');
    const focusLng = searchParams.get('focusLng');
    if (!matchRequestId && !focusLat && !focusLng) return;

    if (matchRequestId) {
      handleMatchById(matchRequestId).then(() => {
        setTimeout(() => {
          document.getElementById('matching-engine')?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      });
    }
    if (focusLat && focusLng) {
      setFocusedLocation({ lat: Number(focusLat), lng: Number(focusLng) });
    }
    router.replace('/schulamt');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const openAssignModal = (candidate: TeacherData) => {
    if (!activeRequest) return;

    const currentAssignedHours = activeRequest.assignments?.filter((a: AssignmentData) => a.status !== 'REJECTED').reduce((sum: number, a: AssignmentData) => sum + a.hours, 0) || 0;
    const requestRemaining = activeRequest.weeklyHours - currentAssignedHours;
    const teacherRemaining = candidate.maxWeeklyHours - (candidate.assignedHours || 0);
    const defaultHours = Math.min(requestRemaining, teacherRemaining, activeRequest.hours);

    const startDate = new Date(activeRequest.date);
    const endDate = activeRequest.endDate ? new Date(activeRequest.endDate) : startDate;

    let reqSchedule: Record<string, number[]> | null = null;
    if (activeRequest.schedule) {
      try { reqSchedule = JSON.parse(activeRequest.schedule); } catch (e) { console.warn('Failed to parse activeRequest schedule', e); }
    }

    const dates = [];
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay();
      if (dayOfWeek !== 6 && dayOfWeek !== 7) {
        const dateStr = d.toISOString().split('T')[0];
        const assignmentsForDate = activeRequest.assignments?.filter((a: AssignmentData) => a.date.startsWith(dateStr) && a.status !== 'REJECTED') || [];
        const alreadyAssignedHours = assignmentsForDate.reduce((sum: number, a: AssignmentData) => sum + a.hours, 0);

        let hoursForDay = defaultHours;
        let isSelected = true;

        if (reqSchedule) {
          const requestedHours = reqSchedule[dayOfWeek.toString()]?.length || 0;
          const remainingForDay = requestedHours - alreadyAssignedHours;
          if (remainingForDay <= 0) continue;
          hoursForDay = Math.min(remainingForDay, teacherRemaining);
          isSelected = hoursForDay > 0;
        } else {
          const remainingForDay = activeRequest.hours - alreadyAssignedHours;
          if (remainingForDay <= 0) continue;
          hoursForDay = Math.min(remainingForDay, teacherRemaining);
          isSelected = hoursForDay > 0;
        }

        dates.push({
          date: dateStr,
          hours: hoursForDay > 0 ? hoursForDay.toString() : "1",
          selected: isSelected
        });
      }
    }

    if (dates.length === 0) {
      dates.push({
        date: startDate.toISOString().split('T')[0],
        hours: defaultHours > 0 ? defaultHours.toString() : "1",
        selected: true
      });
    }

    setAssignData({ teacherId: candidate.id, assignments: dates });
    setAssignModalOpen(true);
  };

  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAssigning) return;
    if (!activeRequest || !assignData) return;
    setIsAssigning(true);

    const selectedAssignments = assignData.assignments.filter(a => a.selected).map(a => ({
      ...a, hours: Number(a.hours)
    }));
    if (selectedAssignments.length === 0) {
      toast({ variant: "error", title: "Bitte wählen Sie mindestens einen Tag aus." });
      setIsAssigning(false);
      return;
    }

    try {
      const res = await fetch("/api/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: activeRequest.id,
          teacherId: assignData.teacherId,
          assignments: selectedAssignments
        })
      });

      if (!res.ok) {
        const err = await res.json();
        toast({ variant: "error", title: `Fehler bei der Zuweisung: ${err.error || 'Unbekannter Fehler'}` });
        return;
      }

      setAssignModalOpen(false);
      setActiveRequest(null);
      setCandidates([]);
      refresh();
    } catch (error) {
      console.error('Assignment error:', error);
      toast({ variant: "error", title: "Netzwerkfehler bei der Zuweisung. Bitte versuchen Sie es erneut." });
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <div className="space-y-6">
      <SchulamtMapSection
        schools={data.schools}
        teachers={data.teachers.filter(t => t.status !== 'PENDING')}
        activeRequest={activeRequest}
        focusedLocation={focusedLocation}
        centerCoord={data.profile?.latitude && data.profile?.longitude ? [data.profile.latitude, data.profile.longitude] : null}
      />

      <RequestsList
        filteredRequests={data.filteredRequests}
        searchRequestQuery={data.searchRequestQuery}
        setSearchRequestQuery={data.setSearchRequestQuery}
        activeRequest={activeRequest}
        handleMatch={handleMatch}
        candidates={candidates}
        openAssignModal={openAssignModal}
        openManualAssignModal={() => setManualAssignModalOpen(true)}
        outbreakDays={data.outbreakDays}
        isDeleting={isDeleting}
        setIsDeleting={setIsDeleting}
        loadData={refresh}
      />

      <AssignModal
        assignModalOpen={assignModalOpen}
        setAssignModalOpen={setAssignModalOpen}
        assignData={assignData}
        setAssignData={setAssignData}
        handleAssignSubmit={handleAssignSubmit}
        isAssigning={isAssigning}
      />

      <ManualAssignModal
        isOpen={manualAssignModalOpen}
        setIsOpen={setManualAssignModalOpen}
        allTeachers={data.teachers}
        activeRequest={activeRequest}
        onSelectCandidate={openAssignModal}
      />
    </div>
  );
}

export default function SchulamtPage() {
  return (
    <Suspense fallback={null}>
      <SchulamtOverviewPage />
    </Suspense>
  );
}
