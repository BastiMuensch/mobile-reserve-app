"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { MapWrapper } from "./MapWrapper";
import { Badge } from "@/components/ui/badge";
import { Calendar, CheckCircle2, Map as MapIcon, Users, UserPlus, FileDown, RotateCcw, Clock, MessageSquare, AlertCircle, Activity, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MoreVertical, History, Navigation, School as SchoolIcon, KeySquare, Settings, Copy } from "lucide-react";
import { getCurrentSchoolYear, getLastSchoolYear, getNextSchoolYear } from "@/lib/schoolYear";

type TeacherData = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  stammschuleId: string;
  maxWeeklyHours: number;
  isPartTime: boolean;
  schedule?: string;
  qualifications: string;
  status: string;
  gender?: string | null;
  homeLat: number;
  homeLng: number;
  preferredType: string;
  schoolYear: string;
  stammschule: SchoolData;
  assignments: AssignmentData[];
  distanceToSchool?: number;
  matchScore?: number;
  assignedHours?: number;
};

type SchoolData = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  type: string;
  generalInfo?: string;
  imageUrl?: string;
  pinLat?: number;
  pinLng?: number;
  user?: { id: string; email: string; role: string };
};

type AssignmentData = {
  id: string;
  requestId: string;
  teacherId: string;
  date: string;
  hours: number;
  status: string;
  teacher?: TeacherData;
  request?: RequestData;
};

type RequestData = {
  id: string;
  schoolId: string;
  date: string;
  endDate?: string;
  priority: string;
  startHour: number;
  hours: number;
  weeklyHours: number;
  schoolType: string;
  substitutedTeacher: string;
  schedule?: string;
  qualifications: string;
  comments?: string;
  status: string;
  school: SchoolData;
  assignments: AssignmentData[];
};

export function SchulamtDashboard() {
  const [selectedYear, setSelectedYear] = useState(getCurrentSchoolYear());
  const availableYears = [getLastSchoolYear(), getCurrentSchoolYear(), getNextSchoolYear()];

  const [teachers, setTeachers] = useState<TeacherData[]>([]);
  const [requests, setRequests] = useState<RequestData[]>([]);
  const [schools, setSchools] = useState<SchoolData[]>([]);
  
  const [searchTeacherQuery, setSearchTeacherQuery] = useState("");
  const [searchRequestQuery, setSearchRequestQuery] = useState("");
  
  const [activeRequest, setActiveRequest] = useState<RequestData | null>(null);
  const [candidates, setCandidates] = useState<TeacherData[]>([]);

  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignData, setAssignData] = useState<{teacherId: string, assignments: {date: string, hours: string, selected: boolean}[]} | null>(null);
  
  const [isAddTeacherOpen, setIsAddTeacherOpen] = useState(false);
  const [activeKpiDetail, setActiveKpiDetail] = useState<'reserven' | 'offene' | 'besetzte' | 'krank' | null>(null);
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
    gender: "",
    schoolYear: selectedYear
  });

  const [isEditTeacherOpen, setIsEditTeacherOpen] = useState(false);
  const [isEditingTeacher, setIsEditingTeacher] = useState(false);
  const [editTeacherData, setEditTeacherData] = useState<any /* eslint-disable-line @typescript-eslint/no-explicit-any */>(null);
  const [editSchedule, setEditSchedule] = useState<Record<string, number[]>>({});

  const handleGeneratePreview = async () => {
    try {
      const res = await fetch('/api/schulamt/profile/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(templateSettings)
      });
      if (!res.ok) throw new Error('Fehler beim Generieren der Vorschau');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
      // Revoke the blob URL after a short delay
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } catch (error) {
      console.error(error);
      alert('Vorschau konnte nicht generiert werden.');
    }
  };

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

  const handleSaveTemplate = async (e: React.FormEvent) => {
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

  const openEdit = (teacher: TeacherData) => {
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
      phone: teacher.phone || "",
      gender: teacher.gender || ""
    });
    let parsedSchedule = {
      "1": [1,2,3,4,5,6,7,8,9,10],
      "2": [1,2,3,4,5,6,7,8,9,10],
      "3": [1,2,3,4,5,6,7,8,9,10],
      "4": [1,2,3,4,5,6,7,8,9,10],
      "5": [1,2,3,4,5,6,7,8,9,10],
    };
    if (teacher.schedule) {
      try {
        parsedSchedule = JSON.parse(teacher.schedule);
      } catch (e) {
        console.warn('Failed to parse teacher schedule', e);
      }
    }
    setEditSchedule(parsedSchedule);
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
  const [archiveTeacher, setArchiveTeacher] = useState<TeacherData | null>(null);
  const [archiveData, setArchiveData] = useState<AssignmentData[]>([]);

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

  // Briefvorlage Settings States
  const [isTemplateSettingsOpen, setIsTemplateSettingsOpen] = useState(false);
  const [templateSettings, setTemplateSettings] = useState({
    headerText: "",
    returnAddress: "",
    logoUrl: "",
    contactAddress: "",
    contactPerson: "",
    city: "",
    amtsleitungName: "",
    amtsleitungTitle: "",
    signatureUrl: ""
  });
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingSignature, setIsUploadingSignature] = useState(false);

  const handleUploadLogo = async (file: File) => {
    setIsUploadingLogo(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success) {
        setTemplateSettings(prev => ({ ...prev, logoUrl: data.url }));
      } else {
        alert("Upload fehlgeschlagen: " + (data.error || "Unbekannter Fehler"));
      }
    } catch (e) {
      alert("Fehler beim Upload des Logos");
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleUploadSignature = async (file: File) => {
    setIsUploadingSignature(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success) {
        setTemplateSettings(prev => ({ ...prev, signatureUrl: data.url }));
      } else {
        alert("Upload fehlgeschlagen: " + (data.error || "Unbekannter Fehler"));
      }
    } catch (e) {
      alert("Fehler beim Upload der Unterschrift");
    } finally {
      setIsUploadingSignature(false);
    }
  };

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
    } catch {
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

  const handleMatch = async (request: RequestData) => {
    const res = await fetch(`/api/match/${request.id}`);
    if (res.ok) {
      const data = await res.json();
      setActiveRequest(data.request);
      setCandidates(data.candidates);
    }
  };

  const handleSelectRequestFromKpi = (request: RequestData) => {
    handleMatch(request);
    setActiveKpiDetail(null);
    setTimeout(() => {
      document.getElementById('matching-engine')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const openAssignModal = (candidate: TeacherData) => {
    if (!activeRequest) return;
    
    // Calculate remaining request hours
    const currentAssignedHours = activeRequest.assignments?.filter((a: AssignmentData) => a.status !== 'REJECTED').reduce((sum: number, a: AssignmentData) => sum + a.hours, 0) || 0;
    const requestRemaining = activeRequest.weeklyHours - currentAssignedHours;
    const teacherRemaining = candidate.maxWeeklyHours - (candidate.assignedHours || 0);
    const defaultHours = Math.min(requestRemaining, teacherRemaining, activeRequest.hours);
    
    // Generate dates between activeRequest.date and activeRequest.endDate (or just date if no endDate)
    const startDate = new Date(activeRequest.date);
    const endDate = activeRequest.endDate ? new Date(activeRequest.endDate) : startDate;
    
    let reqSchedule = null;
    if (activeRequest.schedule) {
      try {
        reqSchedule = JSON.parse(activeRequest.schedule);
      } catch (e) {
        console.warn('Failed to parse activeRequest schedule', e);
      }
    }
    
    const dates = [];
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay();
      if (dayOfWeek !== 6 && dayOfWeek !== 7) { // Skip weekends
        // Calculate how many hours are already assigned for THIS specific date
        const dateStr = d.toISOString().split('T')[0];
        const assignmentsForDate = activeRequest.assignments?.filter((a: AssignmentData) => a.date.startsWith(dateStr) && a.status !== 'REJECTED') || [];
        const alreadyAssignedHours = assignmentsForDate.reduce((sum: number, a: AssignmentData) => sum + a.hours, 0);

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
        alert(`Fehler bei der Zuweisung: ${err.error || 'Unbekannter Fehler'}`);
        return;
      }
      
      setAssignModalOpen(false);
      setActiveRequest(null);
      setCandidates([]);
      loadData(); // refresh all
    } catch (error) {
      console.error('Assignment error:', error);
      alert('Netzwerkfehler bei der Zuweisung. Bitte versuchen Sie es erneut.');
    }
  };

  const toggleAbsence = async (teacher: TeacherData) => {
    const newStatus = teacher.status === 'ACTIVE' ? 'SICK' : 'ACTIVE';
    try {
      const res = await fetch(`/api/teachers/${teacher.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      });
      if (!res.ok) {
        const err = await res.json();
        alert(`Fehler: ${err.error || 'Status konnte nicht geändert werden'}`);
        return;
      }
      loadData();
    } catch (error) {
      console.error('Toggle absence error:', error);
      alert('Netzwerkfehler. Bitte versuchen Sie es erneut.');
    }
  };

  const handleAddTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAdding(true);
    try {
      const res = await fetch("/api/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newTeacher, schoolYear: selectedYear, schedule: newTeacher.isPartTime ? schedule : undefined })
      });
      if (res.ok) {
        setIsAddTeacherOpen(false);
        setNewTeacher({ ...newTeacher, name: "", address: "", isPartTime: false, email: "", password: "", phone: "", gender: "", schoolYear: selectedYear });
        loadData(selectedYear);
      } else {
        const error = await res.json();
        alert(`Fehler: ${error.error}`);
      }
    } finally {
      setIsAdding(false);
    }
  };

  const openArchive = async (teacher: TeacherData) => {
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
    } catch {
      alert("Fehler beim Anlegen der Schule.");
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
    } catch {
      alert("Fehler beim Aktualisieren.");
    }
  };

  const filteredTeachers = [...teachers]
    .filter(t => {
      const q = searchTeacherQuery.toLowerCase();
      return (t.name || "").toLowerCase().includes(q) || 
             (t.stammschule?.name || "").toLowerCase().includes(q) ||
             (t.qualifications || "").toLowerCase().includes(q);
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const filteredRequests = [...requests]
    .filter(r => {
      const q = searchRequestQuery.toLowerCase();
      return (r.school?.name || "").toLowerCase().includes(q) ||
             (r.priority || "").toLowerCase().includes(q);
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const sortedSchools = [...schools].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white/60 dark:bg-slate-900/65 p-6 rounded-2xl border border-white/20 dark:border-slate-800/40 backdrop-blur-xl shadow-lg relative overflow-hidden">
        {/* Glow accent */}
        <div className="absolute -top-10 -left-10 w-40 h-40 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10">
          <h1 className="text-4xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-primary to-chart-2 dark:from-primary dark:to-chart-2">Schulamt-Dashboard</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg">Bedarfsplanung, Einsatzsteuerung und Mobile Reserven verwalten.</p>
        </div>
        
        <div className="flex items-center gap-4 relative z-10">
          <div className="flex items-center gap-2 bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-1 shadow-sm">
            <span className="text-sm font-medium text-slate-500 pl-3">Schuljahr:</span>
            <Select value={selectedYear} onValueChange={(val) => val && setSelectedYear(val)}>
              <SelectTrigger className="w-[140px] border-0 shadow-none bg-transparent font-bold text-primary focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableYears.map(y => (
                  <SelectItem key={y} value={y}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button onClick={() => setIsAddTeacherOpen(true)} className="gap-2 bg-primary hover:bg-primary/95 text-primary-foreground shadow-md hover:shadow-primary/20 hover:scale-[1.01] transition-all duration-300 rounded-xl">
            <UserPlus className="h-4 w-4" /> Lehrkraft hinzufügen
          </Button>
          
          {selectedYear === getNextSchoolYear() && teachers.length === 0 && (
            <Button onClick={handleCopyTeachers} disabled={isCopying} variant="outline" className="gap-2 border-primary/20 text-primary hover:bg-primary/10 dark:border-primary/40 dark:text-primary dark:hover:bg-primary/20 rounded-xl hover:scale-[1.01] transition-all duration-300">
              <Copy className="h-4 w-4" /> {isCopying ? "Kopiere..." : "Lehrkräfte aus Vorjahr übernehmen"}
            </Button>
          )}
        </div>
      </div>

      {/* Premium Statistics Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div 
          onClick={() => setActiveKpiDetail('reserven')}
          className="glass-card p-6 rounded-2xl relative overflow-hidden group cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-primary/10 rounded-full blur-2xl group-hover:bg-primary/20 transition-colors pointer-events-none" />
          <div className="flex items-center gap-4">
            <div className="p-3 bg-primary/10 text-primary rounded-xl">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Mobile Reserven</p>
              <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1">
                {teachers.filter(t => t.status === 'ACTIVE').length} <span className="text-sm font-normal text-slate-400">/ {teachers.length} aktiv</span>
              </h3>
            </div>
          </div>
        </div>

        <div 
          onClick={() => setActiveKpiDetail('offene')}
          className="glass-card p-6 rounded-2xl relative overflow-hidden group cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/10 rounded-full blur-2xl group-hover:bg-amber-500/20 transition-colors pointer-events-none" />
          <div className="flex items-center gap-4">
            <div className="p-3 bg-amber-500/10 text-amber-500 rounded-xl">
              <AlertCircle className="h-6 w-6 animate-pulse" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Offene Bedarfe</p>
              <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1">
                {requests.filter(r => r.status === 'PENDING' || r.status === 'PARTIALLY_FILLED').length} <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/15 border border-amber-500/20 px-2 py-0.5 rounded-full ml-2">Aktion nötig</span>
              </h3>
            </div>
          </div>
        </div>

        <div 
          onClick={() => setActiveKpiDetail('besetzte')}
          className="glass-card p-6 rounded-2xl relative overflow-hidden group cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl group-hover:bg-emerald-500/20 transition-colors pointer-events-none" />
          <div className="flex items-center gap-4">
            <div className="p-3 bg-emerald-500/10 text-emerald-500 rounded-xl">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Besetzte Bedarfe</p>
              <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1">
                {requests.filter(r => r.status === 'FILLED').length} <span className="text-sm font-normal text-slate-400">erfolgreich</span>
              </h3>
            </div>
          </div>
        </div>

        <div 
          onClick={() => setActiveKpiDetail('krank')}
          className="glass-card p-6 rounded-2xl relative overflow-hidden group cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/10 rounded-full blur-2xl group-hover:bg-rose-500/20 transition-colors pointer-events-none" />
          <div className="flex items-center gap-4">
            <div className="p-3 bg-rose-500/10 text-rose-500 rounded-xl">
              <Activity className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Krankenstand</p>
              <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1">
                {teachers.filter(t => t.status === 'SICK').length} <span className="text-sm font-normal text-rose-500">Lehrkräfte</span>
              </h3>
            </div>
          </div>
        </div>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="gender">Geschlecht</Label>
                  <Select value={newTeacher.gender} onValueChange={v => setNewTeacher({...newTeacher, gender: v ?? ""})}>
                    <SelectTrigger><SelectValue placeholder="Bitte wählen" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FEMALE">Weiblich</SelectItem>
                      <SelectItem value="MALE">Männlich</SelectItem>
                      <SelectItem value="DIVERSE">Divers</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
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
                    {sortedSchools.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                <div className="space-y-2">
                  <Label htmlFor="edit-gender">Geschlecht</Label>
                  <Select value={editTeacherData.gender} onValueChange={v => setEditTeacherData({...editTeacherData, gender: v})}>
                    <SelectTrigger><SelectValue placeholder="Bitte wählen" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FEMALE">Weiblich</SelectItem>
                      <SelectItem value="MALE">Männlich</SelectItem>
                      <SelectItem value="DIVERSE">Divers</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                      {sortedSchools.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                          const newAssignments = assignData.assignments.map((a, i) => 
                            i === index ? { ...a, selected: e.target.checked } : a
                          );
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
                            const newAssignments = assignData.assignments.map((a, i) => 
                            i === index ? { ...a, hours: e.target.value } : a
                          );
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
            <DialogHeader className="flex flex-row items-center justify-between mr-8">
              <DialogTitle>Archiv: {archiveTeacher?.name}</DialogTitle>
              {archiveData.length > 0 && (
                <button className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-300" onClick={() => window.location.href = `/api/teachers/${archiveTeacher?.id}/export`}>
                  <FileDown className="h-4 w-4" /> Excel Export
                </button>
              )}
            </DialogHeader>
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 py-4">
              {archiveData.length === 0 ? (
                <div className="text-center py-8 text-slate-500">Keine bisherigen Einsätze gefunden.</div>
              ) : (
                <div className="space-y-3">
                  {archiveData.map((assignment: AssignmentData) => (
                    <div key={assignment.id} className="p-4 border rounded-xl bg-slate-50 dark:bg-slate-900/50">
                        <div className="font-bold mb-1">{assignment.request?.school.name}</div>
                        <div className="text-xs text-slate-500 mb-2">{assignment.request?.schedule ? 'Individueller Plan' : `ab ${assignment.request?.startHour}. Stunde (${assignment.request?.hours}h)`}</div>
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                  {sortedSchools.map(school => (
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
              try {
                const res = await fetch('/api/settings', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(settings)
                });
                if (!res.ok) {
                  alert('Einstellungen konnten nicht gespeichert werden.');
                } else {
                  setIsSettingsOpen(false);
                }
              } catch {
                alert('Netzwerkfehler beim Speichern der Einstellungen.');
              } finally {
                setIsSavingSettings(false);
              }
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

        {/* TEMPLATE SETTINGS DIALOG */}
        <Dialog open={isTemplateSettingsOpen} onOpenChange={setIsTemplateSettingsOpen}>
          <DialogContent className="max-w-[95vw] sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Briefvorlage konfigurieren</DialogTitle>
              <DialogDescription>
                Passen Sie die Texte, das Logo und die Unterschrift für die PDF-Einsatznachweise dieses Schulamtes an.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={async (e) => {
              e.preventDefault();
              setIsSavingTemplate(true);
              try {
                const res = await fetch('/api/schulamt/profile', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(templateSettings)
                });
                if (!res.ok) {
                  alert('Einstellungen konnten nicht gespeichert werden.');
                } else {
                  alert('Briefvorlage erfolgreich gespeichert!');
                  setIsTemplateSettingsOpen(false);
                }
              } catch {
                alert('Netzwerkfehler beim Speichern der Einstellungen.');
              } finally {
                setIsSavingTemplate(false);
              }
            }} className="space-y-4 py-2">
              
              <div className="space-y-2">
                <Label htmlFor="headerText">Briefkopf / Kopfzeile (Text)</Label>
                <Input 
                  id="headerText"
                  value={templateSettings.headerText} 
                  onChange={e => setTemplateSettings({...templateSettings, headerText: e.target.value})} 
                  placeholder="Staatliche Schulämter im Landkreis Unterallgäu..." 
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="returnAddress">Rücksendezeile (über Adressfenster)</Label>
                <Input 
                  id="returnAddress"
                  value={templateSettings.returnAddress} 
                  onChange={e => setTemplateSettings({...templateSettings, returnAddress: e.target.value})} 
                  placeholder="Staatliches Schulamt Unterallgäu - Kaiser-Max-Str. 1..." 
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Logo (rechter Seitenrand)</Label>
                  <div className="flex flex-col gap-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg p-3 justify-center items-center bg-slate-50 dark:bg-slate-900/50">
                    {templateSettings.logoUrl ? (
                      <div className="relative group max-h-[100px] overflow-hidden">
                        <img 
                          src={templateSettings.logoUrl} 
                          alt="Logo Vorschau" 
                          className="max-h-[80px] object-contain rounded"
                        />
                        <button 
                          type="button"
                          onClick={() => setTemplateSettings({...templateSettings, logoUrl: ""})}
                          className="absolute inset-0 bg-black/60 text-white text-xs opacity-0 group-hover:opacity-100 flex items-center justify-center rounded transition-opacity"
                        >
                          Entfernen
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">Kein Logo hochgeladen (Standard-Logo wird verwendet)</span>
                    )}
                    <label className="cursor-pointer bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs px-3 py-1.5 rounded font-medium shadow-sm transition-colors">
                      {isUploadingLogo ? 'Lade hoch...' : 'Datei auswählen'}
                      <input 
                        type="file" 
                        accept="image/png,image/jpeg" 
                        className="hidden" 
                        disabled={isUploadingLogo}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadLogo(file);
                        }}
                      />
                    </label>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Ort & Datum-Präfix</Label>
                  <Input 
                    value={templateSettings.city} 
                    onChange={e => setTemplateSettings({...templateSettings, city: e.target.value})} 
                    placeholder="Mindelheim" 
                    required
                  />
                  <span className="text-[10px] text-slate-400 block mt-1">Ausgabe im Brief als: "[Ort], den 07.06.2026"</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="contactAddress">Adresse (rechter Seitenrand)</Label>
                  <textarea 
                    id="contactAddress"
                    value={templateSettings.contactAddress} 
                    onChange={e => setTemplateSettings({...templateSettings, contactAddress: e.target.value})} 
                    placeholder="Memminger Str. 18&#10;87719 Mindelheim..." 
                    rows={4}
                    className="flex w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contactPerson">Kontaktkanäle (rechter Seitenrand)</Label>
                  <textarea 
                    id="contactPerson"
                    value={templateSettings.contactPerson} 
                    onChange={e => setTemplateSettings({...templateSettings, contactPerson: e.target.value})} 
                    placeholder="Tamara Schmidt&#10;Durchwahl: 08261 995 441..." 
                    rows={4}
                    className="flex w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-100 dark:border-slate-800 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="amtsleitungName">Name der Amtsleitung</Label>
                  <Input 
                    id="amtsleitungName"
                    value={templateSettings.amtsleitungName} 
                    onChange={e => setTemplateSettings({...templateSettings, amtsleitungName: e.target.value})} 
                    placeholder="Ursula Abt" 
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="amtsleitungTitle">Titel/Funktion der Amtsleitung</Label>
                  <Input 
                    id="amtsleitungTitle"
                    value={templateSettings.amtsleitungTitle} 
                    onChange={e => setTemplateSettings({...templateSettings, amtsleitungTitle: e.target.value})} 
                    placeholder="Schulamtsdirektorin" 
                    required
                  />
                </div>
              </div>

              <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-4">
                <Label>Handschriftliche Unterschrift</Label>
                <div className="flex flex-col gap-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg p-3 justify-center items-center bg-slate-50 dark:bg-slate-900/50">
                  {templateSettings.signatureUrl ? (
                    <div className="relative group max-h-[80px] overflow-hidden">
                      <img 
                        src={templateSettings.signatureUrl} 
                        alt="Unterschrift Vorschau" 
                        className="max-h-[60px] object-contain rounded"
                      />
                      <button 
                        type="button"
                        onClick={() => setTemplateSettings({...templateSettings, signatureUrl: ""})}
                        className="absolute inset-0 bg-black/60 text-white text-xs opacity-0 group-hover:opacity-100 flex items-center justify-center rounded transition-opacity"
                      >
                        Entfernen
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">Keine Unterschrift hochgeladen (Standard-Unterschrift wird verwendet)</span>
                  )}
                  <label className="cursor-pointer bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs px-3 py-1.5 rounded font-medium shadow-sm transition-colors">
                    {isUploadingSignature ? 'Lade hoch...' : 'Datei auswählen'}
                    <input 
                      type="file" 
                      accept="image/png,image/jpeg" 
                      className="hidden" 
                      disabled={isUploadingSignature}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadSignature(file);
                      }}
                    />
                  </label>
                </div>
              </div>

              <DialogFooter className="pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
                <Button type="button" variant="ghost" onClick={handleGeneratePreview} className="text-primary hover:bg-primary/10">Vorschau generieren</Button>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsTemplateSettingsOpen(false)}>Abbrechen</Button>
                  <Button type="submit" disabled={isSavingTemplate}>{isSavingTemplate ? 'Speichern...' : 'Vorlage Speichern'}</Button>
                </div>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

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
          <Card id="matching-engine" className="shadow-xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-slate-200/60 dark:border-slate-800/60 transition-all">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-xl">Bedarfsübersicht & Matching Engine</CardTitle>
                <CardDescription>Wählen Sie eine ausstehende Anfrage, um die besten Kandidaten zu ermitteln.</CardDescription>
              </div>
              <Input 
                placeholder="Suche (Schule, Grund)..." 
                value={searchRequestQuery}
                onChange={e => setSearchRequestQuery(e.target.value)}
                className="w-64 bg-white/50 dark:bg-slate-900/50 border-slate-200/60 dark:border-slate-800/60 rounded-xl focus-visible:ring-primary focus-visible:border-primary"
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
                          <span className="font-bold">{req.assignments?.filter((a: AssignmentData) => a.status !== 'REJECTED').reduce((sum: number, a: AssignmentData) => sum + a.hours, 0) || 0} / {req.weeklyHours} Std.</span>
                        </div>
                      )}
                      {req.assignments && req.assignments.length > 0 && (
                        <div className="mb-2 space-y-1">
                          {req.assignments.map((assign: AssignmentData) => {
                            const d = new Date(assign.date);
                            const dayName = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()];
                            return (
                              <div key={assign.id} className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 flex items-center justify-between gap-1 w-full bg-emerald-50 dark:bg-emerald-900/20 p-1.5 rounded">
                                <div className="flex-1">👤 {assign.teacher?.name} ({dayName}, {d.toLocaleDateString('de-DE')} - {assign.hours}h)
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
                    <div className="space-y-4">
                      {candidates.slice(0, 5).map((candidate, idx) => {
                        return (
                          <div 
                            key={candidate.id} 
                            className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border border-slate-200/60 dark:border-slate-800/60 rounded-2xl bg-white/70 dark:bg-slate-900/50 backdrop-blur-sm hover:bg-white dark:hover:bg-slate-900 shadow-sm hover:shadow-md hover:scale-[1.01] hover:border-primary/20 dark:hover:border-primary/20 transition-all duration-300 gap-4"
                          >
                            <div className="flex items-center gap-4 w-full sm:w-auto">
                              <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-start mb-2">
                                  <div className="font-bold text-lg text-slate-800 dark:text-slate-100">{candidate.name}</div>
                                  <div className="text-right">
                                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800">
                                      {(candidate.matchScore || 0).toFixed(0)} Pkt
                                    </Badge>
                                    <div className="text-[10px] text-slate-400 mt-1">{(candidate.distanceToSchool || 0).toFixed(1)} km entfernt</div>
                                  </div>
                                </div>

                                <div className="text-sm text-slate-500 dark:text-slate-400 mt-2 flex flex-wrap gap-2.5 items-center">
                                  <span className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300">
                                    <div className="text-slate-400 flex items-center gap-1">
                                      <Navigation className="h-3 w-3" /> {(candidate.distanceToSchool || 0).toFixed(1)} km
                                    </div>
                                  </span>
                                  <span className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300">
                                    <Clock className="h-3.5 w-3.5 text-chart-2 shrink-0" />
                                    {candidate.assignedHours}/{candidate.maxWeeklyHours}h
                                  </span>
                                  <span className="text-[11px] bg-slate-100 dark:bg-slate-800/80 px-2 py-0.5 rounded-lg text-slate-500 dark:text-slate-400 font-medium">
                                    {candidate.qualifications}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <Button 
                              onClick={() => openAssignModal(candidate)}
                              className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-md hover:shadow-primary/20 transition-all active:scale-95 rounded-xl px-5 h-10 shrink-0"
                            >
                              Zuweisen
                            </Button>
                          </div>
                        );
                      })}
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
                        {req.assignments && req.assignments.length > 0 && (
                          <div className="mb-2 space-y-1 mt-3 border-t border-slate-200 dark:border-slate-700 pt-2">
                            {req.assignments.map((assign: AssignmentData) => {
                              const d = new Date(assign.date);
                              const dayName = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()];
                              return (
                                <div key={assign.id} className="text-[11px] font-medium text-slate-700 dark:text-slate-400 flex items-center justify-between gap-1 w-full bg-slate-100 dark:bg-slate-800 p-1.5 rounded">
                                  <div className="flex-1 truncate">👤 <span className="font-semibold">{assign.teacher?.name}</span> ({dayName}, {d.toLocaleDateString('de-DE')} - {assign.hours}h)
                                    <span className={`ml-2 px-1.5 py-0.5 rounded text-[9px] uppercase ${assign.status === 'PENDING' ? 'bg-amber-100 text-amber-800' : assign.status === 'ACCEPTED' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>{assign.status === 'PENDING' ? 'Wartet' : assign.status === 'ACCEPTED' ? 'Bestätigt' : 'Abgelehnt'}</span>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        window.open(`/api/assignments/${assign.id}/pdf`, '_blank');
                                      }}
                                      className="text-indigo-650 hover:text-indigo-850 dark:text-indigo-400 dark:hover:text-indigo-300 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/30 px-1.5 py-0.5 rounded transition-colors flex items-center gap-0.5"
                                      title="Abordnungsschreiben (PDF) herunterladen"
                                    >
                                      <FileDown className="h-3 w-3" /> PDF
                                    </button>
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
                                </div>
                              );
                            })}
                          </div>
                        )}
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
                className="bg-white/50 dark:bg-slate-900/50 border-slate-200/60 dark:border-slate-800/60 rounded-xl focus-visible:ring-primary focus-visible:border-primary"
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
                onClick={async () => {
                  try {
                    const r = await fetch(`/api/settings?t=${Date.now()}`, { cache: 'no-store' });
                    if (!r.ok) throw new Error('Failed');
                    const data = await r.json();
                    setSettings({
                      smtpHost: data.smtpHost || "",
                      smtpUser: data.smtpUser || "",
                      smtpPass: data.smtpPass || ""
                    });
                    setIsSettingsOpen(true);
                  } catch (e) {
                    alert('Einstellungen konnten nicht geladen werden.');
                  }
                }}
              >
                <Settings className="h-4 w-4" /> Mail-API konfigurieren
              </Button>
              <Button 
                variant="outline" 
                className="w-full justify-start gap-2 bg-violet-50 hover:bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:border-violet-900/50 dark:text-violet-300 dark:hover:bg-violet-900/50 shadow-sm"
                onClick={async () => {
                  try {
                    const r = await fetch(`/api/schulamt/profile?t=${Date.now()}`, { cache: 'no-store' });
                    if (!r.ok) throw new Error('Failed');
                    const data = await r.json();
                    setTemplateSettings({
                      headerText: data.headerText || "",
                      returnAddress: data.returnAddress || "",
                      logoUrl: data.logoUrl || "",
                      contactAddress: data.contactAddress || "",
                      contactPerson: data.contactPerson || "",
                      city: data.city || "",
                      amtsleitungName: data.amtsleitungName || "",
                      amtsleitungTitle: data.amtsleitungTitle || "",
                      signatureUrl: data.signatureUrl || ""
                    });
                    setIsTemplateSettingsOpen(true);
                  } catch (e) {
                    alert('Briefvorlage konnte nicht geladen werden.');
                  }
                }}
              >
                <FileText className="h-4 w-4" /> Briefvorlage konfigurieren
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

      <Dialog open={activeKpiDetail !== null} onOpenChange={(open) => !open && setActiveKpiDetail(null)}>
        <DialogContent className="w-[95vw] sm:max-w-[90vw] md:max-w-[85vw] lg:max-w-[80vw] xl:max-w-[75vw] max-h-[90vh] overflow-y-auto rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200/80 dark:border-slate-800/80 shadow-2xl p-6">
          <DialogHeader className="border-b border-slate-100 dark:border-slate-800 pb-4">
            <DialogTitle className="text-2xl font-bold flex items-center gap-3 text-slate-800 dark:text-slate-100">
              {activeKpiDetail === 'reserven' && (
                <>
                  <div className="p-2 bg-primary/10 text-primary rounded-xl">
                    <Users className="h-6 w-6" />
                  </div>
                  Mobile Reserven Übersicht ({teachers.length})
                </>
              )}
              {activeKpiDetail === 'offene' && (
                <>
                  <div className="p-2 bg-amber-500/10 text-amber-500 rounded-xl">
                    <AlertCircle className="h-6 w-6" />
                  </div>
                  Offene Bedarfe ({requests.filter(r => r.status === 'PENDING' || r.status === 'PARTIALLY_FILLED').length})
                </>
              )}
              {activeKpiDetail === 'besetzte' && (
                <>
                  <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-xl">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  Besetzte Bedarfe ({requests.filter(r => r.status === 'FILLED').length})
                </>
              )}
              {activeKpiDetail === 'krank' && (
                <>
                  <div className="p-2 bg-rose-500/10 text-rose-500 rounded-xl">
                    <Activity className="h-6 w-6" />
                  </div>
                  Krankenstand - Ausfälle ({teachers.filter(t => t.status === 'SICK').length})
                </>
              )}
            </DialogTitle>
            <DialogDescription className="text-slate-500 mt-2">
              {activeKpiDetail === 'reserven' && "Auflistung aller registrierten mobilen Reserven für das aktive Schuljahr und deren aktuellen Bereitschaftsstatus."}
              {activeKpiDetail === 'offene' && "Hier sehen Sie alle offenen oder teilweise besetzten Bedarfe der Schulen, für die Vertretungslehrkräfte gesucht werden."}
              {activeKpiDetail === 'besetzte' && "Übersicht über alle erfolgreich vermittelten und besetzten Bedarfe."}
              {activeKpiDetail === 'krank' && "Auflistung aller aktuell krankgemeldeten Lehrkräfte, die vorübergehend nicht zur Verfügung stehen."}
            </DialogDescription>
          </DialogHeader>

          <div className="py-6">
            {activeKpiDetail === 'reserven' && (
              <div className="border border-slate-150 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm bg-white dark:bg-slate-950">
                <Table>
                  <TableHeader className="bg-slate-50 dark:bg-slate-900/50">
                    <TableRow>
                      <TableHead className="font-semibold">Name</TableHead>
                      <TableHead className="font-semibold">Stammschule</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                      <TableHead className="font-semibold text-right">Fächer / Qualifikationen</TableHead>
                      <TableHead className="font-semibold text-right">Max. Stunden</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {teachers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-slate-500 py-6 italic">
                          Keine Lehrkräfte vorhanden
                        </TableCell>
                      </TableRow>
                    ) : (
                      teachers.map((teacher) => (
                        <TableRow key={teacher.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20">
                          <TableCell className="font-bold text-slate-800 dark:text-slate-200">{teacher.name}</TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-400">{teacher.stammschule?.name || "Keine Stammschule"}</TableCell>
                          <TableCell>
                            <Badge className={
                              teacher.status === 'ACTIVE' ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 dark:bg-emerald-950/30' :
                              teacher.status === 'SICK' ? 'bg-rose-500/10 text-rose-600 border border-rose-500/20 dark:bg-rose-950/30' :
                              'bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400 border border-slate-200'
                            }>
                              {teacher.status === 'ACTIVE' ? 'Aktiv' : teacher.status === 'SICK' ? 'Krank' : 'Beurlaubt'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-xs font-mono text-slate-500">{teacher.qualifications}</TableCell>
                          <TableCell className="text-right font-medium text-slate-800 dark:text-slate-200">{teacher.maxWeeklyHours} Std.</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {activeKpiDetail === 'offene' && (
              <div className="border border-slate-150 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm bg-white dark:bg-slate-950">
                <Table>
                  <TableHeader className="bg-slate-50 dark:bg-slate-900/50">
                    <TableRow>
                      <TableHead className="font-semibold">Schule</TableHead>
                      <TableHead className="font-semibold">Datum / Zeitraum</TableHead>
                      <TableHead className="font-semibold">Bedarfsstunden</TableHead>
                      <TableHead className="font-semibold">Priorität</TableHead>
                      <TableHead className="font-semibold">Qualifikation</TableHead>
                      <TableHead className="font-semibold text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.filter(r => r.status === 'PENDING' || r.status === 'PARTIALLY_FILLED').length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-slate-500 py-6 italic">
                          Keine offenen Bedarfe vorhanden
                        </TableCell>
                      </TableRow>
                    ) : (
                      requests.filter(r => r.status === 'PENDING' || r.status === 'PARTIALLY_FILLED').map((req) => {
                        const d = new Date(req.date);
                        const dayName = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()];
                        return (
                          <TableRow 
                            key={req.id} 
                            onClick={() => handleSelectRequestFromKpi(req)}
                            className="hover:bg-slate-100/80 dark:hover:bg-slate-900/60 cursor-pointer transition-colors"
                            title="Klicken, um diesen Bedarf im Matching-System auszuwählen"
                          >
                            <TableCell className="font-bold text-slate-800 dark:text-slate-200">{req.school?.name}</TableCell>
                            <TableCell className="text-slate-600 dark:text-slate-400">
                              {dayName}, {d.toLocaleDateString('de-DE')} {req.endDate ? ` bis ${new Date(req.endDate).toLocaleDateString('de-DE')}` : ''}
                            </TableCell>
                            <TableCell className="font-medium text-slate-800 dark:text-slate-200">
                              {req.weeklyHours > req.hours ? `${req.weeklyHours} Std. gesamt (${req.hours} Std./Tag)` : `${req.hours} Std.`}
                            </TableCell>
                            <TableCell>
                              <Badge className={
                                req.priority === 'ERKRANKUNG' ? 'bg-red-500/10 text-red-600 border border-red-500/20 dark:bg-red-950/30' :
                                req.priority === 'FORTBILDUNG' ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20 dark:bg-amber-950/30' :
                                'bg-slate-100 text-slate-600 dark:bg-slate-900 border border-slate-200'
                              }>
                                {req.priority}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-slate-500">{req.qualifications}</TableCell>
                            <TableCell className="text-right">
                              <Badge className={
                                req.status === 'PARTIALLY_FILLED' ? 'bg-blue-500/10 text-blue-600 border border-blue-500/20 dark:bg-blue-950/30' :
                                'bg-amber-500/10 text-amber-600 border border-amber-500/20 dark:bg-amber-950/30'
                              }>
                                {req.status === 'PARTIALLY_FILLED' ? 'Teilweise besetzt' : 'Aktion nötig'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {activeKpiDetail === 'besetzte' && (
              <div className="border border-slate-150 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm bg-white dark:bg-slate-950">
                <Table>
                  <TableHeader className="bg-slate-50 dark:bg-slate-900/50">
                    <TableRow>
                      <TableHead className="font-semibold">Schule</TableHead>
                      <TableHead className="font-semibold">Datum / Tag</TableHead>
                      <TableHead className="font-semibold">Stunden</TableHead>
                      <TableHead className="font-semibold text-right">Zugeordnete Vertretung</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.filter(r => r.status === 'FILLED').length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-slate-500 py-6 italic">
                          Keine besetzten Bedarfe vorhanden
                        </TableCell>
                      </TableRow>
                    ) : (
                      requests.filter(r => r.status === 'FILLED').map((req) => {
                        const d = new Date(req.date);
                        const dayName = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()];
                        return (
                          <TableRow 
                            key={req.id} 
                            onClick={() => handleSelectRequestFromKpi(req)}
                            className="hover:bg-slate-100/80 dark:hover:bg-slate-900/60 cursor-pointer transition-colors"
                            title="Klicken, um diesen Bedarf im Matching-System auszuwählen"
                          >
                            <TableCell className="font-bold text-slate-800 dark:text-slate-200">{req.school?.name}</TableCell>
                            <TableCell className="text-slate-600 dark:text-slate-400">
                              {dayName}, {d.toLocaleDateString('de-DE')}
                            </TableCell>
                            <TableCell className="font-medium text-slate-850 dark:text-slate-200">
                              {req.weeklyHours > req.hours ? `${req.weeklyHours} Std.` : `${req.hours} Std.`}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex flex-col items-end gap-1">
                                {req.assignments && req.assignments.length > 0 ? (
                                  req.assignments.map(a => (
                                    <div key={a.id} className="flex items-center gap-1.5 justify-end">
                                      <Badge className="bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 dark:bg-emerald-950/30 flex items-center gap-1 w-fit">
                                        <span>👤 {a.teacher?.name || 'Lehrkraft'} ({a.hours}h)</span>
                                      </Badge>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          window.open(`/api/assignments/${a.id}/pdf`, '_blank');
                                        }}
                                        className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-indigo-600 rounded transition-colors"
                                        title="Abordnungsschreiben (PDF) herunterladen"
                                      >
                                        <FileDown className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  ))
                                ) : (
                                  <span className="text-xs text-slate-400 italic">Keine Zuweisung</span>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {activeKpiDetail === 'krank' && (
              <div className="border border-slate-150 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm bg-white dark:bg-slate-950">
                <Table>
                  <TableHeader className="bg-slate-50 dark:bg-slate-900/50">
                    <TableRow>
                      <TableHead className="font-semibold">Name</TableHead>
                      <TableHead className="font-semibold">Stammschule</TableHead>
                      <TableHead className="font-semibold">E-Mail</TableHead>
                      <TableHead className="font-semibold text-right">Telefon</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {teachers.filter(t => t.status === 'SICK').length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-emerald-600 dark:text-emerald-400 font-bold py-8">
                          🎉 Aktuell sind keine Lehrkräfte krankgemeldet!
                        </TableCell>
                      </TableRow>
                    ) : (
                      teachers.filter(t => t.status === 'SICK').map((teacher) => (
                        <TableRow key={teacher.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20">
                          <TableCell className="font-bold text-rose-600 dark:text-rose-400">{teacher.name}</TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-400">{teacher.stammschule?.name || "Keine Stammschule"}</TableCell>
                          <TableCell className="text-slate-650 dark:text-slate-350">{teacher.email || "-"}</TableCell>
                          <TableCell className="text-right text-slate-650 dark:text-slate-350">{teacher.phone || "-"}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <DialogFooter className="border-t border-slate-100 dark:border-slate-800 pt-4">
            <Button variant="outline" onClick={() => setActiveKpiDetail(null)} className="rounded-xl shadow-sm">
              Schließen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
