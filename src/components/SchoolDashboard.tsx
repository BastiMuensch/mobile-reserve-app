"use client";

import { useAuth } from "./AuthProvider";
import { useState, useEffect, useMemo, useCallback } from "react";
import { RequestData } from "@/types/models";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { PlusCircle, Calendar, Clock, Trash2, MessageSquare, AlertCircle, HeartPulse, GraduationCap, Building, MapPin, AlertTriangle } from "lucide-react";
import Image from "next/image";
import dynamic from 'next/dynamic';

const LocationPickerMap = dynamic(() => import('./LocationPickerMap'), {
  ssr: false,
  loading: () => <div className="h-[250px] w-full bg-slate-100 dark:bg-slate-800 animate-pulse rounded-md mt-2 flex items-center justify-center text-slate-500">Lade Karte...</div>
});

export function SchoolDashboard() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Form State
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState("");
  const [priority, setPriority] = useState("ERKRANKUNG");
  const [startHour, setStartHour] = useState("1");
  const [hours, setHours] = useState("4");
  const [, setWeeklyHours] = useState("");
  const [schoolType] = useState("GRUNDSCHULE");
  const [substitutedTeacher, setSubstitutedTeacher] = useState("");
  const [quals, setQuals] = useState<string[]>([]);
  const [comments, setComments] = useState("");
  const [isLongTerm, setIsLongTerm] = useState(false);
  const [schedule, setSchedule] = useState<Record<string, number[]>>({
    "1": [], "2": [], "3": [], "4": [], "5": []
  });

  const toggleDay = useCallback((day: string) => {
    setSchedule(prev => {
      const allSelected = prev[day].length === 10;
      return { ...prev, [day]: allSelected ? [] : [1,2,3,4,5,6,7,8,9,10] };
    });
  }, []);

  const toggleHour = useCallback((day: string, hour: number) => {
    setSchedule(prev => {
      const hours = prev[day];
      if (hours.includes(hour)) {
        return { ...prev, [day]: hours.filter(h => h !== hour) };
      } else {
        return { ...prev, [day]: [...hours, hour].sort((a,b) => a-b) };
      }
    });
  }, []);

  const availableQuals = ["Grundschule", "Mittelschule", "Student/in", "Drittkraft", "Alles"];

  const fetchRequests = async () => {
    if (!user?.schoolId) return;
    try {
      const res = await fetch(`/api/requests?schoolId=${user.schoolId}&t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const sorted = data.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
        setRequests(sorted);
      }
    } catch (error) {
      console.error('Failed to fetch requests:', error);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchRequests();

    const handleRefresh = () => fetchRequests();
    window.addEventListener('app-refresh', handleRefresh);
    return () => window.removeEventListener('app-refresh', handleRefresh);
  }, [user?.id]);

  // School Profile State
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [profileData, setProfileData] = useState({ generalInfo: "", imageUrl: "", pinLat: 0, pinLng: 0 });
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [fileToUpload, setFileToUpload] = useState<File | null>(null);

  // Initialize when opening the dialog
  const handleOpenProfile = () => {
    if (user?.school) {
      setProfileData({
        generalInfo: user.school.generalInfo || "",
        imageUrl: user.school.imageUrl || "",
        pinLat: user.school.pinLat || user.school.latitude || 48.0,
        pinLng: user.school.pinLng || user.school.longitude || 10.5,
      });
    }
    setIsProfileOpen(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingProfile(true);
    let finalImageUrl = profileData.imageUrl;
    
    if (fileToUpload) {
      const formData = new FormData();
      formData.append("file", fileToUpload);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (res.ok) {
        const { url } = await res.json();
        finalImageUrl = url;
      }
    }

    try {
      const res = await fetch("/api/schools", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: 'updateInfo',
          schoolId: user?.schoolId,
          generalInfo: profileData.generalInfo,
          imageUrl: finalImageUrl,
          pinLat: profileData.pinLat,
          pinLng: profileData.pinLng
        })
      });
      if (!res.ok) {
        alert("Profil konnte nicht gespeichert werden.");
      }
    } catch (e) {
      alert("Netzwerkfehler beim Speichern des Profils.");
    } finally {
      setIsSavingProfile(false);
      setIsProfileOpen(false);
    }
    // Note: The UI won't immediately reflect the new data without reloading context
  };

  const [isResetDataOpen, setIsResetDataOpen] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resettingData, setResettingData] = useState(false);

  const handleResetData = async () => {
    if (resetConfirmation !== user?.school?.name) {
      alert("Der eingegebene Schulname stimmt nicht überein.");
      return;
    }
    setResettingData(true);
    try {
      const res = await fetch("/api/schools/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationName: resetConfirmation }),
      });
      if (res.ok) {
        setIsResetDataOpen(false);
        setResetConfirmation("");
        fetchRequests();
        alert("Alle Anfragen und Zuweisungen wurden erfolgreich gelöscht.");
      } else {
        const err = await res.json();
        alert(err.error || "Fehler beim Löschen der Daten.");
      }
    } catch (err) {
      alert("Ein Fehler ist aufgetreten.");
    } finally {
      setResettingData(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) return;
    if (isLongTerm && !endDate) {
      alert("Bitte geben Sie für längerfristige Bedarfe ein Enddatum an.");
      return;
    }
    if (!comments.trim()) {
      alert("Bitte füllen Sie das Kommentarfeld mit Startzeiten und Parkmöglichkeiten aus.");
      return;
    }

    let calculatedWeeklyHours = 0;
    if (isLongTerm) {
      Object.values(schedule).forEach(hoursArr => {
        calculatedWeeklyHours += hoursArr.length;
      });
      if (calculatedWeeklyHours === 0) {
        alert("Bitte markieren Sie im Stundenplan mindestens eine benötigte Stunde.");
        return;
      }
    } else {
      calculatedWeeklyHours = parseInt(hours);
    }

    const payloadSchedule = isLongTerm ? JSON.stringify(schedule) : null;

    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolId: user?.schoolId,
          date,
          endDate: isLongTerm ? (endDate || null) : null,
          priority,
          startHour: isLongTerm ? 1 : parseInt(startHour),
          hours: isLongTerm ? calculatedWeeklyHours : parseInt(hours),
          weeklyHours: calculatedWeeklyHours,
          schoolType,
          substitutedTeacher,
          schedule: payloadSchedule,
          qualifications: quals.join(","),
          comments: comments.trim(),
        }),
      });
      
      if (res.ok) {
        // Reset form
        setDate(new Date().toISOString().split('T')[0]);
        setEndDate("");
        setPriority("ERKRANKUNG");
        setStartHour("1");
        setHours("4");
        setWeeklyHours("");
        setSubstitutedTeacher("");
        setComments("");
        setQuals([]);
        setIsLongTerm(false);
        setSchedule({ "1": [], "2": [], "3": [], "4": [], "5": [] });
        fetchRequests();
      } else {
        const err = await res.json();
        alert(err.error || "Fehler beim Erstellen der Anfrage.");
      }
    } catch (error) {
      console.error('Failed to submit request:', error);
      alert('Netzwerkfehler beim Erstellen der Anfrage.');
    }
  };

  const handleCancel = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/requests/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Anfrage konnte nicht gelöscht werden.");
        return;
      }
      fetchRequests();
    } catch (e) {
      alert("Netzwerkfehler beim Löschen.");
    }
  }, [fetchRequests]);

  const toggleQual = useCallback((q: string) => {
    // If 'Alles' is selected, clear others. If another is selected, clear 'Alles'.
    if (q === 'Alles') {
      setQuals(prev => prev.includes('Alles') ? [] : ['Alles']);
      return;
    }
    
    setQuals(prev => {
      const newQuals = prev.filter(x => x !== 'Alles');
      if (newQuals.includes(q)) return newQuals.filter(x => x !== q);
      return [...newQuals, q];
    });
  }, []);

  const categories = useMemo(() => [
    { id: 'ERKRANKUNG', label: 'Ungeplanter Ausfall (Priorität 1)', icon: HeartPulse, color: 'rose' },
    { id: 'FORTBILDUNG', label: 'Fortbildung (Priorität 2)', icon: GraduationCap, color: 'blue' },
    { id: 'SCHULINTERN', label: 'Schulintern geblockt (Priorität 3)', icon: Building, color: 'slate' }
  ], []);

  const requestsByCategory = useMemo(() => {
    const grouped: Record<string, RequestData[]> = {};
    for (const cat of categories) {
      grouped[cat.id] = requests.filter(r => (r.priority || 'ERKRANKUNG') === cat.id);
    }
    return grouped;
  }, [requests, categories]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex justify-between items-center bg-white/50 dark:bg-slate-900/50 p-6 rounded-2xl border border-slate-200/60 dark:border-slate-800/60 backdrop-blur-md shadow-sm">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-blue-600 dark:text-blue-500">Schul-Dashboard</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg">Verwalten Sie Ihren Bedarf an Mobilen Reserven.</p>
        </div>
        <Button onClick={handleOpenProfile} className="gap-2 bg-slate-900 hover:bg-slate-800 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-slate-200 shadow-md">
          <Building className="h-4 w-4" /> Schulprofil bearbeiten
        </Button>
      </div>

      <Dialog open={isProfileOpen} onOpenChange={setIsProfileOpen}>
        <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Schulprofil bearbeiten</DialogTitle>
            <DialogDescription>
              Hinterlegen Sie allgemeine Informationen, ein Foto und markieren Sie den Parkplatz/Eingang für die Mobilen Reserven.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveProfile} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="generalInfo">Allgemeine Informationen (z.B. Anmeldung im Sekretariat)</Label>
              <Textarea 
                id="generalInfo" 
                value={profileData.generalInfo} 
                onChange={e => setProfileData({...profileData, generalInfo: e.target.value})} 
                className="h-24"
              />
            </div>
            <div className="space-y-2">
              <Label>Schul-Foto / Parkplatz (Optional)</Label>
              <div className="flex items-center gap-4">
                <Input type="file" accept="image/*" onChange={e => {
                  if (e.target.files && e.target.files.length > 0) {
                    setFileToUpload(e.target.files[0]);
                  }
                }} />
                {profileData.imageUrl && !fileToUpload && (
                  <Image src={profileData.imageUrl} alt="Schule" width={64} height={64} className="w-16 h-16 object-cover rounded-md" />
                )}
              </div>
            </div>
            <div className="space-y-2 pt-2 border-t">
              <Label className="flex items-center gap-2"><MapPin className="h-4 w-4 text-indigo-500" /> Karten-Pin (Eingang / Parkplatz)</Label>
              <p className="text-xs text-slate-500 mb-2">Klicken Sie auf die Karte, um den genauen Parkplatz oder Haupteingang für die Mobilen Reserven zu markieren.</p>
              <LocationPickerMap 
                lat={profileData.pinLat} 
                lng={profileData.pinLng} 
                onChange={(lat, lng) => setProfileData({...profileData, pinLat: lat, pinLng: lng})} 
              />
            </div>
            <DialogFooter className="pt-4">
              <Button type="submit" disabled={isSavingProfile} className="w-full">
                {isSavingProfile ? "Speichern..." : "Profil speichern"}
              </Button>
            </DialogFooter>
          </form>

          <div className="mt-8 border-t border-rose-200 dark:border-rose-900 pt-6">
            <h3 className="text-rose-600 dark:text-rose-400 font-bold flex items-center gap-2 mb-2">
              <AlertTriangle className="h-5 w-5" /> Gefahrenzone
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              Am Ende des Schuljahres können Sie hier alle Anfragen und Zuweisungen Ihrer Schule unwiderruflich löschen. Ihr Schulprofil bleibt erhalten.
            </p>
            <Button variant="destructive" className="w-full" onClick={() => setIsResetDataOpen(true)}>
              Alle Daten (Anfragen) löschen
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isResetDataOpen} onOpenChange={(open) => { setIsResetDataOpen(open); if(!open) setResetConfirmation(""); }}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" /> Wirklich alle Daten löschen?
            </DialogTitle>
            <DialogDescription>
              Diese Aktion kann <strong className="text-slate-900 dark:text-white">nicht rückgängig</strong> gemacht werden. Alle vergangenen und zukünftigen Anforderungen sowie Zuweisungen werden permanent aus der Datenbank entfernt.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>
                Bitte tippen Sie <strong>{user?.school?.name}</strong> ein, um zu bestätigen.
              </Label>
              <Input 
                value={resetConfirmation} 
                onChange={(e) => setResetConfirmation(e.target.value)} 
                placeholder={user?.school?.name} 
                className="border-red-200 focus:ring-red-500"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsResetDataOpen(false)}>Abbrechen</Button>
            <Button variant="destructive" onClick={handleResetData} disabled={resettingData || resetConfirmation !== user?.school?.name}>
              {resettingData ? "Wird gelöscht..." : "Endgültig löschen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* REQUEST FORM */}
        <div className="lg:col-span-1">
          <Card className="border-t-4 border-t-blue-500 shadow-xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm transition-all duration-300 hover:shadow-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <PlusCircle className="h-6 w-6 text-blue-500" />
                Bedarf melden
              </CardTitle>
              <CardDescription>Fordern Sie eine Mobile Reserve für einen bestimmten Tag an.</CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2 font-medium"><AlertCircle className="h-4 w-4 text-rose-500"/> Grund (Priorität)</Label>
                  <Select value={priority} onValueChange={(val) => val && setPriority(val)}>
                    <SelectTrigger className="shadow-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ERKRANKUNG">Ungeplanter Ausfall (Prio 1)</SelectItem>
                      <SelectItem value="FORTBILDUNG">Fortbildung (Prio 2)</SelectItem>
                      <SelectItem value="SCHULINTERN">Schulintern geblockt (Prio 3)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4 pb-4 border-b border-slate-100">
                  <Button type="button" variant={!isLongTerm ? "default" : "outline"} onClick={() => setIsLongTerm(false)} className={!isLongTerm ? "bg-indigo-600 hover:bg-indigo-700" : ""}>
                    1 Tag Bedarf
                  </Button>
                  <Button type="button" variant={isLongTerm ? "default" : "outline"} onClick={() => setIsLongTerm(true)} className={isLongTerm ? "bg-indigo-600 hover:bg-indigo-700" : ""}>
                    Längerfristig
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="date" className="flex items-center gap-2 font-medium"><Calendar className="h-4 w-4 text-blue-500"/> {isLongTerm ? "Startdatum" : "Datum"}</Label>
                    <Input id="date" type="date" required value={date} onChange={e => setDate(e.target.value)} className="border-slate-200 focus:ring-blue-500 transition-all shadow-sm" />
                  </div>
                  {isLongTerm && (
                    <div className="space-y-2">
                      <Label htmlFor="endDate" className="flex items-center gap-2 font-medium"><Calendar className="h-4 w-4 text-blue-500"/> Enddatum</Label>
                      <Input id="endDate" type="date" min={date} required value={endDate} onChange={e => setEndDate(e.target.value)} className="border-slate-200 focus:ring-blue-500 transition-all shadow-sm" />
                    </div>
                  )}
                </div>
                
                {!isLongTerm && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="startHour" className="flex items-center gap-2 font-medium"><Clock className="h-4 w-4 text-blue-500"/> Ab Stunde</Label>
                      <Select value={startHour} onValueChange={(val) => val && setStartHour(val)}>
                        <SelectTrigger className="shadow-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[1,2,3,4,5,6,7,8,9,10].map(h => (
                            <SelectItem key={`start-${h}`} value={h.toString()}>{h}. Stunde</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="hours" className="flex items-center gap-2 font-medium"><Clock className="h-4 w-4 text-blue-500"/> Dauer</Label>
                      <Select value={hours} onValueChange={(val) => val && setHours(val)}>
                        <SelectTrigger className="shadow-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[1,2,3,4,5,6,7,8,9,10].map(h => (
                            <SelectItem key={`dur-${h}`} value={h.toString()}>{h} Stunden</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {isLongTerm && (
                  <div className="space-y-2 pt-2">
                    <Label className="font-medium flex items-center gap-2"><Clock className="h-4 w-4 text-indigo-500"/> Benötigte Unterrichtszeiten (Woche)</Label>
                    <div className="border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden text-xs">
                      <div className="flex bg-slate-100 dark:bg-slate-800 text-center font-semibold">
                        <div className="w-10 border-r border-slate-200 dark:border-slate-700 py-1">Std.</div>
                        {['Mo', 'Di', 'Mi', 'Do', 'Fr'].map((day, i) => (
                          <div key={day} className="flex-1 border-r border-slate-200 dark:border-slate-700 last:border-r-0 py-1 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors" onClick={() => toggleDay((i+1).toString())}>{day}</div>
                        ))}
                      </div>
                      {[1,2,3,4,5,6,7,8,9,10].map(h => (
                        <div key={h} className="flex text-center border-t border-slate-200 dark:border-slate-800">
                          <div className="w-10 border-r border-slate-200 dark:border-slate-800 py-1 bg-slate-50 dark:bg-slate-900/50">{h}.</div>
                          {[1,2,3,4,5].map(day => {
                            const isSelected = schedule[day.toString()].includes(h);
                            return (
                              <div 
                                key={`${day}-${h}`} 
                                className={`flex-1 border-r border-slate-200 dark:border-slate-800 last:border-r-0 py-1 cursor-pointer transition-colors ${isSelected ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300' : 'bg-white dark:bg-slate-950 text-slate-200 dark:text-slate-800 hover:bg-slate-50'}`}
                                onClick={() => toggleHour(day.toString(), h)}
                              >
                                {isSelected ? '✓' : '·'}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2 pt-2">
                  <Label htmlFor="substitutedTeacher" className="flex items-center gap-2 font-medium">Vertretung für</Label>
                  <Input 
                    id="substitutedTeacher" 
                    required
                    placeholder="Name der ausgefallenen/fehlenden Lehrkraft..." 
                    value={substitutedTeacher} 
                    onChange={e => setSubstitutedTeacher(e.target.value)} 
                    className="border-slate-200 focus:ring-blue-500 shadow-sm" 
                  />
                </div>

                <div className="space-y-3 pt-2">
                  <Label className="font-medium">Benötigte Qualifikation</Label>
                  <div className="flex flex-wrap gap-2">
                    {availableQuals.map(q => (
                      <div 
                        key={q}
                        onClick={() => toggleQual(q)}
                        className={`text-sm px-4 py-2 rounded-xl cursor-pointer transition-all duration-200 border font-medium ${
                          quals.includes(q) 
                            ? 'bg-blue-100 text-blue-800 border-blue-300 shadow-sm dark:bg-blue-900/60 dark:text-blue-200 dark:border-blue-700 transform scale-105' 
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:border-slate-300 dark:bg-slate-800/50 dark:text-slate-400 dark:border-slate-700'
                        }`}
                      >
                        {q}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <Label htmlFor="comments" className="flex items-center gap-2 font-medium"><MessageSquare className="h-4 w-4 text-rose-500"/> Pflicht: Bemerkungen (Startzeiten etc.)</Label>
                  <Textarea 
                    id="comments" 
                    required
                    placeholder="WICHTIG: Bitte geben Sie hier genaue Unterrichtsstartzeiten, Treffpunkt und Parkmöglichkeiten ein..." 
                    className="resize-none h-20 shadow-sm border-slate-200 focus:ring-blue-500 border-rose-200 focus:border-rose-500" 
                    value={comments} 
                    onChange={e => setComments(e.target.value)} 
                  />
                  <p className="text-xs text-slate-500 italic">Diese Angaben sind für die zugewiesene Lehrkraft essenziell.</p>
                </div>

              </CardContent>
              <CardFooter>
                <Button type="submit" className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-md hover:shadow-lg transition-all py-6 text-lg">
                  Anfrage absenden
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>

        {/* REQUESTS LIST */}
        <div className="lg:col-span-2">
          <Card className="shadow-xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-slate-200/60 dark:border-slate-800/60 h-full">
            <CardHeader>
              <CardTitle className="text-xl">Aktive & Ausstehende Anfragen</CardTitle>
              <CardDescription>Übersicht all Ihrer kürzlich gemeldeten Bedarfe.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-12 text-slate-500 animate-pulse">Lade Anfragen...</div>
              ) : requests.length === 0 ? (
                <div className="text-center py-16 text-slate-500 bg-slate-50/50 dark:bg-slate-900/30 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800">
                  <div className="bg-slate-100 dark:bg-slate-800 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Calendar className="h-8 w-8 text-slate-400 dark:text-slate-500" />
                  </div>
                  <p className="text-lg font-medium text-slate-600 dark:text-slate-400">Keine aktiven Anfragen gefunden.</p>
                  <p className="text-sm mt-1">Erstellen Sie eine neue Anfrage auf der linken Seite.</p>
                </div>
              ) : (
                <div className="space-y-8">
                  {categories.map(category => {
                    const categoryRequests = requestsByCategory[category.id] || [];
                    if (categoryRequests.length === 0) return null;
                    const Icon = category.icon;
                    const colorClasses: Record<string, string> = {
                      rose: 'text-rose-700 dark:text-rose-400',
                      blue: 'text-blue-700 dark:text-blue-400',
                      slate: 'text-slate-700 dark:text-slate-400'
                    };
                    return (
                      <div key={category.id} className="space-y-3">
                        <h3 className={`font-semibold flex items-center gap-2 ${colorClasses[category.color]}`}>
                          <Icon className="w-5 h-5" /> {category.label}
                        </h3>
                        <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                          <Table>
                            <TableHeader className="bg-slate-50 dark:bg-slate-900/80">
                              <TableRow>
                                <TableHead className="font-semibold text-slate-900 dark:text-slate-100">Datum</TableHead>
                                <TableHead className="font-semibold text-slate-900 dark:text-slate-100">Klasse</TableHead>
                                <TableHead className="font-semibold text-slate-900 dark:text-slate-100">Zeitraum</TableHead>
                                <TableHead className="font-semibold text-slate-900 dark:text-slate-100">Qualifikation</TableHead>
                                <TableHead className="font-semibold text-slate-900 dark:text-slate-100">Status / Zuweisung</TableHead>
                                <TableHead className="text-right font-semibold text-slate-900 dark:text-slate-100">Aktion</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {categoryRequests.map((req) => (
                                <TableRow key={req.id} className="group hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                                  <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                                    {new Date(req.date).toLocaleDateString('de-DE')}
                                    {req.endDate && ` - ${new Date(req.endDate).toLocaleDateString('de-DE')}`}
                                  </TableCell>
                                  <TableCell>
                                    <div className="font-medium">{req.schoolType === 'GRUNDSCHULE' ? 'GS' : req.schoolType === 'MITTELSCHULE' ? 'MS' : 'GS/MS'}</div>
                                    <div className="text-xs text-slate-500">Für: {req.substitutedTeacher || '-'}</div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="font-medium">{req.schedule ? 'Individueller Plan' : (req.weeklyHours > req.hours ? `${req.weeklyHours} Std. gesamt` : `${req.hours} Std.`)}</div>
                                    <div className="text-xs text-slate-500">{req.schedule ? `${req.weeklyHours} Std./Woche` : `ab ${req.startHour}. Std (${req.hours}h/Tag)`}</div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="text-sm text-slate-700 dark:text-slate-300">{req.qualifications || 'Beliebig'}</div>
                                    {req.comments && (
                                      <div className="text-xs text-slate-500 mt-1 flex items-center gap-1" title={req.comments}>
                                        <MessageSquare className="w-3 h-3" /> Info hinterlegt
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex flex-col items-start gap-1">
                                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold shadow-sm ${
                                        req.status === 'PENDING' ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30' :
                                        req.status === 'PARTIALLY_FILLED' ? 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30' :
                                        req.status === 'FILLED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30' :
                                        'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300'
                                      }`}>
                                        {req.status === 'PENDING' ? 'AUSSTEHEND' : req.status === 'PARTIALLY_FILLED' ? 'TEILWEISE' : req.status === 'FILLED' ? 'BESETZT' : req.status}
                                      </span>
                                      {req.assignments && req.assignments.map((assign) => {
                                        const d = new Date(assign.date);
                                        const dayName = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()];
                                        return (
                                          <div key={assign.id} className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-md border border-emerald-100 dark:border-emerald-800/30 mt-1">
                                            <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                                              👤 {assign.teacher?.name || 'Unbekannt'} ({dayName}, {d.toLocaleDateString('de-DE')} - {assign.hours}h)
                                            </div>
                                            <div className="text-[10px] text-emerald-600 dark:text-emerald-500 mt-1 pl-4">
                                              📞 {assign.teacher?.phone || 'Keine Nummer'} | ✉️ {assign.teacher?.email || 'Keine Mail'}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {req.status === 'PENDING' && (
                                      <Button 
                                        variant="ghost" 
                                        size="sm" 
                                        className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 opacity-0 group-hover:opacity-100 transition-all rounded-full h-8 w-8 p-0"
                                        onClick={() => handleCancel(req.id)}
                                        aria-label="Anfrage stornieren"
                                        title="Anfrage stornieren"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}
