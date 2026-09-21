"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useAuth } from "./AuthProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bell, BellRing, Calendar, Download, AlertTriangle, Share, PlusSquare, CalendarOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AssignmentData } from "@/types/models";
import { getCurrentSchoolYear } from "@/lib/schoolYear";
import { TeacherAbsenceDialog } from "./teacher/dialogs/TeacherAbsenceDialog";
import { TeacherLeaveDialog } from "./teacher/dialogs/TeacherLeaveDialog";
import { AssignmentConfirmation, TeacherNextAssignment } from "./teacher/TeacherNextAssignment";
import { TeacherDocuments } from "./teacher/TeacherDocuments";
import { useToast } from "@/components/ui/toast";

import { toLocalDateInputValue } from "@/lib/dateKey";
import { handleUnauthorized } from "@/lib/authClient";
import { isAppleMobileDevice, isPushRegistered, readyPushRegistration, registerDevicePush } from "@/lib/pushClient";

export function TeacherDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isAbsenceOpen, setIsAbsenceOpen] = useState(false);
  const [isLeaveOpen, setIsLeaveOpen] = useState(false);
  const [absenceDate, setAbsenceDate] = useState(() => toLocalDateInputValue());
  const [absenceReason, setAbsenceReason] = useState("");
  const [isSubmittingAbsence, setIsSubmittingAbsence] = useState(false);

  const [allAssignments, setAllAssignments] = useState<AssignmentData[]>([]);
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(true);
  const [assignmentsError, setAssignmentsError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [isRefreshingAssignments, setIsRefreshingAssignments] = useState(false);
  const assignmentsControllerRef = useRef<AbortController | null>(null);

  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushChecking, setPushChecking] = useState(false);
  const [pushStatusError, setPushStatusError] = useState("");
  const pushBusyRef = useRef(false);

  interface BeforeInstallPromptEvent extends Event {
    prompt: () => void;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isStandalone = mounted && (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as unknown as { standalone?: boolean }).standalone === true);
  const isIOS = mounted && isAppleMobileDevice(navigator.userAgent, navigator.maxTouchPoints);
  const pushSupported = mounted && window.isSecureContext && 'serviceWorker' in navigator &&
    'PushManager' in window && 'Notification' in window && (!isIOS || isStandalone);

  useEffect(() => {
    if (!mounted) return;
    
    // Intercept automatic install prompt for Android/Desktop
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, [mounted]);

  useEffect(() => {
    if (!pushSupported || !user?.id) return;
    let disposed = false;
    let checking = false;
    async function checkPush() {
      if (checking || pushBusyRef.current || document.visibilityState === 'hidden') return;
      checking = true;
      setPushChecking(true);
      setPushEnabled(false);
      setPushStatusError("");
      try {
        const registration = await readyPushRegistration(navigator.serviceWorker);
        const subscription = await registration.pushManager.getSubscription();
        const enabled = Notification.permission === 'granted' && await isPushRegistered(subscription);
        if (!disposed) setPushEnabled(enabled);
      } catch {
        if (!disposed) setPushStatusError('Push-Status konnte nicht bestätigt werden. Bitte prüfen Sie Ihre Verbindung und aktivieren Sie Push erneut.');
      } finally {
        checking = false;
        if (!disposed) setPushChecking(false);
      }
    }
    void checkPush();
    window.addEventListener('focus', checkPush);
    document.addEventListener('visibilitychange', checkPush);
    return () => {
      disposed = true;
      window.removeEventListener('focus', checkPush);
      document.removeEventListener('visibilitychange', checkPush);
    };
  }, [pushSupported, user?.id]);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    }
  };

  const handlePushSubscribe = async () => {
    if (!pushSupported || pushBusyRef.current || pushChecking) return;
    pushBusyRef.current = true;
    setPushLoading(true);
    setPushEnabled(false);
    setPushStatusError("");
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'denied') {
        toast({
          variant: "error",
          title: "Benachrichtigungen sind blockiert.",
          description: "Bitte erlauben Sie Mitteilungen für diese App in den Geräte- bzw. Browser-Einstellungen. Öffnen Sie die App danach erneut und tippen Sie auf „Push aktivieren“."
        });
        return;
      }
      if (permission !== 'granted') {
        toast({ variant: "error", title: "Push-Abo fehlgeschlagen.", description: "Berechtigung wurde nicht erteilt." });
        return;
      }

      const registration = await readyPushRegistration(navigator.serviceWorker);
      const { warning } = await registerDevicePush(registration);
      setPushEnabled(true);
      toast({
        variant: warning ? "info" : "success",
        title: warning ? "Push-Abo gespeichert – Testnachricht fehlgeschlagen" : "Push-Benachrichtigungen erfolgreich aktiviert!",
        description: warning,
      });
    } catch (error) {
      console.error('Push subscription failed:', error);
      toast({ variant: "error", title: "Push-Abo fehlgeschlagen.", description: error instanceof Error ? error.message : "Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut." });
    } finally {
      pushBusyRef.current = false;
      setPushLoading(false);
    }
  };

  const handleReportAbsence = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingAbsence(true);
    try {
      const res = await fetch('/api/teachers/absence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: absenceDate, reason: absenceReason })
      });
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      if (!res.ok) {
        const err = await res.json();
        toast({ variant: "error", title: "Fehler beim Melden des Ausfalls.", description: err.error });
        return;
      }
      setIsAbsenceOpen(false);
      setAbsenceReason("");
      const body = await res.json();
      toast({
        variant: body.notificationWarning ? "info" : "success",
        title: body.notificationWarning ? "Ausfall wurde gemeldet – Benachrichtigung prüfen" : "Ausfall wurde gemeldet.",
        description: body.notificationWarnings?.join(" ") || "Betroffene Einsätze wurden zurückgesetzt.",
      });
      window.dispatchEvent(new Event('app-refresh'));
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler.", description: "Bitte versuchen Sie es erneut." });
    } finally {
      setIsSubmittingAbsence(false);
    }
  };

  const today = useMemo(() => new Date(new Date().setHours(0, 0, 0, 0)), []);

  const currentYear = getCurrentSchoolYear();
  const teacher = user?.teachers?.find(t => t.schoolYear === currentYear) || user?.teachers?.[0];
  const teacherId = teacher?.id;

  const fetchAssignments = useCallback(async ({ initial = false }: { initial?: boolean } = {}) => {
    if (!teacherId) return;
    assignmentsControllerRef.current?.abort();
    const controller = new AbortController();
    assignmentsControllerRef.current = controller;
    try {
      if (initial) setIsLoadingAssignments(true);
      else setIsRefreshingAssignments(true);
      setAssignmentsError("");
      const res = await fetch(`/api/teachers/${teacherId}/assignments`, { signal: controller.signal });
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setAllAssignments(data);
        setLastUpdatedAt(new Date());
      } else {
        setAssignmentsError("Ihre Einsätze konnten gerade nicht geladen werden.");
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error("Failed to fetch assignments:", error);
      setAssignmentsError("Ihre Einsätze konnten gerade nicht geladen werden. Prüfen Sie die Verbindung und versuchen Sie es erneut.");
    } finally {
      if (assignmentsControllerRef.current === controller) {
        if (initial) setIsLoadingAssignments(false);
        else setIsRefreshingAssignments(false);
      }
    }
  }, [teacherId]);

  useEffect(() => {

    void fetchAssignments({ initial: true });

    const handleRefresh = () => void fetchAssignments();
    window.addEventListener('app-refresh', handleRefresh);
    return () => {
      window.removeEventListener('app-refresh', handleRefresh);
      assignmentsControllerRef.current?.abort();
    };
  }, [fetchAssignments]);

  const upcoming = useMemo(() =>
    allAssignments
      .filter((a) => new Date(a.date) >= today && a.status !== "REJECTED")
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [allAssignments, today]
  );
    
  const nextAssignment = useMemo(() => upcoming.length > 0 ? upcoming[0] : null, [upcoming]);
  const otherUpcoming = useMemo(() => upcoming.slice(1), [upcoming]);

  if (!teacher) return <div className="p-8 text-center text-muted-foreground">Kein Lehrerprofil für das aktuelle Schuljahr ({currentYear}) gefunden. Bitte wenden Sie sich an Ihr Schulamt.</div>;

  if (teacher.status === 'PENDING') {
    return (
      <div className="flex justify-center items-center h-[60vh]">
        <Card className="max-w-md w-full border border-border bg-card">
          <CardHeader className="text-center">
            <div className="mx-auto bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400 rounded-full p-4 w-16 h-16 flex items-center justify-center mb-4">
              <AlertTriangle className="h-8 w-8" />
            </div>
            <CardTitle className="text-2xl font-bold">Warten auf Freischaltung</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-muted-foreground">
              Hallo <strong>{teacher.name}</strong>,
            </p>
            <p className="text-muted-foreground">
              Ihr Profil wird aktuell noch von Ihrem zuständigen Schulamt geprüft. Dies dauert normalerweise nicht lange.
            </p>
            <p className="text-muted-foreground">
              Sobald Sie freigeschaltet wurden, erhalten Sie hier vollen Zugriff auf Ihre Einsätze.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }
  if (isLoadingAssignments) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" role="status" aria-label="Einsätze werden geladen"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 rounded-2xl border border-border bg-card p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Mein Einsatzplan</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Hallo, {teacher.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Bestätigen Sie zuerst Ihren nächsten Einsatz oder melden Sie eine Änderung.</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap md:w-auto md:justify-end">
          {pushSupported && !pushEnabled && (
            <Button
              variant="outline"
              onClick={handlePushSubscribe}
              disabled={pushLoading || pushChecking}
              className="min-h-10 gap-2 border-primary/20 text-primary hover:bg-primary/10 dark:border-primary/40 dark:hover:bg-primary/20"
            >
              <Bell className="h-4 w-4" />
              {pushLoading ? "Wird aktiviert..." : pushChecking ? "Push wird geprüft..." : "Push aktivieren"}
            </Button>
          )}
          {pushSupported && pushEnabled && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="flex min-h-10 items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm font-medium text-green-600 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-500">
                <BellRing className="h-4 w-4" /> Push aktiv
              </span>
              <Button variant="outline" onClick={handlePushSubscribe} disabled={pushLoading || pushChecking}>Testnachricht senden</Button>
            </div>
          )}
          {deferredPrompt && !isStandalone && (
            <Button
              variant="outline"
              onClick={handleInstallClick}
              className="min-h-10 gap-2 border-primary/20 text-primary hover:bg-primary/10 dark:border-primary/40 dark:hover:bg-primary/20"
            >
              <Download className="h-4 w-4" /> App installieren
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => setIsLeaveOpen(true)}
            className="min-h-10 h-auto max-w-full whitespace-normal gap-2 border-amber-500/30 text-amber-700 hover:bg-amber-500/10 dark:border-amber-500/40 dark:text-amber-400"
          >
            <CalendarOff className="h-4 w-4" /> Längere Abwesenheit melden
          </Button>
          <Button
            variant="destructive"
            onClick={() => setIsAbsenceOpen(true)}
            className="min-h-10 h-auto max-w-full whitespace-normal gap-2 bg-rose-600 text-white hover:bg-rose-700"
          >
            <AlertTriangle className="h-4 w-4" /> Ungeplanten Ausfall melden
          </Button>
        </div>
      </div>

      {pushStatusError && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{pushStatusError}</p>}
      {mounted && isStandalone && !pushSupported && (
        <p role="status" className="text-sm text-muted-foreground">Push ist hier nicht verfügbar. Auf iPhone und iPad benötigen Sie mindestens iOS/iPadOS 16.4. Öffnen Sie die App über den Home-Bildschirm und verwenden Sie eine sichere HTTPS-Verbindung.</p>
      )}

      {assignmentsError && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
          <span>{assignmentsError}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void fetchAssignments()}>Erneut laden</Button>
        </div>
      )}

      {!isStandalone && isIOS && (
        <div className="flex flex-col items-start gap-4 rounded-xl border border-primary/20 bg-primary/5 p-4 text-primary md:flex-row md:items-center">
          <div className="shrink-0 rounded-full bg-primary/10 p-3">
            <Download className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1 text-sm leading-relaxed">
            <strong className="block mb-1 text-base">App installieren (iOS)</strong>
            Für Push benötigen Sie mindestens iOS/iPadOS 16.4. Öffnen Sie diese Seite in Safari, tippen Sie im Menü auf <Share className="h-4 w-4 inline-block mx-1" /> <strong>Teilen</strong> und dann auf <PlusSquare className="h-4 w-4 inline-block mx-1" /> <strong>Zum Home-Bildschirm</strong>. Öffnen Sie anschließend die App über das neue Symbol, melden Sie sich an und tippen Sie auf <strong>Push aktivieren</strong>. Erlauben Sie danach die Mitteilungen. Die Installation allein aktiviert Push noch nicht.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* NEXT ASSIGNMENT */}
        <div className="lg:col-span-2 space-y-8">
          <Card className="overflow-hidden border border-border bg-card">
            <CardHeader className="bg-primary/5">
              <div className="flex flex-wrap items-center justify-between gap-3"><CardTitle className="flex items-center gap-2 text-xl text-foreground"><Calendar className="h-5 w-5 shrink-0 text-primary" /> Nächster Einsatz</CardTitle><div className="flex items-center gap-2 text-xs text-muted-foreground"><span>{lastUpdatedAt ? `Stand ${lastUpdatedAt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}` : "Noch nicht aktualisiert"}</span><Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => void fetchAssignments()} aria-label="Einsätze aktualisieren" title="Einsätze aktualisieren"><RefreshCw className={`h-4 w-4 ${isRefreshingAssignments ? "animate-spin" : ""}`} /></Button></div></div>
            </CardHeader>
            <CardContent className="p-6">
              {nextAssignment ? (
                <TeacherNextAssignment nextAssignment={nextAssignment} />
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  Kein bevorstehender Einsatz geplant.
                </div>
              )}
            </CardContent>
          </Card>

          {/* OTHER UPCOMING */}
          {otherUpcoming.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Weitere anstehende Einsätze</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {otherUpcoming.map((a) => (
                    <div key={a.id} className="flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="font-bold">{a.request?.school.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {new Date(a.date).toLocaleDateString('de-DE')} • {a.hours} Stunden (ab {a.request?.startHour}. Std)
                          <br/>Vertretung für: {a.request?.substitutedTeacher || '-'}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        {a.status === 'PENDING' ? (
                           <AssignmentConfirmation assignmentId={a.id} compact />
                        ) : a.status === 'ACCEPTED' ? (
                           <span className="text-xs bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 px-2 py-1 rounded">Bestätigt</span>
                        ) : (
                           <span className="text-xs bg-red-100 dark:bg-red-500/15 text-red-800 dark:text-red-300 px-2 py-1 rounded">Storniert (Ausfall)</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="min-w-0 lg:col-span-1">
          <TeacherDocuments key={teacher.id} teacherId={teacher.id} schoolYear={teacher.schoolYear} assignments={allAssignments} loadError={assignmentsError} />
        </div>
      </div>

      <TeacherAbsenceDialog
        isOpen={isAbsenceOpen}
        setIsOpen={setIsAbsenceOpen}
        absenceDate={absenceDate}
        setAbsenceDate={setAbsenceDate}
        absenceReason={absenceReason}
        setAbsenceReason={setAbsenceReason}
        handleReportAbsence={handleReportAbsence}
        isSubmittingAbsence={isSubmittingAbsence}
      />

      <TeacherLeaveDialog
        isOpen={isLeaveOpen}
        setIsOpen={setIsLeaveOpen}
        onChanged={() => window.dispatchEvent(new Event('app-refresh'))}
      />
    </div>
  );
}
