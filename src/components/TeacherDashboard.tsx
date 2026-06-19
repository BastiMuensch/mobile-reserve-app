"use client";

import { useState, useMemo, useEffect } from "react";
import { useAuth } from "./AuthProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bell, BellRing, Calendar, Download, AlertTriangle, BookOpen, Share, PlusSquare, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AssignmentData } from "@/types/models";
import { getCurrentSchoolYear } from "@/lib/schoolYear";
import { TeacherAbsenceDialog } from "./teacher/dialogs/TeacherAbsenceDialog";
import { TeacherNextAssignment } from "./teacher/TeacherNextAssignment";

export function TeacherDashboard() {
  const { user } = useAuth();
  const [isAbsenceOpen, setIsAbsenceOpen] = useState(false);
  const [absenceDate, setAbsenceDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [absenceReason, setAbsenceReason] = useState("");
  const [isSubmittingAbsence, setIsSubmittingAbsence] = useState(false);

  const [allAssignments, setAllAssignments] = useState<AssignmentData[]>([]);
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(true);

  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  interface BeforeInstallPromptEvent extends Event {
    prompt: () => void;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const pushSupported = mounted && 'serviceWorker' in navigator && 'PushManager' in window;
  const isStandalone = mounted && (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as unknown as { standalone?: boolean }).standalone === true);
  
  let isIOS = false;
  if (mounted) {
    const ua = window.navigator.userAgent;
    const webkit = !!ua.match(/WebKit/i);
    const isIPad = !!ua.match(/iPad/i);
    const isIPhone = !!ua.match(/iPhone/i);
    const isIOSChrome = !!ua.match(/CriOS/i);
    isIOS = (isIPad || isIPhone) && webkit && !isIOSChrome;
  }

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

  // Separate effect for Push initialization to avoid cascading renders on mount
  useEffect(() => {
    if (mounted && pushSupported) {
      let isMounted = true;
      navigator.serviceWorker.ready.then(registration => {
        registration.pushManager.getSubscription().then(subscription => {
          if (isMounted) setPushEnabled(!!subscription);
        });
      });
      return () => { isMounted = false; };
    }
  }, [mounted, pushSupported]);

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
    setPushLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      
      if (!subscription) {
        // Fetch VAPID key
        const response = await fetch('/api/push/vapidPublicKey');
        const { publicKey } = await response.json();
        
        // Convert VAPID key
        const padding = '='.repeat((4 - publicKey.length % 4) % 4);
        const base64 = (publicKey + padding).replace(/\-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const applicationServerKey = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
          applicationServerKey[i] = rawData.charCodeAt(i);
        }

        // Subscribe
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey
        });
      }

      // Send to server
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
      });
      
      setPushEnabled(true);
      alert('Push-Benachrichtigungen erfolgreich aktiviert!');
    } catch {
      alert('Push-Abo fehlgeschlagen. Bitte prüfen Sie Ihre Browser-Einstellungen.');
    } finally {
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
      if (!res.ok) {
        const err = await res.json();
        alert(`Fehler: ${err.error}`);
        return;
      }
      setIsAbsenceOpen(false);
      setAbsenceReason("");
      alert("Ausfall wurde gemeldet. Betroffene Einsätze wurden zurückgesetzt.");
      window.dispatchEvent(new Event('app-refresh'));
    } catch {
      alert("Netzwerkfehler. Bitte versuchen Sie es erneut.");
    } finally {
      setIsSubmittingAbsence(false);
    }
  };

  const today = useMemo(() => new Date(new Date().setHours(0, 0, 0, 0)), []);

  const currentYear = getCurrentSchoolYear();
  const teacher = user?.teachers?.find(t => t.schoolYear === currentYear) || user?.teachers?.[0];

  useEffect(() => {
    const fetchAssignments = async () => {
      if (!teacher?.id) return;
      try {
        setIsLoadingAssignments(true);
        const res = await fetch(`/api/teachers/${teacher.id}/assignments`);
        if (res.ok) {
          const data = await res.json();
          setAllAssignments(data);
        }
      } catch (error) {
        console.error("Failed to fetch assignments:", error);
      } finally {
        setIsLoadingAssignments(false);
      }
    };

    fetchAssignments();

    const handleRefresh = () => fetchAssignments();
    window.addEventListener('app-refresh', handleRefresh);
    return () => window.removeEventListener('app-refresh', handleRefresh);
  }, [teacher?.id]);

  const upcoming = useMemo(() =>
    allAssignments
      .filter((a) => new Date(a.date) >= today)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [allAssignments, today]
  );
    
  const past = useMemo(() =>
    allAssignments
      .filter((a) => new Date(a.date) < today)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [allAssignments, today]
  );

  const nextAssignment = useMemo(() => upcoming.length > 0 ? upcoming[0] : null, [upcoming]);
  const otherUpcoming = useMemo(() => upcoming.slice(1), [upcoming]);

  if (!teacher) return <div className="p-8 text-center text-slate-500">Kein Lehrerprofil für das aktuelle Schuljahr ({currentYear}) gefunden. Bitte wenden Sie sich an Ihr Schulamt.</div>;
  
  if (teacher.status === 'PENDING') {
    return (
      <div className="flex justify-center items-center h-[60vh]">
        <Card className="max-w-md w-full shadow-lg border-t-4 border-t-amber-500">
          <CardHeader className="text-center">
            <div className="mx-auto bg-amber-100 text-amber-600 rounded-full p-4 w-16 h-16 flex items-center justify-center mb-4">
              <AlertTriangle className="h-8 w-8" />
            </div>
            <CardTitle className="text-2xl font-bold">Warten auf Freischaltung</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-slate-600">
              Hallo <strong>{teacher.name}</strong>,
            </p>
            <p className="text-slate-600">
              Ihr Profil wird aktuell noch von Ihrem zuständigen Schulamt geprüft. Dies dauert normalerweise nicht lange.
            </p>
            <p className="text-slate-600">
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
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white/50 dark:bg-slate-900/50 p-6 rounded-2xl border border-slate-200/60 dark:border-slate-800/60 backdrop-blur-md shadow-sm">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-orange-500">Lehrer-Dashboard</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg">Willkommen zurück, {teacher.name}. Hier ist Ihre Einsatzübersicht.</p>
        </div>
        <div className="flex flex-wrap gap-4 w-full md:w-auto mt-2 md:mt-0">
          {pushSupported && !pushEnabled && (
            <Button 
              variant="outline" 
              onClick={handlePushSubscribe}
              disabled={pushLoading}
              className="gap-2 shadow-sm border-blue-200 text-blue-700 hover:bg-blue-50 dark:border-blue-900 dark:text-blue-400 dark:hover:bg-blue-950/30"
            >
              <Bell className="h-4 w-4" /> 
              {pushLoading ? "Wird aktiviert..." : "Push aktivieren"}
            </Button>
          )}
          {pushSupported && pushEnabled && (
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-500 font-medium px-4 py-2 bg-green-50 dark:bg-green-950/30 rounded-md border border-green-200 dark:border-green-900/50">
              <BellRing className="h-4 w-4" /> Push aktiv
            </div>
          )}
          {deferredPrompt && !isStandalone && (
            <Button 
              variant="outline" 
              onClick={handleInstallClick}
              className="gap-2 shadow-sm border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-900 dark:text-indigo-400 dark:hover:bg-indigo-950/30"
            >
              <Download className="h-4 w-4" /> App installieren
            </Button>
          )}
          <Button 
            variant="destructive" 
            onClick={() => setIsAbsenceOpen(true)}
            className="gap-2 shadow-md bg-rose-600 hover:bg-rose-700 text-white"
          >
            <AlertTriangle className="h-4 w-4" /> Ungeplanten Ausfall melden
          </Button>
        </div>
      </div>

      {!isStandalone && isIOS && (
        <div className="bg-indigo-50/80 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50 p-4 rounded-xl flex flex-col md:flex-row items-center gap-4 text-indigo-800 dark:text-indigo-300 shadow-sm animate-in fade-in zoom-in duration-500">
          <div className="bg-indigo-100 dark:bg-indigo-900 p-3 rounded-full shrink-0">
            <Download className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="flex-1 text-sm leading-relaxed">
            <strong className="block mb-1 text-base">App installieren (iOS)</strong>
            Um MobileReserve.digital als echte App auf Ihrem iPhone oder iPad zu nutzen, tippen Sie unten in Safari auf das <Share className="h-4 w-4 inline-block mx-1" /> <strong>Teilen-Symbol</strong> und wählen Sie anschließend <PlusSquare className="h-4 w-4 inline-block mx-1" /> <strong>Zum Home-Bildschirm</strong>. So erhalten Sie Vollbild-Zugriff und Push-Benachrichtigungen.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* NEXT ASSIGNMENT */}
        <div className="lg:col-span-2 space-y-8">
          <Card className="shadow-xl border-t-4 border-t-orange-500 overflow-hidden">
            <CardHeader className="bg-orange-50/50 dark:bg-orange-950/20">
              <CardTitle className="text-2xl flex items-center gap-2 text-orange-800 dark:text-orange-400">
                <Calendar className="h-6 w-6" /> Nächster Einsatz
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {nextAssignment ? (
                <TeacherNextAssignment nextAssignment={nextAssignment} />
              ) : (
                <div className="text-center py-12 text-slate-500">
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
                    <div key={a.id} className="flex justify-between items-center p-4 border rounded-xl bg-slate-50 dark:bg-slate-900/50">
                      <div>
                        <div className="font-bold">{a.request?.school.name}</div>
                        <div className="text-sm text-slate-500">
                          {new Date(a.date).toLocaleDateString('de-DE')} • {a.hours} Stunden (ab {a.request?.startHour}. Std)
                          <br/>Vertretung für: {a.request?.substitutedTeacher || '-'}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {a.status === 'PENDING' ? (
                           <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded">Ausstehend</span>
                        ) : a.status === 'ACCEPTED' ? (
                           <span className="text-xs bg-orange-100 text-orange-800 px-2 py-1 rounded">Akzeptiert</span>
                        ) : (
                           <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded">Abgelehnt</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ARCHIVE */}
        <div className="lg:col-span-1">
          <Card className="h-full">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-xl flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-slate-500" />
                Archiv (Vergangene Einsätze)
              </CardTitle>
              {past.length > 0 && (
                <button
                  onClick={() => window.location.href = `/api/teachers/${teacher.id}/export`}
                  className="text-xs flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 px-3 py-1.5 rounded-md transition-colors text-slate-700 dark:text-slate-300"
                >
                  <FileDown className="h-3.5 w-3.5" /> Excel Export
                </button>
              )}
            </CardHeader>
            <CardContent>
              {past.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-sm">
                  Keine vergangenen Einsätze.
                </div>
              ) : (
                <div className="space-y-4">
                  {past.map((a) => (
                    <div key={a.id} className="p-4 border border-slate-100 dark:border-slate-800 border-l-4 border-l-orange-500 bg-slate-50 dark:bg-slate-900/50 rounded-r-xl flex items-center justify-between gap-3 shadow-xs hover:shadow-sm transition-all duration-300">
                      <div>
                        <div className="font-bold text-slate-850 dark:text-slate-200 text-sm">{a.request?.school.name}</div>
                      <div className="flex justify-between items-center text-xs text-slate-500 mt-1">
                        <span className="font-medium text-slate-600 dark:text-slate-400">{new Date(a.date).toLocaleDateString('de-DE')}</span>
                        <span className="bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded-full text-slate-700 dark:text-slate-300 font-semibold">{a.hours} Std (ab {a.request?.startHour}.)</span>
                        </div>
                      </div>
                      <button
                        onClick={() => window.open(`/api/assignments/${a.id}/pdf`, '_blank')}
                        className="p-2 bg-orange-50 hover:bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:hover:bg-orange-900/30 dark:text-orange-300 rounded-lg hover:scale-105 active:scale-95 transition-all duration-300 border border-orange-100 dark:border-orange-900/50 shrink-0"
                        title="Einsatznachweis (PDF) herunterladen"
                      >
                        <FileDown className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
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
    </div>
  );
}
