"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { MapWrapper } from "./MapWrapper";
import { Badge } from "@/components/ui/badge";
import { Calendar, CheckCircle2, Map as MapIcon, Users, UserPlus, FileDown, RotateCcw, Clock, MessageSquare } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MoreVertical, History, Navigation, School as SchoolIcon, KeySquare, Settings, Copy } from "lucide-react";
import { getCurrentSchoolYear, getLastSchoolYear, getNextSchoolYear } from "@/lib/schoolYear";

export function SchulamtDashboard() {
  const [selectedYear, setSelectedYear] = useState(getCurrentSchoolYear());
  const availableYears = [getLastSchoolYear(), getCurrentSchoolYear(), getNextSchoolYear()];

  const [teachers, setTeachers] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [schools, setSchools] = useState<any[]>([]);
  
  const [searchTeacherQuery, setSearchTeacherQuery] = useState("");
  const [searchRequestQuery, setSearchRequestQuery] = useState("");
  
  const [activeRequest, setActiveRequest] = useState<any>(null);
  const [candidates, setCandidates] = useState<any[]>([]);

  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignData, setAssignData] = useState<{teacherId: string, assignments: {date: string, hours: string, selected: boolean}[]} | null>(null);
  
  const [isAddTeacherOpen, setIsAddTeacherOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newTeacher, setNewTeacher] = useState({
    name: "",
    stammschuleId: "",
    maxWeeklyHours: "28",
    qualifications: "Grundschule",
    preferredType: "BOTH",
    address: "",
    isPartTime: false,
    email: "",
    password: "",
    phone: "",
    schoolYear: selectedYear
  });

  const [isEditTeacherOpen, setIsEditTeacherOpen] = useState(false);
  const [isEditingTeacher, setIsEditingTeacher] = useState(false);
  const [editTeacherData, setEditTeacherData] = useState<any>(null);
  const [editSchedule, setEditSchedule] = useState<Record<string, number[]>>({});

  const handleEditTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTeacherData) return;
    setIsEditingTeacher(true);
    try {
      const res = await fetch(`/api/teachers/${editTeacherData.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editTeacherData, schedule: editTeacherData.isPartTime ? editSchedule : undefined })
      });
      if (res.ok) {
        setIsEditTeacherOpen(false);
        loadData();
      } else {
        const error = await res.json();
        alert(`Fehler: ${error.error}`);
      }
    } finally {
      setIsEditingTeacher(false);
    }
  };

  const openEdit = (teacher: any) => {
    setEditTeacherData({
      id: teacher.id,
      name: teacher.name,
      stammschuleId: teacher.stammschuleId,
      maxWeeklyHours: teacher.maxWeeklyHours.toString(),
      qualifications: teacher.qualifications,
      preferredType: teacher.preferredType,
      address: "", // Keep blank so we only update lat/lng if changed
      isPartTime: teacher.isPartTime,
      email: teacher.email || "",
      password: "",
      phone: teacher.phone || ""
    });
    setEditSchedule(teacher.schedule ? JSON.parse(teacher.schedule) : {
      "1": [1,2,3,4,5,6,7,8,9,10],
      "2": [1,2,3,4,5,6,7,8,9,10],
      "3": [1,2,3,4,5,6,7,8,9,10],
      "4": [1,2,3,4,5,6,7,8,9,10],
      "5": [1,2,3,4,5,6,7,8,9,10],
    });
    setIsEditTeacherOpen(true);
  };

  const [schedule, setSchedule] = useState<Record<string, number[]>>({
    "1": [1,2,3,4,5,6,7,8,9,10],
    "2": [1,2,3,4,5,6,7,8,9,10],
    "3": [1,2,3,4,5,6,7,8,9,10],
    "4": [1,2,3,4,5,6,7,8,9,10],
    "5": [1,2,3,4,5,6,7,8,9,10],
  });

  const toggleDay = (day: string) => {
    setSchedule(prev => {
      const allSelected = prev[day].length === 10;
      return { ...prev, [day]: allSelected ? [] : [1,2,3,4,5,6,7,8,9,10] };
    });
  };

  const toggleHour = (day: string, hour: number) => {
    setSchedule(prev => {
      const hours = prev[day];
      if (hours.includes(hour)) {
        return { ...prev, [day]: hours.filter(h => h !== hour) };
      } else {
        return { ...prev, [day]: [...hours, hour].sort((a,b) => a-b) };
      }
    });
  };

  const [focusedLocation, setFocusedLocation] = useState<{lat: number, lng: number} | null>(null);
  const [archiveTeacher, setArchiveTeacher] = useState<any>(null);
  const [archiveData, setArchiveData] = useState<any[]>([]);

  // School Management States
  const [isSchoolManagerOpen, setIsSchoolManagerOpen] = useState(false);
  const [isAddingSchool, setIsAddingSchool] = useState(false);
  const [newSchool, setNewSchool] = useState({
    name: "", address: "", type: "GRUNDSCHULE", email: "", password: ""
  });
  const [editingPasswordId, setEditingPasswordId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");

  // Mail Settings States
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({ smtpHost: "", smtpUser: "", smtpPass: "" });
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const [isCopying, setIsCopying] = useState(false);

  const handleCopyTeachers = async () => {
    if (selectedYear !== getNextSchoolYear()) {
      alert("Sie können Lehrkräfte nur in das nächste Schuljahr kopieren. Bitte wählen Sie oben das nächste Schuljahr aus.");
      return;
    }
    const sourceYear = getCurrentSchoolYear();
    if (!confirm(`Möchten Sie alle Lehrkräfte aus dem aktuellen Schuljahr (${sourceYear}) in das nächste Schuljahr (${selectedYear}) kopieren?`)) return;
    
    setIsCopying(true);
    try {
      const res = await fetch("/api/teachers/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceYear, targetYear: selectedYear })
      });
      const data = await res.json();
      if (res.ok) {
        alert(`${data.copied} Lehrkräfte wurden erfolgreich kopiert!`);
        loadData(selectedYear);
      } else {
        alert(data.error || "Fehler beim Kopieren.");
      }
    } catch (e) {
      alert("Ein Fehler ist aufgetreten.");
    } finally {
      setIsCopying(false);
    }
  };

  const loadData = async (year?: string) => {
    const targetYear = year || selectedYear;
    const [tRes, rRes, sRes] = await Promise.all([
      fetch(`/api/teachers?year=${encodeURIComponent(targetYear)}&t=${Date.now()}`, { cache: 'no-store' }),
      fetch(`/api/requests?year=${encodeURIComponent(targetYear)}&t=${Date.now()}`, { cache: 'no-store' }),
      fetch(`/api/schools?t=${Date.now()}`, { cache: 'no-store' })
    ]);
    
    if (tRes.ok) setTeachers(await tRes.json());
    if (rRes.ok) setRequests(await rRes.json());
    if (sRes.ok) setSchools(await sRes.json());
  };

  useEffect(() => {
    loadData(selectedYear);

    const handleRefresh = () => loadData(selectedYear);
    window.addEventListener('app-refresh', handleRefresh);
    return () => window.removeEventListener('app-refresh', handleRefresh);
  }, [selectedYear]);

  const handleMatch = async (request: any) => {
    const res = await fetch(`/api/match/${request.id}`);
    if (res.ok) {
      const data = await res.json();
      setCandidates(data);
      setActiveRequest({ ...request, candidates: data });
    }
  };

  const openAssignModal = (candidate: any) => {
    // Calculate remaining request hours
    const currentAssignedHours = activeRequest.assignments?.reduce((sum: number, a: any) => sum + a.hours, 0) || 0;
    const requestRemaining = activeRequest.weeklyHours - currentAssignedHours;
    const teacherRemaining = candidate.maxWeeklyHours - candidate.assignedHours;
    const defaultHours = Math.min(requestRemaining, teacherRemaining, activeRequest.hours);
    
    // Generate dates between activeRequest.date and activeRequest.endDate (or just date if no endDate)
    const startDate = new Date(activeRequest.date);
    const endDate = activeRequest.endDate ? new Date(activeRequest.endDate) : startDate;
    
    const reqSchedule = activeRequest.schedule ? JSON.parse(activeRequest.schedule) : null;
    
    const dates = [];
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay();
      if (dayOfWeek !== 6 && dayOfWeek !== 7) { // Skip weekends
        // Calculate how many hours are already assigned for THIS specific date
        const dateStr = d.toISOString().split('T')[0];
        const assignmentsForDate = activeRequest.assignments?.filter((a: any) => a.date.startsWith(dateStr)) || [];
        const alreadyAssignedHours = assignmentsForDate.reduce((sum: number, a: any) => sum + a.hours, 0);

        let hoursForDay = defaultHours;
        let isSelected = true;
        
        if (reqSchedule) {
           const requestedHours = reqSchedule[dayOfWeek.toString()]?.length || 0;
           const remainingForDay = requestedHours - alreadyAssignedHours;
           
           if (remainingForDay <= 0) {
             continue; // Skip days that are completely covered or not requested
           } else {
             hoursForDay = Math.min(remainingForDay, teacherRemaining);
             isSelected = hoursForDay > 0;
           }
        } else {
           const remainingForDay = activeRequest.hours - alreadyAssignedHours;
           if (remainingForDay <= 0) {
             continue; // Skip day if fully covered
           }
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

    setAssignData({
      teacherId: candidate.id,
      assignments: dates
    });
    setAssignModalOpen(true);
  };

  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRequest || !assignData) return;
    
    const selectedAssignments = assignData.assignments.filter(a => a.selected);
    if (selectedAssignments.length === 0) {
      alert("Bitte wählen Sie mindestens einen Tag aus.");
      return;
    }

    await fetch("/api/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: activeRequest.id,
        teacherId: assignData.teacherId,
        assignments: selectedAssignments
      })
    });
    
    setAssignModalOpen(false);
    setActiveRequest(null);
    setCandidates([]);
    loadData(); // refresh all
  };

  const toggleAbsence = async (teacher: any) => {
    const newStatus = teacher.status === 'ACTIVE' ? 'SICK' : 'ACTIVE';
    await fetch(`/api/teachers/${teacher.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus })
    });
    loadData();
  };

  const handleAddTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAdding(true);
    try {
      const res = await fetch("/api/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newTeacher, schedule: newTeacher.isPartTime ? schedule : undefined })
      });
      if (res.ok) {
        setIsAddTeacherOpen(false);
        setNewTeacher({ ...newTeacher, name: "", address: "", isPartTime: false, email: "", password: "", phone: "", schoolYear: selectedYear }); // Reset some fields
        loadData(selectedYear);
      } else {
        const error = await res.json();
        alert(`Fehler: ${error.error}`);
      }
    } finally {
      setIsAdding(false);
    }
  };

  const openArchive = async (teacher: any) => {
    setArchiveTeacher(teacher);
    const res = await fetch(`/api/teachers/${teacher.id}/assignments?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      setArchiveData(await res.json());
    } else {
      setArchiveData([]);
    }
  };

  const handleAddSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAddingSchool(true);
    try {
      const res = await fetch("/api/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSchool)
      });
      if (res.ok) {
        setNewSchool({ name: "", address: "", type: "GRUNDSCHULE", email: "", password: "" });
        loadData();
      } else {
        alert("Fehler beim Anlegen der Schule.");
      }
    } finally {
      setIsAddingSchool(false);
    }
  };

  const handleUpdateCredentials = async (schoolId: string) => {
    if (!newPassword && !newEmail) return;
    try {
      const res = await fetch("/api/schools", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId, newPassword: newPassword || undefined, newEmail: newEmail || undefined })
      });
      if (res.ok) {
        setEditingPasswordId(null);
        setNewPassword("");
        setNewEmail("");
        alert("Zugangsdaten erfolgreich aktualisiert.");
        loadData();
      } else {
        alert("Fehler beim Aktualisieren.");
      }
    } catch (e) {
      alert("Fehler beim Aktualisieren.");
    }
  };

  const filteredTeachers = teachers.filter(t => {
    const q = searchTeacherQuery.toLowerCase();
    return (t.name || "").toLowerCase().includes(q) || 
           (t.stammschule?.name || "").toLowerCase().includes(q) ||
           (t.qualifications || "").toLowerCase().includes(q);
  });

  const filteredRequests = requests.filter(r => {
    const q = searchRequestQuery.toLowerCase();
    return (r.school?.name || "").toLowerCase().includes(q) ||
           (r.priority || "").toLowerCase().includes(q);
  });

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex justify-between items-center bg-white/50 dark:bg-slate-900/50 p-6 rounded-2xl border border-slate-200/60 dark:border-slate-800/60 backdrop-blur-md shadow-sm">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400">Schulamt-Dashboard</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg">Bedarfsplanung, Einsatzsteuerung und Mobile Reserven verwalten.</p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-1 shadow-sm">
            <span className="text-sm font-medium text-slate-500 pl-3">Schuljahr:</span>
            <Select value={selectedYear} onValueChange={(val) => val && setSelectedYear(val)}>
              <SelectTrigger className="w-[140px] border-0 shadow-none bg-transparent font-bold text-indigo-600 dark:text-indigo-400 focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableYears.map(y => (
                  <SelectItem key={y} value={y}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button onClick={() => setIsAddTeacherOpen(true)} className="gap-2 bg-slate-900 hover:bg-slate-800 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-slate-200 shadow-md">
            <UserPlus className="h-4 w-4" /> Lehrkraft hinzufügen
          </Button>
          
          {selectedYear === getNextSchoolYear() && teachers.length === 0 && (
            <Button onClick={handleCopyTeachers} disabled={isCopying} variant="outline" className="gap-2 border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-900 dark:text-indigo-400 dark:hover:bg-indigo-900/30">
              <Copy className="h-4 w-4" /> {isCopying ? "Kopiere..." : "Lehrkräfte aus Vorjahr übernehmen"}
            </Button>
          )}
        </div>
        
        <Dialog open={isAddTeacherOpen} onOpenChange={setIsAddTeacherOpen}>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle>Neue Mobile Reserve anlegen</DialogTitle>
              <DialogDescription>
                Fügen Sie eine neue Lehrkraft zum Pool des Staatlichen Schulamts hinzu.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAddTeacher} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={newTeacher.name} onChange={e => setNewTeacher({...newTeacher, name: e.target.value})} required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="email">E-Mail (Optional)</Label>
                  <Input id="email" type="email" value={newTeacher.email} onChange={e => setNewTeacher({...newTeacher, email: e.target.value})} placeholder="lehrer@schule.de" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Passwort (Optional)</Label>
                  <Input id="password" value={newTeacher.password} onChange={e => setNewTeacher({...newTeacher, password: e.target.value})} placeholder="Passwort für Login" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Telefonnummer</Label>
                <Input id="phone" type="tel" value={newTeacher.phone} onChange={e => setNewTeacher({...newTeacher, phone: e.target.value})} placeholder="0151 12345678" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="stammschule">Stammschule</Label>
                <Select value={newTeacher.stammschuleId} onValueChange={v => v && setNewTeacher({...newTeacher, stammschuleId: v})}>
                  <SelectTrigger><SelectValue placeholder="Schule auswählen" /></SelectTrigger>
                  <SelectContent>
                    {schools.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Arbeitszeitmodell</Label>
                  <Select value={newTeacher.isPartTime ? "Teilzeit" : "Vollzeit"} onValueChange={v => setNewTeacher({...newTeacher, isPartTime: v === "Teilzeit"})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Vollzeit">Vollzeit</SelectItem>
                      <SelectItem value="Teilzeit">Teilzeit (Stundenplan)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxWeeklyHours">Stunden/Woche</Label>
                  <Input id="maxWeeklyHours" type="number" min="1" max="40" value={newTeacher.maxWeeklyHours} onChange={e => setNewTeacher({...newTeacher, maxWeeklyHours: e.target.value})} required />
                </div>
              </div>
              
              {newTeacher.isPartTime && (
                <div className="space-y-2 pt-1">
                  <Label className="text-xs text-slate-500">Verfügbarkeit (Klick auf Tag markiert alles)</Label>
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

              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="qualifications">Qualifikation</Label>
                  <Select value={newTeacher.qualifications} onValueChange={v => v && setNewTeacher({...newTeacher, qualifications: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Grundschule">Grundschule</SelectItem>
                      <SelectItem value="Mittelschule">Mittelschule</SelectItem>
                      <SelectItem value="Student/in">Student/in</SelectItem>
                      <SelectItem value="Drittkraft">Drittkraft</SelectItem>
                      <SelectItem value="Alles">Alles</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Wohnort (Adresse)</Label>
                <Input id="address" placeholder="z.B. Marienplatz 1, München" value={newTeacher.address} onChange={e => setNewTeacher({...newTeacher, address: e.target.value})} required />
                <p className="text-xs text-slate-500 mt-1">Koordinaten werden automatisch ermittelt.</p>
              </div>
              <DialogFooter className="pt-4">
                <Button type="submit" className="w-full" disabled={isAdding}>
                  {isAdding ? "Wird gespeichert..." : "Lehrkraft speichern"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* EDIT TEACHER DIALOG */}
        {editTeacherData && (
          <Dialog open={isEditTeacherOpen} onOpenChange={setIsEditTeacherOpen}>
            <DialogContent className="sm:max-w-[480px]">
              <DialogHeader>
                <DialogTitle>Lehrkraft bearbeiten</DialogTitle>
                <DialogDescription>
                  Passen Sie die Daten, Arbeitszeiten oder Kontaktdaten an.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleEditTeacher} className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-name">Name</Label>
                  <Input id="edit-name" value={editTeacherData.name} onChange={e => setEditTeacherData({...editTeacherData, name: e.target.value})} required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-email">E-Mail</Label>
                    <Input id="edit-email" type="email" value={editTeacherData.email} onChange={e => setEditTeacherData({...editTeacherData, email: e.target.value})} placeholder="lehrer@schule.de" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-password">Neues Passwort (Optional)</Label>
                    <Input id="edit-password" value={editTeacherData.password} onChange={e => setEditTeacherData({...editTeacherData, password: e.target.value})} placeholder="Passwort ändern" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-phone">Telefonnummer</Label>
                  <Input id="edit-phone" type="tel" value={editTeacherData.phone} onChange={e => setEditTeacherData({...editTeacherData, phone: e.target.value})} placeholder="0151 12345678" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-stammschule">Stammschule</Label>
                  <Select value={editTeacherData.stammschuleId} onValueChange={v => v && setEditTeacherData({...editTeacherData, stammschuleId: v})}>
                    <SelectTrigger><SelectValue placeholder="Schule auswählen" /></SelectTrigger>
                    <SelectContent>
                      {schools.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Arbeitszeitmodell</Label>
                    <Select value={editTeacherData.isPartTime ? "Teilzeit" : "Vollzeit"} onValueChange={v => setEditTeacherData({...editTeacherData, isPartTime: v === "Teilzeit"})}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Vollzeit">Vollzeit</SelectItem>
                        <SelectItem value="Teilzeit">Teilzeit (Stundenplan)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-maxWeeklyHours">Stunden/Woche</Label>
                    <Input id="edit-maxWeeklyHours" type="number" min="1" max="40" value={editTeacherData.maxWeeklyHours} onChange={e => setEditTeacherData({...editTeacherData, maxWeeklyHours: e.target.value})} required />
                  </div>
                </div>
                
                {editTeacherData.isPartTime && (
                  <div className="space-y-2 pt-1">
                    <Label className="text-xs text-slate-500">Verfügbarkeit anpassen</Label>
                    <div className="border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden text-xs">
                      <div className="flex bg-slate-100 dark:bg-slate-800 text-center font-semibold">
                        <div className="w-10 border-r border-slate-200 dark:border-slate-700 py-1">Std.</div>
                        {['Mo', 'Di', 'Mi', 'Do', 'Fr'].map((day, i) => (
                          <div 
                            key={day} 
                            className="flex-1 border-r border-slate-200 dark:border-slate-700 last:border-r-0 py-1 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors" 
                            onClick={() => {
                              const dStr = (i+1).toString();
                              setEditSchedule(prev => {
                                const allSelected = prev[dStr].length === 10;
                                return { ...prev, [dStr]: allSelected ? [] : [1,2,3,4,5,6,7,8,9,10] };
                              });
                            }}
                          >
                            {day}
                          </div>
                        ))}
                      </div>
                      {[1,2,3,4,5,6,7,8,9,10].map(h => (
                        <div key={h} className="flex text-center border-t border-slate-200 dark:border-slate-800">
                          <div className="w-10 border-r border-slate-200 dark:border-slate-800 py-1 bg-slate-50 dark:bg-slate-900/50">{h}.</div>
                          {[1,2,3,4,5].map(day => {
                            const isSelected = editSchedule[day.toString()]?.includes(h);
                            return (
                              <div 
                                key={`${day}-${h}`} 
                                className={`flex-1 border-r border-slate-200 dark:border-slate-800 last:border-r-0 py-1 cursor-pointer transition-colors ${isSelected ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300' : 'bg-white dark:bg-slate-950 text-slate-200 dark:text-slate-800 hover:bg-slate-50'}`}
                                onClick={() => {
                                  const dStr = day.toString();
                                  setEditSchedule(prev => {
                                    const hours = prev[dStr] || [];
                                    return { ...prev, [dStr]: hours.includes(h) ? hours.filter(x => x !== h) : [...hours, h].sort((a,b) => a-b) };
                                  });
                                }}
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

                <div className="space-y-2">
                  <Label htmlFor="edit-qualifications">Qualifikation</Label>
                  <Select value={editTeacherData.qualifications} onValueChange={v => v && setEditTeacherData({...editTeacherData, qualifications: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Grundschule">Grundschule</SelectItem>
                      <SelectItem value="Mittelschule">Mittelschule</SelectItem>
                      <SelectItem value="Student/in">Student/in</SelectItem>
                      <SelectItem value="Drittkraft">Drittkraft</SelectItem>
                      <SelectItem value="Alles">Alles</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-address">Wohnort (Nur ausfüllen bei Änderung)</Label>
                  <Input id="edit-address" placeholder="Neue Adresse für Map-Pin..." value={editTeacherData.address} onChange={e => setEditTeacherData({...editTeacherData, address: e.target.value})} />
                </div>
                <DialogFooter className="pt-4">
                  <Button type="submit" className="w-full" disabled={isEditingTeacher}>
                    {isEditingTeacher ? "Wird gespeichert..." : "Änderungen speichern"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}

        {/* ASSIGN MODAL */}
        <Dialog open={assignModalOpen} onOpenChange={setAssignModalOpen}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>Zuweisung anpassen</DialogTitle>
              <DialogDescription>
                Wie viele Stunden soll diese Lehrkraft übernehmen?
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAssignSubmit} className="space-y-4 py-4">
              <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
                {assignData?.assignments.map((assignment, index) => {
                   const d = new Date(assignment.date);
                   const dayName = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()];
                   return (
                    <div key={index} className="flex items-center gap-3 p-3 border rounded-lg bg-slate-50 dark:bg-slate-900/50 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800">
                      <input 
                        type="checkbox" 
                        className="w-5 h-5 accent-indigo-600 rounded cursor-pointer"
                        checked={assignment.selected}
                        onChange={(e) => {
                          const newAssignments = [...assignData.assignments];
                          newAssignments[index].selected = e.target.checked;
                          setAssignData({...assignData, assignments: newAssignments});
                        }}
                      />
                      <div className={`flex-1 font-medium ${!assignment.selected ? 'text-slate-400 line-through' : ''}`}>
                        {dayName}, {d.toLocaleDateString('de-DE')}
                      </div>
                      <div className="flex items-center gap-2">
                        <Input 
                          type="number" 
                          min="1" 
                          max="10"
                          className="w-20"
                          value={assignment.hours}
                          disabled={!assignment.selected}
                          onChange={(e) => {
                            const newAssignments = [...assignData.assignments];
                            newAssignments[index].hours = e.target.value;
                            setAssignData({...assignData, assignments: newAssignments});
                          }} 
                        />
                        <span className="text-sm text-slate-500">Std.</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <DialogFooter className="pt-4 border-t border-slate-100 dark:border-slate-800">
                <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-md">
                  Bestätigen & Zuweisen
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* ARCHIVE DIALOG */}
        <Dialog open={!!archiveTeacher} onOpenChange={(open) => !open && setArchiveTeacher(null)}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>Archiv: {archiveTeacher?.name}</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 py-4">
              {archiveData.length === 0 ? (
                <div className="text-center py-8 text-slate-500">Keine bisherigen Einsätze gefunden.</div>
              ) : (
                <div className="space-y-3">
                  {archiveData.map((assignment: any) => (
                    <div key={assignment.id} className="p-4 border rounded-xl bg-slate-50 dark:bg-slate-900/50">
                        <div className="font-bold mb-1">{assignment.request.school.name}</div>
                        <div className="text-xs text-slate-500 mb-2">{assignment.request.schedule ? 'Individueller Plan' : `ab ${assignment.request.startHour}. Stunde (${assignment.request.hours}h)`}</div>
                        <div className="flex justify-between text-sm text-slate-600 dark:text-slate-400">
                          <span>📅 {new Date(assignment.date).toLocaleDateString('de-DE')}</span>
                          <span>⏱️ {assignment.hours} Std.</span>
                        </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* SCHOOL MANAGER DIALOG */}
        <Dialog open={isSchoolManagerOpen} onOpenChange={setIsSchoolManagerOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>Schul- und Passwortverwaltung</DialogTitle>
              <DialogDescription>
                Neue Schulen anlegen oder Passwörter für bestehende Schulen zurücksetzen.
              </DialogDescription>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 py-4 space-y-8">
              
              <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border">
                <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                  <SchoolIcon className="w-5 h-5" /> Neue Schule hinzufügen
                </h3>
                <form onSubmit={handleAddSchool} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Name der Schule</Label>
                      <Input value={newSchool.name} onChange={e => setNewSchool({...newSchool, name: e.target.value})} required placeholder="z.B. GS Mindelheim" />
                    </div>
                    <div className="space-y-2">
                      <Label>Typ</Label>
                      <Select value={newSchool.type} onValueChange={v => v && setNewSchool({...newSchool, type: v})}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="GRUNDSCHULE">Grundschule</SelectItem>
                          <SelectItem value="MITTELSCHULE">Mittelschule</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Adresse</Label>
                      <Input value={newSchool.address} onChange={e => setNewSchool({...newSchool, address: e.target.value})} required />
                    </div>
                    <div className="space-y-2">
                      <Label>E-Mail-Adresse (Login)</Label>
                      <Input value={newSchool.email} onChange={e => setNewSchool({...newSchool, email: e.target.value})} required placeholder="schule@example.de" type="email" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    <div className="space-y-2">
                      <Label>Initiales Passwort</Label>
                      <Input value={newSchool.password} onChange={e => setNewSchool({...newSchool, password: e.target.value})} required placeholder="z.B. gs-mindelheim-2026" />
                    </div>
                  </div>
                  <Button type="submit" disabled={isAddingSchool}>
                    {isAddingSchool ? "Wird gespeichert..." : "Schule anlegen"}
                  </Button>
                </form>
              </div>

              <div>
                <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                  <KeySquare className="w-5 h-5" /> Passwörter verwalten
                </h3>
                <div className="space-y-2">
                  {schools.map(school => (
                    <div key={school.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 border rounded-lg bg-white dark:bg-slate-900 shadow-sm">
                      <div className="w-full sm:w-auto overflow-hidden">
                        <div className="font-bold truncate">{school.name}</div>
                        <div className="text-sm text-slate-500">{school.type}</div>
                        {school.user?.email && <div className="text-xs text-slate-400 mt-1 truncate">{school.user.email}</div>}
                      </div>
                      
                      {editingPasswordId === school.id ? (
                        <div className="flex flex-col gap-2 items-start sm:items-end w-full sm:w-auto">
                          <div className="flex flex-col sm:flex-row gap-2 w-full">
                            <Input 
                              type="email" 
                              placeholder="Neue E-Mail" 
                              value={newEmail}
                              onChange={e => setNewEmail(e.target.value)}
                              className="w-full sm:w-40 h-8 text-sm"
                            />
                            <Input 
                              type="text" 
                              placeholder="Neues Passwort" 
                              value={newPassword}
                              onChange={e => setNewPassword(e.target.value)}
                              className="w-full sm:w-40 h-8 text-sm"
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => handleUpdateCredentials(school.id)}>Speichern</Button>
                            <Button size="sm" variant="ghost" onClick={() => {
                              setEditingPasswordId(null);
                              setNewEmail("");
                              setNewPassword("");
                            }}>Abbrechen</Button>
                          </div>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => {
                          setEditingPasswordId(school.id);
                          setNewEmail(school.user?.email || "");
                        }}>
                          Zugangsdaten ändern
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </DialogContent>
        </Dialog>

        {/* SETTINGS DIALOG */}
        <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>Mail-API Konfiguration</DialogTitle>
              <DialogDescription>
                Hinterlegen Sie die Zugangsdaten für den Mail-Versand.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={async (e) => {
              e.preventDefault();
              setIsSavingSettings(true);
              await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
              });
              setIsSavingSettings(false);
              setIsSettingsOpen(false);
            }} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>SMTP Host</Label>
                <Input value={settings.smtpHost} onChange={e => setSettings({...settings, smtpHost: e.target.value})} placeholder="smtp.example.com" />
              </div>
              <div className="space-y-2">
                <Label>SMTP Benutzer</Label>
                <Input value={settings.smtpUser} onChange={e => setSettings({...settings, smtpUser: e.target.value})} placeholder="user@example.com" />
              </div>
              <div className="space-y-2">
                <Label>SMTP Passwort</Label>
                <Input type="password" value={settings.smtpPass} onChange={e => setSettings({...settings, smtpPass: e.target.value})} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={isSavingSettings}>{isSavingSettings ? 'Speichern...' : 'Speichern'}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* MAP SECTION */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="shadow-xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-slate-200/60 dark:border-slate-800/60 overflow-hidden">
            <CardHeader className="bg-slate-50/80 dark:bg-slate-900/50 pb-4 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="flex items-center gap-2 text-xl">
                <MapIcon className="h-6 w-6 text-indigo-500" />
                Regionale Übersicht (Unterallgäu)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <MapWrapper 
                schools={schools} 
                teachers={teachers} 
                activeRequest={activeRequest}
                focusedLocation={focusedLocation}
              />
            </CardContent>
          </Card>

          {/* ACTIVE REQUEST & MATCHING */}
          <Card className="shadow-xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-slate-200/60 dark:border-slate-800/60 transition-all">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-xl">Bedarfsübersicht & Matching Engine</CardTitle>
                <CardDescription>Wählen Sie eine ausstehende Anfrage, um die besten Kandidaten zu ermitteln.</CardDescription>
              </div>
              <Input 
                placeholder="Suche (Schule, Grund)..." 
                value={searchRequestQuery}
                onChange={e => setSearchRequestQuery(e.target.value)}
                className="w-64"
              />
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {filteredRequests.filter(r => r.status === 'PENDING' || r.status === 'PARTIALLY_FILLED').length === 0 ? (
                  <p className="text-slate-500 italic py-4 col-span-full">Keine ausstehenden Anfragen gefunden.</p>
                ) : (
                  filteredRequests.filter(r => r.status === 'PENDING' || r.status === 'PARTIALLY_FILLED').map(req => (
                    <div 
                      key={req.id} 
                      onClick={() => handleMatch(req)}
                      className={`p-5 rounded-2xl border cursor-pointer transition-all duration-300 flex flex-col justify-between h-full ${
                        activeRequest?.id === req.id 
                          ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 ring-4 ring-indigo-500/10 transform scale-[1.02]' 
                          : 'border-slate-200 dark:border-slate-800 hover:border-indigo-300 bg-white dark:bg-slate-900 shadow-sm hover:shadow-md'
                      }`}
                    >
                      <div className="font-bold text-slate-900 dark:text-slate-100 mb-1 flex items-center justify-between">
                        {req.school.name}
                        {req.status === 'PARTIALLY_FILLED' && <Badge variant="secondary" className="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">Teilweise</Badge>}
                      </div>
                      <div className="flex justify-between items-center text-sm text-slate-600 dark:text-slate-400 mb-2">
                        <span>{new Date(req.date).toLocaleDateString('de-DE')}</span>
                        <span className="font-semibold">{req.weeklyHours > req.hours ? `${req.weeklyHours} Std.` : `${req.hours} Std.`} <span className="font-normal text-xs text-slate-500">(ab {req.startHour}.)</span></span>
                      </div>
                      {req.weeklyHours > req.hours && (
                        <div className="text-xs font-medium text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-1.5 rounded-md mb-2 flex items-center justify-between">
                          <span>Bereits abgedeckt:</span>
                          <span className="font-bold">{req.assignments?.reduce((sum: number, a: any) => sum + a.hours, 0) || 0} / {req.weeklyHours} Std.</span>
                        </div>
                      )}
                      {req.assignments && req.assignments.length > 0 && (
                        <div className="mb-2 space-y-1">
                          {req.assignments.map((assign: any) => {
                            const d = new Date(assign.date);
                            const dayName = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()];
                            return (
                              <div key={assign.id} className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 flex items-center justify-between gap-1 w-full bg-emerald-50 dark:bg-emerald-900/20 p-1.5 rounded">
                                <div className="flex-1">👤 {assign.teacher.name} ({dayName}, {d.toLocaleDateString('de-DE')} - {assign.hours}h)
                                  <span className={`ml-2 px-1.5 py-0.5 rounded text-[9px] uppercase ${assign.status === 'PENDING' ? 'bg-amber-100 text-amber-800' : assign.status === 'ACCEPTED' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>{assign.status === 'PENDING' ? 'Wartet' : assign.status === 'ACCEPTED' ? 'Bestätigt' : 'Abgelehnt'}</span>
                                </div>
                                <button 
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if(confirm("Möchten Sie diese Zuweisung wirklich aufheben? Die Lehrkraft wird benachrichtigt.")) {
                                      await fetch(`/api/assignments/${assign.id}`, { method: 'DELETE' });
                                      loadData();
                                    }
                                  }}
                                  className="text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 px-1.5 py-0.5 rounded transition-colors"
                                  title="Zuweisung aufheben"
                                >
                                  Aufheben
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <div className="flex flex-col gap-1 mt-2">
                        <div className="text-xs inline-flex px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded-md text-slate-500 font-medium w-fit">Quals: {req.qualifications || 'Beliebig'}</div>
                        {req.comments && (
                          <Popover>
                            <PopoverTrigger>
                              <div className="text-xs bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 px-2 py-1.5 rounded-md mt-1 flex items-start gap-1.5 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors">
                                <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                <span className="line-clamp-2">{req.comments}</span>
                              </div>
                            </PopoverTrigger>
                            <PopoverContent className="w-80 text-sm">
                              <p className="font-semibold mb-1 text-slate-700 dark:text-slate-300">Kommentar</p>
                              <p className="whitespace-pre-wrap leading-relaxed text-slate-600 dark:text-slate-400">{req.comments}</p>
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* CANDIDATES LIST */}
              {activeRequest && (
                <div className="mt-6 border-t border-slate-100 dark:border-slate-800 pt-6 animate-in fade-in slide-in-from-top-4">
                  <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    Top Kandidaten für {activeRequest.school.name}
                  </h3>
                  
                  {candidates.length === 0 ? (
                    <div className="p-4 bg-red-50 text-red-800 rounded-xl border border-red-100 dark:bg-red-950/30 dark:border-red-900/50 dark:text-red-300">
                      Keine verfügbaren Kandidaten gefunden (Stundenlimit erreicht oder krank).
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {candidates.slice(0, 3).map((candidate, idx) => (
                        <div key={candidate.id} className="flex items-center justify-between p-4 border border-slate-200/60 dark:border-slate-800/60 rounded-xl bg-slate-50/50 dark:bg-slate-900/30 hover:bg-white dark:hover:bg-slate-900 shadow-sm hover:shadow-md transition-all">
                          <div>
                            <div className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-3">
                              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-sm ${idx === 0 ? 'bg-gradient-to-br from-amber-300 to-amber-500' : idx === 1 ? 'bg-gradient-to-br from-slate-300 to-slate-400' : 'bg-gradient-to-br from-orange-300 to-orange-500'}`}>
                                {idx + 1}
                              </span>
                              {candidate.name}
                            </div>
                            <div className="text-sm text-slate-500 dark:text-slate-400 mt-2 flex gap-3">
                              <span className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-xs"><MapIcon className="w-3 h-3"/> {candidate.distanceToSchool.toFixed(1)} km</span>
                              <span className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-xs"><Clock className="w-3 h-3"/> {candidate.assignedHours}/{candidate.maxWeeklyHours}h</span>
                              {candidate.stammschuleId === activeRequest.schoolId && <span className="flex items-center gap-1 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300 px-2 py-0.5 rounded text-xs">Stammschule</span>}
                            </div>
                          </div>
                          <Button 
                            onClick={() => openAssignModal(candidate)}
                            className="bg-indigo-600 hover:bg-indigo-700 shadow-md transition-transform active:scale-95"
                          >
                            Zuweisen
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          
          {/* ERFOLGREICH ZUGEWIESENE BEDARFE (FILLED) */}
          <Card className="shadow-xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-slate-200/60 dark:border-slate-800/60 mt-6 transition-all opacity-80 hover:opacity-100">
            <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
              <CardTitle className="text-xl text-emerald-700 dark:text-emerald-500 flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5" />
                Erfolgreich zugewiesene Bedarfe
              </CardTitle>
              <CardDescription>Diese Bedarfe sind vollständig abgedeckt. Klicken Sie auf eine Anfrage, um die Zuweisungen zu verwalten oder zu stornieren.</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {filteredRequests.filter(r => r.status === 'FILLED').length === 0 ? (
                  <p className="text-slate-500 italic py-4 col-span-full">Keine abgeschlossenen Anfragen vorhanden.</p>
                ) : (
                  filteredRequests.filter(r => r.status === 'FILLED').map(req => (
                    <div 
                      key={req.id} 
                      onClick={() => handleMatch(req)}
                      className={`p-5 rounded-2xl border cursor-pointer transition-all duration-300 flex flex-col justify-between h-full bg-slate-50 border-slate-200 hover:shadow-md dark:bg-slate-900/50 dark:border-slate-700 ${
                        activeRequest?.id === req.id ? 'ring-2 ring-emerald-500 shadow-md bg-emerald-50/50 dark:bg-emerald-900/20 border-emerald-300' : ''
                      }`}
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex flex-col">
                          <span className="font-bold text-lg leading-tight">{req.school.name}</span>
                          <span className="text-xs font-semibold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full w-max mt-1 border border-emerald-200 dark:bg-emerald-900/30 dark:border-emerald-800 dark:text-emerald-400">
                            VOLLSTÄNDIG
                          </span>
                        </div>
                        <div className="bg-slate-200 text-slate-700 font-bold px-3 py-1 rounded-full text-sm shrink-0 border border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700">
                          {req.weeklyHours}h
                        </div>
                      </div>
                      
                      <div className="space-y-1 mt-auto">
                        <div className="flex items-center text-sm text-slate-600 dark:text-slate-400 font-medium">
                          <Calendar className="w-4 h-4 mr-2 text-emerald-500" />
                          {new Date(req.date).toLocaleDateString('de-DE')} 
                          {req.endDate && ` - ${new Date(req.endDate).toLocaleDateString('de-DE')}`}
                        </div>
                        <div className="flex items-center text-sm text-slate-600 dark:text-slate-400">
                          <Clock className="w-4 h-4 mr-2 text-emerald-500" />
                          {req.assignments?.length || 0} Zuweisung(en)
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* TEACHER MANAGEMENT */}
        <div className="lg:col-span-1 space-y-6">
          <Card className="shadow-xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-slate-200/60 dark:border-slate-800/60 h-[calc(100%-12rem)] flex flex-col">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-xl">
                <Users className="h-6 w-6 text-slate-500" />
                Mobile Reserven
              </CardTitle>
            </CardHeader>
            <div className="px-6 pb-2">
              <Input 
                placeholder="Suche (Name, Schule)..." 
                value={searchTeacherQuery}
                onChange={e => setSearchTeacherQuery(e.target.value)}
              />
            </div>
            <CardContent className="flex-1 overflow-y-auto custom-scrollbar pr-2 pt-2">
              <div className="space-y-3">
                {filteredTeachers.map(teacher => (
                  <div key={teacher.id} className="group p-4 border border-slate-200/60 dark:border-slate-800/60 rounded-xl bg-white dark:bg-slate-900 shadow-sm hover:shadow-md transition-shadow relative">
                    <div className="flex justify-between items-start mb-2 pr-8">
                      <div className="font-bold text-slate-900 dark:text-slate-100">{teacher.name}</div>
                      <Badge 
                        variant="outline" 
                        className={`cursor-pointer transition-colors shadow-sm ${teacher.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20' : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20'}`}
                        onClick={() => toggleAbsence(teacher)}
                        title="Status ändern (Krank / Aktiv)"
                      >
                        {teacher.status === 'ACTIVE' ? 'AKTIV' : 'KRANK'}
                      </Badge>
                    </div>
                    
                    {/* DROPDOWN MENU */}
                    <div className="absolute top-3 right-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger className="h-8 w-8 text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 flex items-center justify-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none">
                          <MoreVertical className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(teacher)} className="gap-2 cursor-pointer">
                            <Settings className="h-4 w-4 text-indigo-500" />
                            Bearbeiten
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setFocusedLocation({ lat: teacher.homeLat, lng: teacher.homeLng })} className="gap-2 cursor-pointer">
                            <Navigation className="h-4 w-4 text-indigo-500" />
                            Auf der Karte zeigen
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openArchive(teacher)} className="gap-2 cursor-pointer">
                            <History className="h-4 w-4 text-slate-500" />
                            Archiv
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="text-sm text-slate-500 dark:text-slate-400 mb-1 line-clamp-1" title={teacher.stammschule?.name}>
                      📍 {teacher.stammschule?.name}
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-500 mb-3 flex items-center gap-2">
                      Auslastung: {teacher.maxWeeklyHours} Std./Woche
                      {teacher.isPartTime && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Teilzeit</Badge>}
                    </div>
                    <div className="text-xs font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 px-2.5 py-1 rounded-md inline-block">
                      {teacher.qualifications}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* SYSTEM SETTINGS */}
          <Card className="shadow-xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-t-4 border-t-rose-500">
            <CardHeader className="pb-3">
              <CardTitle className="text-rose-600 dark:text-rose-400 flex items-center gap-2">
                <RotateCcw className="h-5 w-5" />
                System & Export
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button 
                variant="outline" 
                className="w-full justify-start gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-950/30 dark:border-indigo-900/50 dark:text-indigo-300 dark:hover:bg-indigo-900/50 shadow-sm"
                onClick={() => setIsSchoolManagerOpen(true)}
              >
                <SchoolIcon className="h-4 w-4" /> Schulen verwalten
              </Button>
              <Button 
                variant="outline" 
                className="w-full justify-start gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-950/30 dark:border-indigo-900/50 dark:text-indigo-300 dark:hover:bg-indigo-900/50 shadow-sm"
                onClick={() => {
                  fetch(`/api/settings?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json()).then(data => {
                    setSettings({
                      smtpHost: data.smtpHost || "",
                      smtpUser: data.smtpUser || "",
                      smtpPass: data.smtpPass || ""
                    });
                    setIsSettingsOpen(true);
                  });
                }}
              >
                <Settings className="h-4 w-4" /> Mail-API konfigurieren
              </Button>
              <Button 
                variant="outline" 
                className="w-full justify-start gap-2 bg-white dark:bg-slate-900 shadow-sm"
                onClick={() => window.open('/api/export', '_blank')}
              >
                <FileDown className="h-4 w-4" /> CSV Export (Jahresende)
              </Button>
              <Button 
                variant="destructive" 
                className="w-full justify-start gap-2 bg-rose-600 hover:bg-rose-700 shadow-md transition-colors"
                onClick={async () => {
                  if (confirm("Sind Sie sicher, dass Sie das System zurücksetzen möchten? Dies löscht alle Anfragen und Zuweisungen dauerhaft!")) {
                    await fetch('/api/reset', { method: 'POST' });
                    loadData();
                  }
                }}
              >
                <RotateCcw className="h-4 w-4" /> Neues Schuljahr (Reset)
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
