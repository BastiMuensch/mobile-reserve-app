"use client";

import { useAuth } from "./AuthProvider";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { RequestData } from "@/types/models";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Building } from "lucide-react";
import { cn } from "@/lib/utils";
import { SchoolRequestForm } from "./school/SchoolRequestForm";
import { SchoolRequestsList } from "./school/SchoolRequestsList";
import { useToast } from "@/components/ui/toast";
import { toLocalDateInputValue } from "@/lib/dateKey";
import { handleUnauthorized } from "@/lib/authClient";

export function SchoolDashboard() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<RequestData[]>([]);
  const [loading, setLoading] = useState(true);
  const [requestsError, setRequestsError] = useState("");
  const { toast } = useToast();
  const requestsControllerRef = useRef<AbortController | null>(null);
  const schoolId = user?.schoolId;

  // Form state has been extracted to SchoolRequestForm

  const fetchRequests = useCallback(async () => {
    if (!schoolId) return;
    requestsControllerRef.current?.abort();
    const controller = new AbortController();
    requestsControllerRef.current = controller;
    try {
      setRequestsError("");
      const res = await fetch(`/api/requests?schoolId=${schoolId}&t=${Date.now()}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        const sorted = data.sort((a: RequestData, b: RequestData) => new Date(a.date).getTime() - new Date(b.date).getTime());
        setRequests(sorted);
      } else {
        setRequestsError("Die Bedarfe konnten gerade nicht geladen werden.");
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error('Failed to fetch requests:', error);
      setRequestsError("Die Bedarfe konnten gerade nicht geladen werden. Prüfen Sie die Verbindung und versuchen Sie es erneut.");
    } finally {
      if (requestsControllerRef.current === controller) setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    fetchRequests();

    const handleRefresh = () => fetchRequests();
    window.addEventListener('app-refresh', handleRefresh);
    return () => {
      window.removeEventListener('app-refresh', handleRefresh);
      requestsControllerRef.current?.abort();
    };
  }, [fetchRequests]);

  // Das Schulprofil (Infos, Foto, Karten-Pin) und die Gefahrenzone (Daten löschen) leben
  // jetzt auf einer eigenen Vollformat-Seite unter /schule/profil – ein Dialog verdeckte
  // dafür den halben Bildschirm und die Karte war zu klein für einen genauen Pin.

  const handleCancel = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/requests/${id}`, { method: "DELETE" });
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      if (!res.ok) {
        const err = await res.json();
        toast({ variant: "error", title: err.error || "Anfrage konnte nicht gelöscht werden." });
        return;
      }
      fetchRequests();
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler beim Löschen." });
    }
  }, [fetchRequests, toast]);

  // Rückkehr melden für eine offene Anfrage (bis auf Weiteres): Der Bestätigungs-Dialog
  // (useConfirm) kennt kein Datumsfeld, daher hier ein eigener kleiner Dialog mit dem
  // letzten Tag der Vertretung. Serverseitig storniert das die Zuweisungen danach.
  const [endingRequest, setEndingRequest] = useState<RequestData | null>(null);
  const [lastDay, setLastDay] = useState("");
  const [isEndingRequest, setIsEndingRequest] = useState(false);

  const maxLastDay = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return toLocalDateInputValue(d);
  }, []);

  const handleEndRequest = useCallback((req: RequestData) => {
    setEndingRequest(req);
    setLastDay(toLocalDateInputValue());
  }, []);

  const confirmEndRequest = async () => {
    if (!endingRequest || !lastDay) return;
    setIsEndingRequest(true);
    try {
      const res = await fetch(`/api/requests/${endingRequest.id}/end`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lastDay }),
      });
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      const body = await res.json();
      if (!res.ok) {
        toast({ variant: "error", title: body.error || "Die Rückkehr konnte nicht gemeldet werden." });
        return;
      }
      toast({
        variant: body.notificationWarning ? "info" : "success",
        title: body.notificationWarning ? "Rückkehr gemeldet – Benachrichtigungen prüfen" : "Rückkehr gemeldet",
        description: body.notificationWarnings?.join(" ") || (body.cancelledAssignments > 0
          ? `${body.cancelledAssignments} geplante Einsätze nach dem letzten Tag wurden storniert und die Lehrkräfte informiert.`
          : "Es lagen keine geplanten Einsätze nach dem letzten Tag vor."),
      });
      setEndingRequest(null);
      fetchRequests();
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler beim Melden der Rückkehr." });
    } finally {
      setIsEndingRequest(false);
    }
  };





  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-card md:flex-row md:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Heute organisieren</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Schul-Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Neuen Bedarf melden und laufende Vertretungen im Blick behalten.</p>
        </div>
        <Link href="/schule/profil" className={cn(buttonVariants(), "min-h-10 gap-2 bg-foreground text-background hover:bg-foreground/90")}>
          <Building className="h-4 w-4" /> Schulprofil bearbeiten
        </Link>
      </div>

      {requestsError && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
          <span>{requestsError}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void fetchRequests()}>Erneut laden</Button>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3 lg:gap-8">
        
        {/* REQUEST FORM */}
        <div className="min-w-0 lg:col-span-1">
          <SchoolRequestForm user={user} fetchRequests={fetchRequests} />
        </div>

        {/* REQUESTS LIST */}
        <div className="min-w-0 lg:col-span-2">
          <SchoolRequestsList requests={requests} loading={loading} handleCancel={handleCancel} handleEndRequest={handleEndRequest} />
        </div>

      </div>

      <Dialog open={endingRequest !== null} onOpenChange={(open) => { if (!open) setEndingRequest(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rückkehr melden</DialogTitle>
            <DialogDescription>
              Letzter Tag der Vertretung für {endingRequest?.substitutedTeacher || 'diese Anfrage'}. Geplante Einsätze
              nach diesem Tag werden storniert und die betroffenen Lehrkräfte informiert.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="lastDay">Letzter Tag</Label>
            {/* Ein Datumsfeld verlangt YYYY-MM-DD als min/max; ein voller ISO-Zeitstempel
                wird stillschweigend ignoriert, die Untergrenze wirkte dann gar nicht. */}
            <Input
              id="lastDay"
              type="date"
              value={lastDay}
              min={endingRequest ? toLocalDateInputValue(new Date(endingRequest.date)) : undefined}
              max={maxLastDay}
              onChange={e => setLastDay(e.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEndingRequest(null)}>
              Abbrechen
            </Button>
            <Button type="button" onClick={confirmEndRequest} disabled={isEndingRequest || !lastDay}>
              {isEndingRequest ? "Wird gespeichert…" : "Rückkehr melden"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
