"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSchulamtData } from "@/hooks/useSchulamtData";
import { useSchulamtYear } from "@/hooks/useSchulamtYear";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { TeachersList } from "@/components/schulamt/TeachersList";
import { PendingTeachersList } from "@/components/schulamt/PendingTeachersList";
import { AddTeacherDialog } from "@/components/schulamt/dialogs/AddTeacherDialog";
import { EditTeacherDialog } from "@/components/schulamt/dialogs/EditTeacherDialog";
import { ArchiveDialog } from "@/components/schulamt/dialogs/ArchiveDialog";
import { MonthlyExportDialog } from "@/components/schulamt/dialogs/MonthlyExportDialog";
import { LeavePeriodDialog } from "@/components/schulamt/dialogs/LeavePeriodDialog";
import { TeacherInvitationDialog } from "@/components/schulamt/dialogs/TeacherInvitationDialog";
import { TeacherData, NewTeacherForm, EditTeacherForm } from "@/types/models";
import { withOptionalTeacherPassword } from "@/lib/teacherUpdate";

function SchulamtReservenPage() {
  const { selectedYear, setSelectedYear } = useSchulamtYear();
  const data = useSchulamtData({ endpoints: ["teachers", "schools"], year: selectedYear, setYear: setSelectedYear });
  const { toast } = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [isAddTeacherOpen, setIsAddTeacherOpen] = useState(false);
  const [isInvitationOpen, setIsInvitationOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newTeacher, setNewTeacher] = useState<NewTeacherForm>({
    name: "",
    stammschuleId: "",
    maxWeeklyHours: "28",
    qualifications: "Grundschule",
    preferredType: "BOTH",
    address: "",
    postalCode: "",
    homeLat: null,
    homeLng: null,
    isPartTime: false,
    email: "",
    password: "",
    phone: "",
    gender: "",
    schoolYear: selectedYear
  });
  const [schedule, setSchedule] = useState<Record<string, number[]>>({
    "1": [1,2,3,4,5,6,7,8,9,10],
    "2": [1,2,3,4,5,6,7,8,9,10],
    "3": [1,2,3,4,5,6,7,8,9,10],
    "4": [1,2,3,4,5,6,7,8,9,10],
    "5": [1,2,3,4,5,6,7,8,9,10],
  });

  const [isEditTeacherOpen, setIsEditTeacherOpen] = useState(false);
  const [isEditingTeacher, setIsEditingTeacher] = useState(false);
  const [editTeacherData, setEditTeacherData] = useState<EditTeacherForm | null>(null);
  const [editSchedule, setEditSchedule] = useState<Record<string, number[]>>({});

  const [archiveTeacher, setArchiveTeacher] = useState<TeacherData | null>(null);

  const [exportTeacher, setExportTeacher] = useState<TeacherData | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [leaveTeacher, setLeaveTeacher] = useState<TeacherData | null>(null);
  const [isLeaveOpen, setIsLeaveOpen] = useState(false);

  // Geteilter SchulamtDataContext aktualisiert Layout-KPIs und diese Ansicht gemeinsam.
  const refresh = (year?: string) => {
    data.loadData(year);
  };

  // Von der Kopfzeile im Layout verlinkt ("Lehrkraft hinzufügen" ist dort ein Button, der
  // Dialog selbst braucht aber lokalen State - der lebt hier, wo er auch gerendert wird.
  useEffect(() => {
    if (searchParams.get('openAdd')) {
      setIsAddTeacherOpen(true);
      router.replace('/schulamt/reserven');
    } else if (searchParams.get('openInvite')) {
      setIsInvitationOpen(true);
      router.replace('/schulamt/reserven');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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

  const handleAddTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newTeacher.homeLat === null || newTeacher.homeLng === null) {
      toast({ variant: "error", title: "Bitte prüfen und bestätigen Sie die ungefähre Pin-Position auf der Karte." });
      return;
    }
    setIsAdding(true);
    try {
      const res = await fetch("/api/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newTeacher, schoolYear: selectedYear, schedule: newTeacher.isPartTime ? schedule : undefined })
      });
      if (res.ok) {
        setIsAddTeacherOpen(false);
        setNewTeacher({ ...newTeacher, name: "", address: "", postalCode: "", homeLat: null, homeLng: null, isPartTime: false, email: "", password: "", phone: "", gender: "", schoolYear: selectedYear });
        refresh(selectedYear);
      } else {
        const error = await res.json();
        toast({ variant: "error", title: `Fehler: ${error.error}` });
      }
    } finally {
      setIsAdding(false);
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
      address: teacher.address || "",
      postalCode: teacher.postalCode || "",
      homeLat: teacher.homeLat,
      homeLng: teacher.homeLng,
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

  const handleEditTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTeacherData || isEditingTeacher) return;
    if (editTeacherData.homeLat === null || editTeacherData.homeLng === null) {
      toast({ variant: "error", title: "Bitte prüfen und bestätigen Sie die ungefähre Pin-Position auf der Karte." });
      return;
    }
    setIsEditingTeacher(true);
    try {
      const res = await fetch(`/api/teachers/${editTeacherData.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // An empty optional password means "leave the login unchanged", not an
        // invalid attempt to set a zero-character password.
        body: JSON.stringify({
          ...withOptionalTeacherPassword(editTeacherData),
          // Empty native/select values mean an intentional clear, represented
          // by null in the API; absent fields remain distinct on partial PATCH.
          email: editTeacherData.email === "" ? null : editTeacherData.email,
          gender: editTeacherData.gender === "" ? null : editTeacherData.gender,
          schedule: editTeacherData.isPartTime ? editSchedule : undefined,
        })
      });
      if (res.ok) {
        setIsEditTeacherOpen(false);
        refresh();
      } else {
        const err = await res.json();
        toast({ variant: "error", title: `Fehler: ${err.error}` });
      }
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler. Bitte versuchen Sie es erneut." });
    } finally {
      setIsEditingTeacher(false);
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
      refresh();
    } catch (error) {
      console.error('Toggle absence error:', error);
      toast({ variant: "error", title: "Netzwerkfehler. Bitte versuchen Sie es erneut." });
    }
  };

  const openArchive = (teacher: TeacherData) => setArchiveTeacher(teacher);

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
        refresh();
      } else {
        toast({ variant: "error", title: "Fehler bei der Freigabe." });
      }
    } catch {
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
        refresh();
      } else {
        toast({ variant: "error", title: "Fehler beim Ablehnen." });
      }
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler." });
    }
  };

  const pendingTeachers = data.teachers.filter(t => t.status === 'PENDING');

  return (
    <div className="space-y-7">
      <TeachersList
        filteredTeachers={data.filteredTeachers.filter(t => t.status !== 'PENDING')}
        searchTeacherQuery={data.searchTeacherQuery}
        setSearchTeacherQuery={data.setSearchTeacherQuery}
        toggleAbsence={toggleAbsence}
        openEdit={openEdit}
        // Die Karte lebt auf /schulamt - "Anzeigen" verlinkt per Query-Parameter dorthin.
        setFocusedLocation={(loc) => { if (loc) router.push(`/schulamt?focusLat=${loc.lat}&focusLng=${loc.lng}`); }}
        openArchive={openArchive}
        openMonthlyExport={openMonthlyExport}
        openLeavePeriods={openLeavePeriods}
      />

      <PendingTeachersList
        teachers={pendingTeachers}
        onApprove={handleApprovePending}
        onReject={handleRejectPending}
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

      <TeacherInvitationDialog open={isInvitationOpen} onOpenChange={setIsInvitationOpen} />

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

      <ArchiveDialog
        archiveTeacher={archiveTeacher}
        setArchiveTeacher={setArchiveTeacher}
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
        onChanged={() => refresh()}
      />
    </div>
  );
}

export default function SchulamtReservenPageWrapper() {
  return (
    <Suspense fallback={null}>
      <SchulamtReservenPage />
    </Suspense>
  );
}
