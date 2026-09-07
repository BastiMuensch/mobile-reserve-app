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
import { RequestData, TeacherData, AssignFormData } from "@/types/models";
import { getOpenRequestDays } from "@/lib/requestDays";
import { handleUnauthorized } from "@/lib/authClient";

function SchulamtOverviewPage() {
  const { selectedYear, setSelectedYear } = useSchulamtYear();
  const data = useSchulamtData({ year: selectedYear, setYear: setSelectedYear });
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<{ request: RequestData; candidates: TeacherData[]; year: string; version: number } | null>(null);
  const [matching, setMatching] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [matchAttempt, setMatchAttempt] = useState(0);
  const snapshotVersion = data.revision;
  const activeRequest = data.requests.find(request => request.id === selectedRequestId) ?? null;
  const hasCurrentMatch = !!matchResult && matchResult.request.id === selectedRequestId && matchResult.year === selectedYear && matchResult.version === snapshotVersion;
  const candidates = hasCurrentMatch ? matchResult.candidates : [];

  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [manualAssignModalOpen, setManualAssignModalOpen] = useState(false);
  const [assignData, setAssignData] = useState<AssignFormData | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [focusedLocation, setFocusedLocation] = useState<{ lat: number; lng: number } | null>(null);

  // Geteilter SchulamtDataContext aktualisiert Layout-KPIs und diese Ansicht gemeinsam.
  const refresh = () => {
    data.loadData();
  };

  useEffect(() => {
    if (!selectedRequestId || !activeRequest || data.error) return;
    const controller = new AbortController();
    let timeoutReached = false;
    const timeout = setTimeout(() => { timeoutReached = true; controller.abort(); }, 20_000);
    const load = async () => {
      setMatching(true);
      setMatchError(null);
      try {
        const res = await fetch(`/api/match/${selectedRequestId}`, { signal: controller.signal, cache: 'no-store' });
        if (res.status === 401) { handleUnauthorized(); return; }
        if (!res.ok) throw new Error('Passende Reserven konnten nicht geladen werden.');
        const result = await res.json();
        if (controller.signal.aborted) return;
        setMatchResult({ ...result, year: selectedYear, version: snapshotVersion });
      } catch (error) {
        if (!controller.signal.aborted || timeoutReached) setMatchError(timeoutReached ? 'Die Suche dauert zu lange. Bitte erneut versuchen.' : error instanceof Error ? error.message : 'Fehler bei der Suche.');
      } finally {
        clearTimeout(timeout);
        if (!controller.signal.aborted || timeoutReached) setMatching(false);
      }
    };
    void load();
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [selectedRequestId, selectedYear, snapshotVersion, activeRequest, data.error, matchAttempt]);

  /**
   * Klick auf eine Anfragezeile schaltet um: Ein erneuter Klick auf die bereits
   * geöffnete Anfrage klappt sie wieder zu. Ohne das ließ sich eine einmal
   * aufgeklappte Zeile nur schließen, indem man eine andere öffnete.
   */
  const handleMatch = (request: RequestData) => {
    setMatchError(null);
    setMatching(false);
    if (activeRequest?.id === request.id) {
      setSelectedRequestId(null);
      return;
    }
    setSelectedRequestId(request.id);
  };

  // Die KPI-Karten im Layout und "Auf der Karte zeigen" auf der Reserven-Seite verlinken
  // hierher statt geteilten State zu benutzen, weil sie auf einer anderen Route liegen.
  useEffect(() => {
    const matchRequestId = searchParams.get('matchRequestId');
    const focusLat = searchParams.get('focusLat');
    const focusLng = searchParams.get('focusLng');
    if (!matchRequestId && !focusLat && !focusLng) return;

    if (matchRequestId) {
      setMatchError(null);
      setMatching(false);
      setSelectedRequestId(matchRequestId);
        setTimeout(() => {
          document.getElementById('matching-engine')?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
    }
    if (focusLat && focusLng) {
      setFocusedLocation({ lat: Number(focusLat), lng: Number(focusLng) });
    }
    router.replace('/schulamt');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const openAssignModal = (candidate: TeacherData) => {
    if (!activeRequest || !hasCurrentMatch || data.error) return;

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
    if (!hasCurrentMatch || data.error) {
      toast({ variant: 'error', title: 'Bitte warten Sie auf die aktualisierte Reservensuche, bevor Sie zuweisen.' });
      return;
    }
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

      const result = await res.json();
      if (result.notificationWarning) toast({ variant: 'info', title: 'Zuweisung gespeichert – Benachrichtigung prüfen', description: result.notificationWarnings?.join(' ') || 'Mindestens eine Benachrichtigung konnte nicht versandt werden. Bitte prüfen Sie den E-Mail-Ausgang.' });
      else toast({ variant: 'success', title: 'Zuweisung gespeichert.' });
      setAssignModalOpen(false);
      setSelectedRequestId(null);
      refresh();
    } catch (error) {
      console.error('Assignment error:', error);
      toast({ variant: "error", title: "Netzwerkfehler bei der Zuweisung. Bitte versuchen Sie es erneut." });
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <div className="space-y-7">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,1fr)] gap-6 items-start">
      <div className="min-w-0">
      {activeRequest && (matching || !hasCurrentMatch) && !matchError && !data.error && <p role="status" className="rounded-lg bg-primary/5 p-3 text-sm mb-3">Passende Reserven werden gesucht …</p>}
      {activeRequest && matchError && <div role="alert" className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3 text-sm mb-3">{matchError} <button className="underline font-medium ml-2" onClick={() => setMatchAttempt(value => value + 1)}>Erneut suchen</button></div>}
      <RequestsList
        filteredRequests={data.filteredRequests}
        searchRequestQuery={data.searchRequestQuery}
        setSearchRequestQuery={data.setSearchRequestQuery}
        activeRequest={activeRequest}
        handleMatch={handleMatch}
        candidates={candidates}
        matching={matching || !hasCurrentMatch}
        matchError={matchError || data.error}
        openAssignModal={openAssignModal}
        openManualAssignModal={() => setManualAssignModalOpen(true)}
        outbreakDays={data.outbreakDays}
        isDeleting={isDeleting}
        setIsDeleting={setIsDeleting}
        loadData={refresh}
      />
      </div>
      <SchulamtMapSection
        schools={data.schools}
        teachers={data.teachers.filter(t => t.status !== 'PENDING')}
        activeRequest={activeRequest}
        focusedLocation={focusedLocation}
        centerCoord={data.profile?.latitude != null && data.profile?.longitude != null ? [data.profile.latitude, data.profile.longitude] : null}
      />
      </div>

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
