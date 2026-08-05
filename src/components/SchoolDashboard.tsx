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
import { SchoolRequestForm } from "./school/SchoolRequestForm";
import { SchoolRequestsList } from "./school/SchoolRequestsList";
import { EditSchoolProfileDialog } from "./school/EditSchoolProfileDialog";
import { ResetDataDialog } from "./school/ResetDataDialog";
import { useToast } from "@/components/ui/toast";

const LocationPickerMap = dynamic(() => import('./LocationPickerMap'), {
  ssr: false,
  loading: () => <div className="h-[250px] w-full bg-muted animate-pulse rounded-md mt-2 flex items-center justify-center text-muted-foreground">Lade Karte...</div>
});

export function SchoolDashboard() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<RequestData[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  // Form state has been extracted to SchoolRequestForm

  const fetchRequests = async () => {
    if (!user?.schoolId) return;
    try {
      const res = await fetch(`/api/requests?schoolId=${user.schoolId}&t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const sorted = data.sort((a: RequestData, b: RequestData) => new Date(a.date).getTime() - new Date(b.date).getTime());
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
        toast({ variant: "error", title: "Profil konnte nicht gespeichert werden." });
      }
    } catch (e) {
      toast({ variant: "error", title: "Netzwerkfehler beim Speichern des Profils." });
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
      toast({ variant: "error", title: "Der eingegebene Schulname stimmt nicht überein." });
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
        toast({ variant: "success", title: "Alle Anfragen und Zuweisungen wurden erfolgreich gelöscht." });
      } else {
        const err = await res.json();
        toast({ variant: "error", title: err.error || "Fehler beim Löschen der Daten." });
      }
    } catch (err) {
      toast({ variant: "error", title: "Ein Fehler ist aufgetreten." });
    } finally {
      setResettingData(false);
    }
  };


  const handleCancel = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/requests/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        toast({ variant: "error", title: err.error || "Anfrage konnte nicht gelöscht werden." });
        return;
      }
      fetchRequests();
    } catch (e) {
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
    return d.toISOString().split('T')[0];
  }, []);

  const handleEndRequest = useCallback((req: RequestData) => {
    setEndingRequest(req);
    setLastDay(new Date().toISOString().split('T')[0]);
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
      const body = await res.json();
      if (!res.ok) {
        toast({ variant: "error", title: body.error || "Die Rückkehr konnte nicht gemeldet werden." });
        return;
      }
      toast({
        variant: "success",
        title: "Rückkehr gemeldet",
        description: body.cancelledAssignments > 0
          ? `${body.cancelledAssignments} geplante Einsätze nach dem letzten Tag wurden storniert und die Lehrkräfte informiert.`
          : "Es lagen keine geplanten Einsätze nach dem letzten Tag vor.",
      });
      setEndingRequest(null);
      fetchRequests();
    } catch (e) {
      toast({ variant: "error", title: "Netzwerkfehler beim Melden der Rückkehr." });
    } finally {
      setIsEndingRequest(false);
    }
  };





  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-card/50 p-6 rounded-2xl border border-border backdrop-blur-md shadow-sm">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-blue-600 dark:text-blue-500">Schul-Dashboard</h1>
          <p className="text-muted-foreground mt-2 text-lg">Verwalten Sie Ihren Bedarf an Mobilen Reserven.</p>
        </div>
        <Button onClick={handleOpenProfile} className="gap-2 bg-foreground text-background hover:bg-foreground/90 shadow-md">
          <Building className="h-4 w-4" /> Schulprofil bearbeiten
        </Button>
      </div>

      <EditSchoolProfileDialog
        isOpen={isProfileOpen}
        setIsOpen={setIsProfileOpen}
        profileData={profileData}
        setProfileData={setProfileData}
        fileToUpload={fileToUpload}
        setFileToUpload={setFileToUpload}
        handleSaveProfile={handleSaveProfile}
        isSavingProfile={isSavingProfile}
        setIsResetDataOpen={setIsResetDataOpen}
      />

      <ResetDataDialog
        isOpen={isResetDataOpen}
        setIsOpen={setIsResetDataOpen}
        resetConfirmation={resetConfirmation}
        setResetConfirmation={setResetConfirmation}
        schoolName={user?.school?.name || "Unbekannte Schule"}
        handleResetData={handleResetData}
        resettingData={resettingData}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* REQUEST FORM */}
        <div className="lg:col-span-1">
          <SchoolRequestForm user={user} fetchRequests={fetchRequests} />
        </div>

        {/* REQUESTS LIST */}
        <div className="lg:col-span-2">
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
              min={endingRequest ? new Date(endingRequest.date).toISOString().split('T')[0] : undefined}
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
