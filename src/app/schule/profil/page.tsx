"use client";

import { useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Building, MapPin, AlertTriangle, Loader2 } from "lucide-react";
import { ResetDataDialog } from "@/components/school/ResetDataDialog";
import { useToast } from "@/components/ui/toast";

// Im Großformat darf die Karte deutlich größer sein als im früheren 500px-Dialog –
// der Eingang/Parkplatz lässt sich so viel genauer setzen.
const LocationPickerMap = dynamic(() => import("@/components/LocationPickerMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[420px] w-full bg-muted animate-pulse rounded-md mt-2 flex items-center justify-center text-muted-foreground">
      Lade Karte...
    </div>
  ),
});

/**
 * Schulprofil als eigene Seite im Großformat statt als enger Dialog: Foto, Karten-Pin und
 * allgemeine Hinweise bekommen den Platz, den sie brauchen – dieselbe Begründung wie bei der
 * Schulen-Verwaltung des Schulamts (ein Dialog verdeckt den halben Bildschirm). Erreichbar
 * über den Knopf "Schulprofil bearbeiten" im Schul-Dashboard.
 */
export default function SchulprofilPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [profileData, setProfileData] = useState({ generalInfo: "", imageUrl: "", pinLat: 0, pinLng: 0 });
  const [initialized, setInitialized] = useState(false);
  const [fileToUpload, setFileToUpload] = useState<File | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [isResetDataOpen, setIsResetDataOpen] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resettingData, setResettingData] = useState(false);

  // Nur die Schul-Rolle darf hierher – andere Rollen (und Abgemeldete) zurück auf die Startseite.
  useEffect(() => {
    if (!isLoading && (!user || user.role !== "SCHOOL")) {
      router.replace("/");
    }
  }, [isLoading, user, router]);

  // Formular einmalig aus dem Auth-Kontext vorbelegen, sobald die Schule geladen ist.
  useEffect(() => {
    if (user?.school && !initialized) {
      setProfileData({
        generalInfo: user.school.generalInfo || "",
        imageUrl: user.school.imageUrl || "",
        pinLat: user.school.pinLat || user.school.latitude || 48.0,
        pinLng: user.school.pinLng || user.school.longitude || 10.5,
      });
      setInitialized(true);
    }
  }, [user, initialized]);

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
          action: "updateInfo",
          schoolId: user?.schoolId,
          generalInfo: profileData.generalInfo,
          imageUrl: finalImageUrl,
          pinLat: profileData.pinLat,
          pinLng: profileData.pinLng,
        }),
      });
      if (!res.ok) {
        toast({ variant: "error", title: "Profil konnte nicht gespeichert werden." });
        return;
      }
      // Lokale Vorschau angleichen und den Auth-Kontext neu laden, damit die gespeicherten
      // Werte sofort überall stimmen (früher im Dialog blieb die UI bis zum Reload veraltet).
      setProfileData(prev => ({ ...prev, imageUrl: finalImageUrl }));
      setFileToUpload(null);
      window.dispatchEvent(new Event("app-refresh"));
      toast({ variant: "success", title: "Schulprofil gespeichert." });
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler beim Speichern des Profils." });
    } finally {
      setIsSavingProfile(false);
    }
  };

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
        toast({ variant: "success", title: "Alle Anfragen und Zuweisungen wurden erfolgreich gelöscht." });
      } else {
        const err = await res.json();
        toast({ variant: "error", title: err.error || "Fehler beim Löschen der Daten." });
      }
    } catch {
      toast({ variant: "error", title: "Ein Fehler ist aufgetreten." });
    } finally {
      setResettingData(false);
    }
  };

  if (isLoading || !user || user.role !== "SCHOOL") {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <Button
          variant="ghost"
          onClick={() => router.push("/")}
          className="gap-2 -ml-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Zurück zum Dashboard
        </Button>
      </div>

      <div className="bg-card/50 p-6 rounded-2xl border border-border backdrop-blur-md shadow-sm">
        <h1 className="text-4xl font-extrabold tracking-tight text-blue-600 dark:text-blue-500 flex items-center gap-3">
          <Building className="h-8 w-8" /> Schulprofil
        </h1>
        <p className="text-muted-foreground mt-2 text-lg">
          {user.school?.name ? <><span className="font-semibold text-foreground">{user.school.name}</span> · </> : null}
          Hinterlegen Sie allgemeine Hinweise, ein Foto und den genauen Eingang/Parkplatz für die Mobilen Reserven.
        </p>
      </div>

      <form onSubmit={handleSaveProfile} className="space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Linke Spalte: Infos & Foto */}
          <Card className="shadow-lg bg-card/80 backdrop-blur-sm border-border">
            <CardHeader>
              <CardTitle className="text-xl">Informationen & Foto</CardTitle>
              <CardDescription>Was eine Mobile Reserve beim Eintreffen wissen sollte.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="generalInfo">Allgemeine Informationen (z.B. Anmeldung im Sekretariat)</Label>
                <Textarea
                  id="generalInfo"
                  value={profileData.generalInfo}
                  onChange={e => setProfileData({ ...profileData, generalInfo: e.target.value })}
                  className="h-40"
                  placeholder="z.B. Bitte zuerst im Sekretariat (Raum 001) melden. Schlüssel und Klassenbuch liegen dort bereit."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="schoolImage">Schul-Foto / Parkplatz (optional)</Label>
                <div className="flex items-center gap-4">
                  <Input
                    id="schoolImage"
                    type="file"
                    accept="image/*"
                    onChange={e => {
                      if (e.target.files && e.target.files.length > 0) {
                        setFileToUpload(e.target.files[0]);
                      }
                    }}
                  />
                  {profileData.imageUrl && !fileToUpload && (
                    <Image src={profileData.imageUrl} alt="Schule" width={80} height={80} className="w-20 h-20 object-cover rounded-md border border-border shrink-0" />
                  )}
                </div>
                {fileToUpload && (
                  <p className="text-xs text-muted-foreground">Neues Bild „{fileToUpload.name}“ wird beim Speichern hochgeladen.</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Rechte Spalte: Karten-Pin im Großformat */}
          <Card className="shadow-lg bg-card/80 backdrop-blur-sm border-border">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary" /> Karten-Pin (Eingang / Parkplatz)
              </CardTitle>
              <CardDescription>
                Klicken Sie auf die Karte, um den genauen Parkplatz oder Haupteingang für die Mobilen Reserven zu markieren.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LocationPickerMap
                lat={profileData.pinLat}
                lng={profileData.pinLng}
                heightClass="h-[420px]"
                onChange={(lat, lng) => setProfileData({ ...profileData, pinLat: lat, pinLng: lng })}
              />
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={isSavingProfile} className="gap-2 min-w-[200px]">
            {isSavingProfile ? "Speichern..." : "Profil speichern"}
          </Button>
        </div>
      </form>

      {/* Gefahrenzone: bewusst deutlich abgesetzt vom Profil, damit das Löschen nicht
          versehentlich neben dem Speichern angeklickt wird. */}
      <Card className="border-rose-200 dark:border-rose-900 bg-rose-50/40 dark:bg-rose-950/10">
        <CardHeader>
          <CardTitle className="text-rose-600 dark:text-rose-400 flex items-center gap-2 text-lg">
            <AlertTriangle className="h-5 w-5" /> Gefahrenzone
          </CardTitle>
          <CardDescription>
            Am Ende des Schuljahres können Sie hier alle Anfragen und Zuweisungen Ihrer Schule unwiderruflich löschen.
            Ihr Schulprofil bleibt dabei erhalten.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setIsResetDataOpen(true)}>
            Alle Daten (Anfragen) löschen
          </Button>
        </CardContent>
      </Card>

      <ResetDataDialog
        isOpen={isResetDataOpen}
        setIsOpen={setIsResetDataOpen}
        resetConfirmation={resetConfirmation}
        setResetConfirmation={setResetConfirmation}
        schoolName={user.school?.name || "Unbekannte Schule"}
        handleResetData={handleResetData}
        resettingData={resettingData}
      />
    </div>
  );
}
