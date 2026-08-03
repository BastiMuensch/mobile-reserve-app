"use client";

import { useState } from "react";
import { useSchulamtData } from "@/hooks/useSchulamtData";
import { useAuth } from "./AuthProvider";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";

import { ManualAssignModal } from "./schulamt/dialogs/ManualAssignModal";
import { MonthlyExportDialog } from "./schulamt/dialogs/MonthlyExportDialog";
import { LeavePeriodDialog } from "./schulamt/dialogs/LeavePeriodDialog";
import { TeacherData, RequestData, AssignmentData, NewTeacherForm, EditTeacherForm, NewSchoolForm, SystemSettingsForm, TemplateSettingsForm, AssignFormData } from "@/types/models";
import { DashboardHeader } from "./schulamt/DashboardHeader";
import { RequestsList } from "./schulamt/RequestsList";
import { TeachersList } from "./schulamt/TeachersList";
import { SystemSettings } from "./schulamt/SystemSettings";
import { SchulamtMapSection } from "./schulamt/SchulamtMapSection";
import { Statistics } from "./schulamt/Statistics";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PendingTeachersList } from "./schulamt/PendingTeachersList";

import { KpiDetailDialog } from "./schulamt/dialogs/KpiDetailDialog";
import { AddTeacherDialog } from "./schulamt/dialogs/AddTeacherDialog";
import { EditTeacherDialog } from "./schulamt/dialogs/EditTeacherDialog";
import { AssignModal } from "./schulamt/dialogs/AssignModal";
import { ArchiveDialog } from "./schulamt/dialogs/ArchiveDialog";
import { SchoolManagerDialog } from "./schulamt/dialogs/SchoolManagerDialog";
import { TemplateSettingsDialog } from "./schulamt/dialogs/TemplateSettingsDialog";
import { getNextSchoolYear, getCurrentSchoolYear } from "@/lib/schoolYear";

export function SchulamtDashboard() {
  const { user } = useAuth();
  const data = useSchulamtData();
  const { toast } = useToast();
  const confirm = useConfirm();

  // States
  const [activeRequest, setActiveRequest] = useState<RequestData | null>(null);
  const [candidates, setCandidates] = useState<TeacherData[]>([]);

  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [manualAssignModalOpen, setManualAssignModalOpen] = useState(false);
  const [assignData, setAssignData] = useState<AssignFormData | null>(null);
  
  const [isAddTeacherOpen, setIsAddTeacherOpen] = useState(false);
  const [activeKpiDetail, setActiveKpiDetail] = useState<'reserven' | 'offene' | 'besetzte' | 'unavailable' | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDownloadingBackup, setIsDownloadingBackup] = useState(false);
  const [newTeacher, setNewTeacher] = useState<NewTeacherForm>({
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
    schoolYear: data.selectedYear
  });

  const [isEditTeacherOpen, setIsEditTeacherOpen] = useState(false);
  const [isEditingTeacher, setIsEditingTeacher] = useState(false);
  const [editTeacherData, setEditTeacherData] = useState<EditTeacherForm | null>(null);
  const [editSchedule, setEditSchedule] = useState<Record<string, number[]>>({});

  const [schedule, setSchedule] = useState<Record<string, number[]>>({
    "1": [1,2,3,4,5,6,7,8,9,10],
    "2": [1,2,3,4,5,6,7,8,9,10],
    "3": [1,2,3,4,5,6,7,8,9,10],
    "4": [1,2,3,4,5,6,7,8,9,10],
    "5": [1,2,3,4,5,6,7,8,9,10],
  });

  const [focusedLocation, setFocusedLocation] = useState<{lat: number, lng: number} | null>(null);
  const [archiveTeacher, setArchiveTeacher] = useState<TeacherData | null>(null);
  const [archiveData, setArchiveData] = useState<AssignmentData[]>([]);

  const [exportTeacher, setExportTeacher] = useState<TeacherData | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [leaveTeacher, setLeaveTeacher] = useState<TeacherData | null>(null);
  const [isLeaveOpen, setIsLeaveOpen] = useState(false);

  const [isSchoolManagerOpen, setIsSchoolManagerOpen] = useState(false);
  const [isAddingSchool, setIsAddingSchool] = useState(false);
  const [newSchool, setNewSchool] = useState<NewSchoolForm>({
    name: "", address: "", type: "GRUNDSCHULE", email: "", password: ""
  });
  const [editingPasswordId, setEditingPasswordId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");

  const [isTemplateSettingsOpen, setIsTemplateSettingsOpen] = useState(false);
  const [templateSettings, setTemplateSettings] = useState<TemplateSettingsForm>({
    headerText: "", returnAddress: "", logoUrl: "", contactAddress: "",
    contactPerson: "", city: "", amtsleitungName: "", amtsleitungTitle: "", signatureUrl: ""
  });
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingSignature, setIsUploadingSignature] = useState(false);
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);
  const [isCopying, setIsCopying] = useState(false);

  // Handlers
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
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (error) {
      console.error(error);
      toast({ variant: "error", title: "Vorschau konnte nicht generiert werden." });
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
        data.loadData();
      } else {
        const err = await res.json();
        toast({ variant: "error", title: `Fehler: ${err.error}` });
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
      address: "",
      isPartTime: teacher.isPartTime,
      email: teacher.email || "",
      password: "",
      phone: teacher.phone || "",
      gender: teacher.gender || ""
    });
    let parsedSchedule = {
      "1": [1,2,3,4,5,6,7,8,9,10], "2": [1,2,3,4,5,6,7,8,9,10],
      "3": [1,2,3,4,5,6,7,8,9,10], "4": [1,2,3,4,5,6,7,8,9,10],
      "5": [1,2,3,4,5,6,7,8,9,10],
    };
    if (teacher.schedule) {
      try { parsedSchedule = JSON.parse(teacher.schedule); } catch (e) { console.warn('Failed to parse teacher schedule', e); }
    }
    setEditSchedule(parsedSchedule);
    setIsEditTeacherOpen(true);
  };

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

  const handleUploadLogo = async (file: File) => {
    setIsUploadingLogo(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const respData = await res.json();
      if (respData.success) {
        setTemplateSettings(prev => ({ ...prev, logoUrl: respData.url }));
      } else {
        toast({ variant: "error", title: "Upload fehlgeschlagen: " + (respData.error || "Unbekannter Fehler") });
      }
    } catch (e) {
      toast({ variant: "error", title: "Fehler beim Upload des Logos." });
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
      const respData = await res.json();
      if (respData.success) {
        setTemplateSettings(prev => ({ ...prev, signatureUrl: respData.url }));
      } else {
        toast({ variant: "error", title: "Upload fehlgeschlagen: " + (respData.error || "Unbekannter Fehler") });
      }
    } catch (e) {
      toast({ variant: "error", title: "Fehler beim Upload der Unterschrift." });
    } finally {
      setIsUploadingSignature(false);
    }
  };

  const handleRestoreBackup = async (file: File) => {
    const confirmed1 = await confirm({
      title: "Backup wirklich einspielen?",
      description: "ACHTUNG: Wenn Sie ein Backup einspielen, werden ALLE aktuellen Daten dieses Schulamts gelöscht und mit dem Stand des Backups überschrieben! Fortfahren?",
      confirmLabel: "Fortfahren",
      variant: "destructive"
    });
    if (!confirmed1) return;
    const confirmed2 = await confirm({
      title: "Wirklich ganz sicher?",
      description: "Sind Sie wirklich GANZ SICHER? Dies kann nicht rückgängig gemacht werden!",
      confirmLabel: "Ja, einspielen",
      variant: "destructive"
    });
    if (!confirmed2) return;

    setIsRestoringBackup(true);
    try {
      const text = await file.text();
      const jsonData = JSON.parse(text);

      const res = await fetch("/api/backup/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(jsonData)
      });

      if (res.ok) {
        toast({ variant: "success", title: "Backup erfolgreich wiederhergestellt! Die Seite wird neu geladen." });
        window.location.reload();
      } else {
        const err = await res.json();
        toast({ variant: "error", title: "Fehler bei der Wiederherstellung: " + (err.error || "Unbekannter Fehler") });
      }
    } catch (e) {
      toast({ variant: "error", title: "Fehler beim Verarbeiten der Backup-Datei. Ist es eine gültige JSON-Datei?" });
    } finally {
      setIsRestoringBackup(false);
    }
  };

  const handleCopyTeachers = async () => {
    if (data.selectedYear !== getNextSchoolYear()) {
      toast({ variant: "error", title: "Sie können Lehrkräfte nur in das nächste Schuljahr kopieren. Bitte wählen Sie oben das nächste Schuljahr aus." });
      return;
    }
    const sourceYear = getCurrentSchoolYear();
    const confirmed = await confirm({
      title: "Lehrkräfte kopieren?",
      description: `Möchten Sie alle Lehrkräfte aus dem aktuellen Schuljahr (${sourceYear}) in das nächste Schuljahr (${data.selectedYear}) kopieren?`,
      confirmLabel: "Kopieren"
    });
    if (!confirmed) return;

    setIsCopying(true);
    try {
      const res = await fetch("/api/teachers/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceYear, targetYear: data.selectedYear })
      });
      const respData = await res.json();
      if (res.ok) {
        toast({ variant: "success", title: `${respData.copied} Lehrkräfte wurden erfolgreich kopiert!` });
        data.loadData(data.selectedYear);
      } else {
        toast({ variant: "error", title: respData.error || "Fehler beim Kopieren." });
      }
    } catch {
      toast({ variant: "error", title: "Ein Fehler ist aufgetreten." });
    } finally {
      setIsCopying(false);
    }
  };

  const handleMatch = async (request: RequestData) => {
    const res = await fetch(`/api/match/${request.id}`);
    if (res.ok) {
      const result = await res.json();
      setActiveRequest(result.request);
      setCandidates(result.candidates);
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
    
    const currentAssignedHours = activeRequest.assignments?.filter((a: AssignmentData) => a.status !== 'REJECTED').reduce((sum: number, a: AssignmentData) => sum + a.hours, 0) || 0;
    const requestRemaining = activeRequest.weeklyHours - currentAssignedHours;
    const teacherRemaining = candidate.maxWeeklyHours - (candidate.assignedHours || 0);
    const defaultHours = Math.min(requestRemaining, teacherRemaining, activeRequest.hours);
    
    const startDate = new Date(activeRequest.date);
    const endDate = activeRequest.endDate ? new Date(activeRequest.endDate) : startDate;
    
    let reqSchedule: Record<string, number[]> | null = null;
    if (activeRequest.schedule) {
      try { reqSchedule = JSON.parse(activeRequest.schedule); } catch (e) { console.warn('Failed to parse activeRequest schedule', e); }
    }
    
    const dates = [];
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay();
      if (dayOfWeek !== 6 && dayOfWeek !== 7) { 
        const dateStr = d.toISOString().split('T')[0];
        const assignmentsForDate = activeRequest.assignments?.filter((a: AssignmentData) => a.date.startsWith(dateStr) && a.status !== 'REJECTED') || [];
        const alreadyAssignedHours = assignmentsForDate.reduce((sum: number, a: AssignmentData) => sum + a.hours, 0);

        let hoursForDay = defaultHours;
        let isSelected = true;
        
        if (reqSchedule) {
           const requestedHours = reqSchedule[dayOfWeek.toString()]?.length || 0;
           const remainingForDay = requestedHours - alreadyAssignedHours;
           if (remainingForDay <= 0) continue;
           hoursForDay = Math.min(remainingForDay, teacherRemaining);
           isSelected = hoursForDay > 0;
        } else {
           const remainingForDay = activeRequest.hours - alreadyAssignedHours;
           if (remainingForDay <= 0) continue;
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
      data.loadData();
    } catch (error) {
      console.error('Assignment error:', error);
      toast({ variant: "error", title: "Netzwerkfehler bei der Zuweisung. Bitte versuchen Sie es erneut." });
    } finally {
      setIsAssigning(false);
    }
  };

  const toggleAbsence = async (teacher: TeacherData) => {
    const newStatus = teacher.status === 'ACTIVE' ? 'UNAVAILABLE' : 'ACTIVE';
    try {
      const res = await fetch(`/api/teachers/${teacher.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      });
      if (!res.ok) {
        const err = await res.json();
        toast({ variant: "error", title: `Fehler: ${err.error || 'Status konnte nicht geändert werden'}` });
        return;
      }
      data.loadData();
    } catch (error) {
      console.error('Toggle absence error:', error);
      toast({ variant: "error", title: "Netzwerkfehler. Bitte versuchen Sie es erneut." });
    }
  };

  const handleAddTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAdding(true);
    try {
      const res = await fetch("/api/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newTeacher, schoolYear: data.selectedYear, schedule: newTeacher.isPartTime ? schedule : undefined })
      });
      if (res.ok) {
        setIsAddTeacherOpen(false);
        setNewTeacher({ ...newTeacher, name: "", address: "", isPartTime: false, email: "", password: "", phone: "", gender: "", schoolYear: data.selectedYear });
        data.loadData(data.selectedYear);
      } else {
        const error = await res.json();
        toast({ variant: "error", title: `Fehler: ${error.error}` });
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

  const openMonthlyExport = (teacher: TeacherData) => {
    setExportTeacher(teacher);
    setIsExportOpen(true);
  };

  const openLeavePeriods = (teacher: TeacherData) => {
    setLeaveTeacher(teacher);
    setIsLeaveOpen(true);
  };

  const handleApprovePending = async (id: string) => {
    try {
      const res = await fetch(`/api/teachers/${id}/approve`, { method: "PATCH" });
      if (res.ok) {
        data.loadData();
      } else {
        toast({ variant: "error", title: "Fehler bei der Freigabe." });
      }
    } catch (e) {
      toast({ variant: "error", title: "Netzwerkfehler." });
    }
  };

  const handleRejectPending = async (id: string) => {
    const confirmed = await confirm({
      title: "Registrierung ablehnen?",
      description: "Möchten Sie diese Registrierung wirklich dauerhaft ablehnen und löschen?",
      confirmLabel: "Ablehnen",
      variant: "destructive"
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/teachers/${id}`, { method: "DELETE" });
      if (res.ok) {
        data.loadData();
      } else {
        toast({ variant: "error", title: "Fehler beim Ablehnen." });
      }
    } catch (e) {
      toast({ variant: "error", title: "Netzwerkfehler." });
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
        data.loadData();
      } else {
        toast({ variant: "error", title: "Fehler beim Anlegen der Schule." });
      }
    } catch {
      toast({ variant: "error", title: "Fehler beim Anlegen der Schule." });
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
        toast({ variant: "success", title: "Zugangsdaten erfolgreich aktualisiert." });
        data.loadData();
      } else {
        toast({ variant: "error", title: "Fehler beim Aktualisieren der Zugangsdaten." });
      }
    } catch {
      toast({ variant: "error", title: "Fehler beim Aktualisieren der Zugangsdaten." });
    }
  };

  const handleDownloadBackup = async () => {
    setIsDownloadingBackup(true);
    try {
      const res = await fetch("/api/backup/export");
      if (!res.ok) throw new Error("Export fehlgeschlagen");
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `schulamt_backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      
      // Refresh profile data to hide banner
      data.loadData();
    } catch (e) {
      toast({ variant: "error", title: "Fehler beim Backup-Download." });
    } finally {
      setIsDownloadingBackup(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {data.profile && (!data.profile.lastBackupDate || new Date(data.profile.lastBackupDate).toDateString() !== new Date().toDateString()) && (
        <div className="bg-red-50 dark:bg-red-500/10 border-l-4 border-red-500 dark:border-red-500/60 p-4 rounded-r-md flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-sm mb-6">
          <div>
            <h3 className="text-red-800 dark:text-red-300 font-bold text-lg">⚠️ Tägliches Backup ausstehend!</h3>
            <p className="text-red-700 dark:text-red-300/90 text-sm mt-1">Aus DSGVO-Gründen und zur Datensicherheit muss täglich ein lokales Backup der Datenbank heruntergeladen werden. Bitte führen Sie das Backup jetzt aus.</p>
          </div>
          <button
            onClick={handleDownloadBackup}
            disabled={isDownloadingBackup}
            className="bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500 text-white font-medium px-4 py-2 rounded-md transition-colors whitespace-nowrap disabled:opacity-50"
          >
            {isDownloadingBackup ? 'Herunterladen...' : 'Backup jetzt herunterladen'}
          </button>
        </div>
      )}

      <DashboardHeader 
        selectedYear={data.selectedYear}
        setSelectedYear={data.setSelectedYear}
        availableYears={data.availableYears}
        teachers={data.teachers}
        requests={data.requests}
        schulamtId={user?.id}
        setIsAddTeacherOpen={setIsAddTeacherOpen}
        handleCopyTeachers={handleCopyTeachers}
        isCopying={isCopying}
        setActiveKpiDetail={setActiveKpiDetail}
        activeTeacherCount={data.activeTeacherCount}
        openRequestCount={data.openRequestCount}
        filledRequestCount={data.filledRequestCount}
        sickTeacherCount={data.sickTeacherCount}
      />

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="mb-6 grid w-full max-w-lg grid-cols-3">
          <TabsTrigger value="overview">Übersicht</TabsTrigger>
          <TabsTrigger value="pending" className="relative">
            Warteraum
            {data.teachers.filter(t => t.status === 'PENDING').length > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center animate-pulse">
                {data.teachers.filter(t => t.status === 'PENDING').length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="statistics">Statistiken</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
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
                loadData={data.loadData}
              />
            </div>

            <div className="lg:col-span-1 space-y-6">
              <TeachersList 
                filteredTeachers={data.filteredTeachers.filter(t => t.status !== 'PENDING')}
                searchTeacherQuery={data.searchTeacherQuery}
                setSearchTeacherQuery={data.setSearchTeacherQuery}
                toggleAbsence={toggleAbsence}
                openEdit={openEdit}
                setFocusedLocation={setFocusedLocation}
                openArchive={openArchive}
                openMonthlyExport={openMonthlyExport}
                openLeavePeriods={openLeavePeriods}
              />
              
              <SystemSettings 
                setIsSchoolManagerOpen={setIsSchoolManagerOpen}
                setTemplateSettings={setTemplateSettings}
                setIsTemplateSettingsOpen={setIsTemplateSettingsOpen}
                isRestoringBackup={isRestoringBackup}
                handleRestoreBackup={handleRestoreBackup}
                loadData={data.loadData}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="pending">
          <div className="max-w-4xl mx-auto py-6">
            <PendingTeachersList 
              teachers={data.teachers.filter(t => t.status === 'PENDING')} 
              onApprove={handleApprovePending} 
              onReject={handleRejectPending} 
            />
          </div>
        </TabsContent>

        <TabsContent value="statistics">
          <Statistics teachers={data.teachers.filter(t => t.status !== 'PENDING')} requests={data.requests} />
        </TabsContent>
      </Tabs>

      <KpiDetailDialog 
        activeKpiDetail={activeKpiDetail}
        setActiveKpiDetail={setActiveKpiDetail}
        teachers={data.teachers}
        openRequests={data.openRequests}
        filledRequests={data.filledRequests}
        sickTeachers={data.sickTeachers}
        openRequestCount={data.openRequestCount}
        filledRequestCount={data.filledRequestCount}
        sickTeacherCount={data.sickTeacherCount}
        handleSelectRequestFromKpi={handleSelectRequestFromKpi}
      />

      <AddTeacherDialog 
        isAddTeacherOpen={isAddTeacherOpen}
        setIsAddTeacherOpen={setIsAddTeacherOpen}
        handleAddTeacher={handleAddTeacher}
        newTeacher={newTeacher}
        setNewTeacher={setNewTeacher}
        isAdding={isAdding}
        sortedSchools={data.sortedSchools}
        schedule={schedule}
        toggleDay={toggleDay}
        toggleHour={toggleHour}
      />

      <EditTeacherDialog 
        isEditTeacherOpen={isEditTeacherOpen}
        setIsEditTeacherOpen={setIsEditTeacherOpen}
        editTeacherData={editTeacherData}
        setEditTeacherData={setEditTeacherData}
        handleEditTeacher={handleEditTeacher}
        isEditingTeacher={isEditingTeacher}
        sortedSchools={data.sortedSchools}
        editSchedule={editSchedule}
        setEditSchedule={setEditSchedule}
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

      <ArchiveDialog 
        archiveTeacher={archiveTeacher}
        setArchiveTeacher={setArchiveTeacher}
        archiveData={archiveData}
      />

      <MonthlyExportDialog
        teacher={exportTeacher}
        isOpen={isExportOpen}
        setIsOpen={setIsExportOpen}
      />

      <LeavePeriodDialog
        teacher={leaveTeacher}
        isOpen={isLeaveOpen}
        setIsOpen={setIsLeaveOpen}
        onChanged={() => data.loadData()}
      />

      <SchoolManagerDialog 
        isSchoolManagerOpen={isSchoolManagerOpen}
        setIsSchoolManagerOpen={setIsSchoolManagerOpen}
        handleAddSchool={handleAddSchool}
        newSchool={newSchool}
        setNewSchool={setNewSchool}
        isAddingSchool={isAddingSchool}
        sortedSchools={data.sortedSchools}
        editingPasswordId={editingPasswordId}
        setEditingPasswordId={setEditingPasswordId}
        newEmail={newEmail}
        setNewEmail={setNewEmail}
        newPassword={newPassword}
        setNewPassword={setNewPassword}
        handleUpdateCredentials={handleUpdateCredentials}
      />



      <TemplateSettingsDialog 
        isTemplateSettingsOpen={isTemplateSettingsOpen}
        setIsTemplateSettingsOpen={setIsTemplateSettingsOpen}
        templateSettings={templateSettings}
        setTemplateSettings={setTemplateSettings}
        isSavingTemplate={isSavingTemplate}
        setIsSavingTemplate={setIsSavingTemplate}
        isUploadingLogo={isUploadingLogo}
        handleUploadLogo={handleUploadLogo}
        isUploadingSignature={isUploadingSignature}
        handleUploadSignature={handleUploadSignature}
        handleGeneratePreview={handleGeneratePreview}
      />
    </div>
  );
}
