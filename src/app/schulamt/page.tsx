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
import { getOpenRequestDays } from "@/lib/requestDays";

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

    // Die Tageszerlegung liegt in src/lib/requestDays.ts – dieselbe Funktion nutzt die
    // Idealbesetzung serverseitig. Sie rechnet durchgehend in lokalen Tagen; die
    // frühere Inline-Variante hier mischte toISOString() (UTC) mit lokalem Wochentag.
    const teacherRemaining = candidate.maxWeeklyHours - (candidate.assignedHours || 0);
    const openDays = getOpenRequestDays(activeRequest, activeRequest.assignments || []);

    const dates = openDays.map(day => {
      const hours = Math.min(day.hours, teacherRemaining > 0 ? teacherRemaining : day.hours);
      return {
        date: day.date,
        hours: hours > 0 ? hours.toString() : "1",
        selected: hours > 0,
      };
    });

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
