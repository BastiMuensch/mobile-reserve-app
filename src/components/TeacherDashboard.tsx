"use client";

import { useState, useMemo, useEffect } from "react";
import { useAuth } from "./AuthProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Image from "next/image";
import { MapPin, Calendar, Clock, BookOpen, MessageSquare, Info, FileDown, AlertTriangle, Bell, BellRing, Download, Share, PlusSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { AssignmentMapWrapper } from "./AssignmentMapWrapper";
import { getCurrentSchoolYear } from "@/lib/schoolYear";

type AssignmentData = { id: string; date: string; hours: number; status: string; request: { startHour: number; substitutedTeacher: string; schoolType: string; comments?: string; school: { name: string; address: string; generalInfo?: string; imageUrl?: string; latitude: number; longitude: number; pinLat?: number; pinLng?: number; } } };

export function TeacherDashboard() {
  const { user } = useAuth();
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isAbsenceOpen, setIsAbsenceOpen] = useState(false);
  const [absenceDate, setAbsenceDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [absenceReason, setAbsenceReason] = useState("");
  const [isSubmittingAbsence, setIsSubmittingAbsence] = useState(false);

  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        setPushSupported(true);
        navigator.serviceWorker.ready.then(registration => {
          registration.pushManager.getSubscription().then(subscription => {
            setPushEnabled(!!subscription);
          });
        });
      }

      // Check if already installed
      if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true) {
        setIsStandalone(true);
      }

      // iOS Detection for manual install guide
      const ua = window.navigator.userAgent;
      const webkit = !!ua.match(/WebKit/i);
      const isIPad = !!ua.match(/iPad/i);
      const isIPhone = !!ua.match(/iPhone/i);
      const isIOSChrome = !!ua.match(/CriOS/i);
      if ((isIPad || isIPhone) && webkit && !isIOSChrome) {
        setIsIOS(true);
      }

      // Intercept automatic install prompt for Android/Desktop
      const handleBeforeInstallPrompt = (e: any) => {
        e.preventDefault();
        setDeferredPrompt(e);
      };
      window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      
      return () => {
        window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      };
    }
  }, []);

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
    } catch (error) {
      console.error('Push subscription failed:', error);
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
    } catch (error) {
      alert("Netzwerkfehler. Bitte versuchen Sie es erneut.");
    } finally {
      setIsSubmittingAbsence(false);
    }
  };

  const today = useMemo(() => new Date(new Date().setHours(0, 0, 0, 0)), []);

  const currentYear = getCurrentSchoolYear();
  const teacher = user?.teachers?.find(t => t.schoolYear === currentYear) || user?.teachers?.[0];

  // Separate upcoming and past assignments
  const allAssignments = useMemo(() => teacher?.assignments || [], [teacher]);
  
  const upcoming = useMemo(() =>
    (allAssignments as AssignmentData[])
      .filter((a) => new Date(a.date) >= today)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [allAssignments, today]
  );
    
  const past = useMemo(() =>
    (allAssignments as AssignmentData[])
      .filter((a) => new Date(a.date) < today)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [allAssignments, today]
  );

  const nextAssignment = useMemo(() => upcoming.length > 0 ? upcoming[0] : null, [upcoming]);
  const otherUpcoming = useMemo(() => upcoming.slice(1), [upcoming]);

  if (!teacher) return <div className="p-8 text-center text-slate-500">Kein Lehrerprofil für das aktuelle Schuljahr ({currentYear}) gefunden. Bitte wenden Sie sich an Ihr Schulamt.</div>;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex justify-between items-center bg-white/50 dark:bg-slate-900/50 p-6 rounded-2xl border border-slate-200/60 dark:border-slate-800/60 backdrop-blur-md shadow-sm">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-orange-500">Lehrer-Dashboard</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg">Willkommen zurück, {teacher.name}. Hier ist Ihre Einsatzübersicht.</p>
        </div>
        <div className="flex gap-4">
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
            Um Mobile.Digital als echte App auf Ihrem iPhone oder iPad zu nutzen, tippen Sie unten in Safari auf das <Share className="h-4 w-4 inline-block mx-1" /> <strong>Teilen-Symbol</strong> und wählen Sie anschließend <PlusSquare className="h-4 w-4 inline-block mx-1" /> <strong>Zum Home-Bildschirm</strong>. So erhalten Sie Vollbild-Zugriff und Push-Benachrichtigungen.
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
                <div className="space-y-6">
                  <div className="flex justify-between items-start">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{nextAssignment.request.school.name}</h2>
                      <p className="text-slate-500 flex items-center gap-1 mt-1">
                        <MapPin className="h-4 w-4" /> {nextAssignment.request.school.address}
                      </p>
                    </div>
                    <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-200 text-sm py-1">
                      {new Date(nextAssignment.date).toLocaleDateString('de-DE')}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                      <div className="text-slate-500 text-xs font-semibold mb-1 uppercase">Stunden</div>
                      <div className="font-bold text-lg flex items-center gap-2"><Clock className="h-4 w-4 text-orange-500"/> {nextAssignment.hours} Std.</div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                      <div className="text-slate-500 text-xs font-semibold mb-1 uppercase">Ab Stunde</div>
                      <div className="font-bold text-lg flex items-center gap-2"><Clock className="h-4 w-4 text-orange-500"/> {nextAssignment.request.startHour}. Std</div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                      <div className="text-slate-500 text-xs font-semibold mb-1 uppercase">Klasse / Schulart</div>
                      <div className="font-bold text-lg flex items-center gap-2"><BookOpen className="h-4 w-4 text-orange-500"/> {nextAssignment.request.schoolType === 'GRUNDSCHULE' ? 'GS' : nextAssignment.request.schoolType === 'MITTELSCHULE' ? 'MS' : 'GS/MS'}</div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                      <div className="text-slate-500 text-xs font-semibold mb-1 uppercase">Vertretung für</div>
                      <div className="font-bold text-sm flex items-center gap-2">{nextAssignment.request.substitutedTeacher || '-'}</div>
                    </div>
                  </div>

                  {nextAssignment.status === 'PENDING' && (
                    <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-xl border border-amber-200 dark:border-amber-800/30">
                      <h3 className="text-amber-800 dark:text-amber-400 font-bold mb-2">Bitte bestätigen Sie diesen Einsatz</h3>
                      <div className="flex gap-4">
                        <button 
                          disabled={isUpdatingStatus}
                          onClick={async () => {
                            if (isUpdatingStatus) return;
                            setIsUpdatingStatus(true);
                            try {
                              const res = await fetch(`/api/assignments/${nextAssignment.id}/status`, {
                                method: 'PATCH', body: JSON.stringify({status: 'ACCEPTED'}), headers: {'Content-Type': 'application/json'}
                              });
                              if (!res.ok) {
                                const err = await res.json();
                                alert(`Fehler: ${err.error || 'Einsatz konnte nicht akzeptiert werden'}`);
                                return;
                              }
                              window.dispatchEvent(new Event('app-refresh'));
                            } catch (error) {
                              alert('Netzwerkfehler. Bitte versuchen Sie es erneut.');
                            } finally {
                              setIsUpdatingStatus(false);
                            }
                          }}
                          className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-md font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isUpdatingStatus ? 'Wird verarbeitet...' : 'Einsatz akzeptieren'}
                        </button>
                        <button 
                          disabled={isUpdatingStatus}
                          onClick={async () => {
                            if (isUpdatingStatus) return;
                            if(confirm("Diesen Einsatz wirklich ablehnen?")) {
                              setIsUpdatingStatus(true);
                              try {
                                const res = await fetch(`/api/assignments/${nextAssignment.id}/status`, {
                                  method: 'PATCH', body: JSON.stringify({status: 'REJECTED'}), headers: {'Content-Type': 'application/json'}
                                });
                                if (!res.ok) {
                                  const err = await res.json();
                                  alert(`Fehler: ${err.error || 'Einsatz konnte nicht abgelehnt werden'}`);
                                  return;
                                }
                                window.dispatchEvent(new Event('app-refresh'));
                              } catch (error) {
                                alert('Netzwerkfehler. Bitte versuchen Sie es erneut.');
                              } finally {
                                setIsUpdatingStatus(false);
                              }
                            }
                          }}
                          className="bg-slate-200 hover:bg-slate-300 text-slate-800 px-4 py-2 rounded-md font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Ablehnen
                        </button>
                      </div>
                    </div>
                  )}

                  {/* School Info & Comments */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-100 dark:border-slate-800">
                    <div className="space-y-4">
                      {nextAssignment.request.comments && (
                        <div>
                          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2 mb-2">
                            <MessageSquare className="h-4 w-4 text-blue-500" /> Hinweise zum Einsatz (Startzeit/Parken)
                          </h3>
                          <div className="bg-blue-50 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 p-4 rounded-xl text-sm leading-relaxed whitespace-pre-wrap">
                            {nextAssignment.request.comments}
                          </div>
                        </div>
                      )}
                      {nextAssignment.request.school.generalInfo && (
                        <details className="group bg-amber-50 dark:bg-amber-900/30 rounded-xl overflow-hidden border border-amber-100 dark:border-amber-800/50">
                          <summary className="cursor-pointer select-none p-4 flex items-center justify-between text-amber-800 dark:text-amber-300 font-bold text-sm hover:bg-amber-100 dark:hover:bg-amber-800/50 transition-colors">
                            <span className="flex items-center gap-2">
                              <Info className="h-4 w-4" /> Allgemeine Schulinformationen
                            </span>
                            <span className="text-amber-500 group-open:rotate-180 transition-transform">▼</span>
                          </summary>
                          <div className="p-4 pt-0 text-amber-900 dark:text-amber-200 text-sm leading-relaxed whitespace-pre-wrap">
                            <div className="h-px w-full bg-amber-200 dark:bg-amber-800/50 mb-4"></div>
                            {nextAssignment.request.school.generalInfo}
                          </div>
                        </details>
                      )}
                    </div>
                    
                    <div>
                      {nextAssignment.request.school.imageUrl && (
                        <div className="rounded-xl overflow-hidden shadow-sm border border-slate-200 dark:border-slate-800 mb-4">
                          <Image src={nextAssignment.request.school.imageUrl} alt="Schule" width={500} height={128} className="w-full h-32 object-cover" unoptimized />
                        </div>
                      )}
                      <AssignmentMapWrapper school={nextAssignment.request.school} />
                    </div>
                  </div>
                </div>
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
                        <div className="font-bold">{a.request.school.name}</div>
                        <div className="text-sm text-slate-500">
                          {new Date(a.date).toLocaleDateString('de-DE')} • {a.hours} Stunden (ab {a.request.startHour}. Std)
                          <br/>Vertretung für: {a.request.substitutedTeacher || '-'}
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
                        <div className="font-bold text-slate-850 dark:text-slate-200 text-sm">{a.request.school.name}</div>
                        <div className="flex gap-4 text-xs text-slate-500 mt-1">
                          <span>📅 {new Date(a.date).toLocaleDateString('de-DE')}</span>
                          <span>⏰ {a.hours} Std.</span>
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

      <Dialog open={isAbsenceOpen} onOpenChange={setIsAbsenceOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-rose-600 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" /> Ungeplanten Ausfall melden
            </DialogTitle>
            <DialogDescription>
              Melden Sie hier einen ungeplanten Ausfall. Eventuelle Einsätze an diesem Tag werden automatisch an das Schulamt zurückgegeben.
            </DialogDescription>
          </DialogHeader>
          
          <div className="bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300 p-4 rounded-xl text-sm border border-rose-200 dark:border-rose-900/50 mb-4 font-medium">
            <strong>ACHTUNG:</strong> Bitte melden Sie sich trotz dieser System-Meldung weiterhin offiziell telefonisch bei Ihrer Stammschule ab!
          </div>

          <form onSubmit={handleReportAbsence} className="space-y-4">
            <div className="space-y-2">
              <Label>Datum des Ausfalls</Label>
              <Input 
                type="date" 
                value={absenceDate} 
                onChange={e => setAbsenceDate(e.target.value)} 
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Begründung</Label>
              <Textarea 
                placeholder="Bitte geben Sie den Grund für Ihren Ausfall an."
                value={absenceReason} 
                onChange={e => setAbsenceReason(e.target.value)} 
                required
                minLength={5}
                className="h-24"
              />
            </div>
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setIsAbsenceOpen(false)}>Abbrechen</Button>
              <Button type="submit" disabled={isSubmittingAbsence} className="bg-rose-600 hover:bg-rose-700 text-white">
                {isSubmittingAbsence ? "Wird gemeldet..." : "Ausfall melden"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
