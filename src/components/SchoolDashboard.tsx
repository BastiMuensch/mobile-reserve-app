"use client";

import { useAuth } from "./AuthProvider";
import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { RequestData } from "@/types/models";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Building, Info, Plus, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { SchoolRequestForm } from "./school/SchoolRequestForm";
import { SchoolRequestsList } from "./school/SchoolRequestsList";
import { RequestLifecycleDialog } from "./requests/RequestLifecycleDialog";
import { SchoolPushSettings } from "./school/SchoolPushSettings";
import { hasSchoolProfile } from "@/lib/schoolProfile";
import { handleUnauthorized } from "@/lib/authClient";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { createRefreshQueue, type RefreshTask } from "@/lib/refreshQueue";

export function SchoolDashboard() {
  const { user } = useAuth();
  const [requestFormOpen, setRequestFormOpen] = useState(false);
  const [requestFormDirty, setRequestFormDirty] = useState(false);
  const [requestFormSubmitting, setRequestFormSubmitting] = useState(false);
  const confirm = useConfirm();
  const [requests, setRequests] = useState<RequestData[]>([]);
  const [loading, setLoading] = useState(true);
  const [requestsError, setRequestsError] = useState("");
  const schoolId = user?.schoolId;
  const [requestOptions, setRequestOptions] = useState<{ schoolId: string; requestUrgencyNoteEnabled: boolean; specialistFields: string[] } | null>(null);

  useEffect(() => {
    if (!schoolId) return;
    const optionsQueue = createRefreshQueue(async (task) => {
      try {
        const response = await fetch('/api/school/request-options', { cache: 'no-store', signal: task.signal });
        if (task.cancelled) return;
        if (response.status === 401) handleUnauthorized();
        const options = response.ok ? await response.json() : null;
        if (!task.signal.aborted) setRequestOptions({ schoolId, requestUrgencyNoteEnabled: options?.requestUrgencyNoteEnabled === true, specialistFields: Array.isArray(options?.specialistFields) ? options.specialistFields : [] });
      } catch {
        if (!task.cancelled) setRequestOptions({ schoolId, requestUrgencyNoteEnabled: false, specialistFields: [] });
      }
    });
    const loadOptions = () => void optionsQueue.refresh();
    void loadOptions();
    window.addEventListener('app-refresh', loadOptions);
    window.addEventListener('focus', loadOptions);
    return () => {
      optionsQueue.cancel();
      window.removeEventListener('app-refresh', loadOptions);
      window.removeEventListener('focus', loadOptions);
    };
  }, [schoolId]);

  // Form state has been extracted to SchoolRequestForm

  const loadRequests = useCallback(async (task: RefreshTask) => {
    if (!schoolId) return;
    try {
      const res = await fetch(`/api/requests?schoolId=${schoolId}&t=${Date.now()}`, {
        cache: 'no-store',
        signal: task.signal,
      });
      if (task.cancelled) return;
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (task.signal.aborted) return;
        const sorted = data.sort((a: RequestData, b: RequestData) => new Date(a.date).getTime() - new Date(b.date).getTime());
        setRequests(sorted);
        // Clear a previous error only once loading succeeded; otherwise it blinks on every retry.
        setRequestsError("");
      } else {
        setRequestsError("Die Bedarfe konnten gerade nicht geladen werden.");
      }
    } catch (error) {
      if (task.cancelled) return;
      console.error('Failed to fetch requests:', error);
      setRequestsError(task.timedOut
        ? "Das Laden dauert zu lange. Bitte prüfen Sie die Verbindung und versuchen Sie es erneut."
        : "Die Bedarfe konnten gerade nicht geladen werden. Prüfen Sie die Verbindung und versuchen Sie es erneut.");
    } finally {
      if (!task.cancelled) setLoading(false);
    }
  }, [schoolId]);
  const requestsQueue = useMemo(() => createRefreshQueue(loadRequests), [loadRequests]);
  const fetchRequests = requestsQueue.refresh;

  useEffect(() => {
    setLoading(true);
    setRequests([]);
    fetchRequests();

    const handleRefresh = () => fetchRequests();
    window.addEventListener('app-refresh', handleRefresh);
    return () => {
      window.removeEventListener('app-refresh', handleRefresh);
      requestsQueue.cancel();
    };
  }, [fetchRequests, requestsQueue]);

  // Das Schulprofil (Infos, Foto, Karten-Pin) und die Gefahrenzone (Daten löschen) leben
  // jetzt auf einer eigenen Vollformat-Seite unter /schule/profil – ein Dialog verdeckte
  // dafür den halben Bildschirm und die Karte war zu klein für einen genauen Pin.

  const [endingRequest, setEndingRequest] = useState<RequestData | null>(null);
  const handleEndRequest = useCallback((req: RequestData) => setEndingRequest(req), []);
  const handleCancel = useCallback((id: string) => {
    const request = requests.find(item => item.id === id);
    if (request) setEndingRequest(request);
  }, [requests]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">{user?.school?.name || "Unsere Schule"}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Unsere Bedarfe</h1>
          <p className="mt-1 text-sm text-muted-foreground">Offene Meldungen und zugewiesene Lehrkräfte im Blick.</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 md:w-auto">
        <Button className="w-full sm:w-auto" onClick={() => setRequestFormOpen(true)}><Plus className="size-4" />Bedarf melden</Button>
        <Link href="/schule/reserven" className={cn(buttonVariants({ variant: "outline" }), "min-h-11 gap-2")}>
          <UsersRound className="h-4 w-4" /> Unsere Mobilen Reserven
        </Link>
        <Link href="/schule/profil" className={cn(buttonVariants({ variant: "outline" }), "min-h-11 gap-2")}>
          <Building className="h-4 w-4" /> Schulprofil bearbeiten
        </Link>
        </div>
      </div>

      {user?.school && !hasSchoolProfile(user.school) && (
        <section aria-labelledby="school-profile-reminder" className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center">
          <Info className="hidden h-5 w-5 shrink-0 text-primary sm:block" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 id="school-profile-reminder" className="text-sm font-semibold">Ergänzen Sie Ihr Schulprofil</h2>
            <p className="mt-1 text-sm text-muted-foreground">Hinterlegen Sie Hinweise zur Anmeldung vor Ort und zu den Unterrichtszeiten. Mobile Reserven sehen diese Angaben bei ihren Einsätzen.</p>
          </div>
          <Link href="/schule/profil" className={buttonVariants({ variant: "outline", className: "w-full sm:w-auto" })}>
            Schulprofil ergänzen
          </Link>
        </section>
      )}

      {user?.role === 'SCHOOL' && <SchoolPushSettings key={user.id} userId={user.id} />}

      {requestsError && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
          <span>{requestsError}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void fetchRequests()}>Erneut laden</Button>
        </div>
      )}

      <SchoolRequestsList requests={requests} loading={loading} handleCancel={handleCancel} handleEndRequest={handleEndRequest} schoolOfficeMessagesEnabled={requestOptions?.schoolId === schoolId && requestOptions?.requestUrgencyNoteEnabled === true} onRequestsChanged={fetchRequests} hasSchoolLocations={(user?.school?.locations?.length ?? 0) > 0} />

      <Dialog open={requestFormOpen} onOpenChange={async open => {
        if (!open && requestFormSubmitting) return;
        if (!open && requestFormDirty && !await confirm({ title: 'Entwurf verwerfen?', description: 'Die Angaben für diesen Bedarf wurden noch nicht übermittelt.', confirmLabel: 'Entwurf verwerfen', variant: 'destructive' })) return;
        setRequestFormOpen(open);
      }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Bedarf melden</DialogTitle><DialogDescription>Geben Sie Einsatzort, Zeitraum und benötigte Unterrichtsstunden an.</DialogDescription></DialogHeader>
          <SchoolRequestForm user={user} fetchRequests={fetchRequests} onDirtyChange={setRequestFormDirty} onSubmittingChange={setRequestFormSubmitting} onSuccess={() => { setRequestFormDirty(false); setRequestFormOpen(false); }} embedded requestUrgencyNoteEnabled={requestOptions?.schoolId === schoolId && requestOptions?.requestUrgencyNoteEnabled === true} specialistFieldOptions={requestOptions && requestOptions.schoolId === schoolId ? requestOptions.specialistFields : undefined} />
        </DialogContent>
      </Dialog>

      {endingRequest && <RequestLifecycleDialog key={endingRequest.id} request={endingRequest} onClose={() => setEndingRequest(null)} onSaved={() => void fetchRequests()} />}
    </div>
  );
}
