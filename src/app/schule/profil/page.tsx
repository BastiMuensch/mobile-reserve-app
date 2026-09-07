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
import { ArrowLeft, Building, MapPin, AlertTriangle, Loader2, ParkingCircle, DoorOpen, X } from "lucide-react";
import { ResetDataDialog } from "@/components/school/ResetDataDialog";
import { useToast } from "@/components/ui/toast";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";

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
  const { user, setUser, isLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [profileData, setProfileData] = useState<{ generalInfo: string; imageUrl: string; entranceLat: number | null; entranceLng: number | null; parkingLat: number | null; parkingLng: number | null }>({ generalInfo: "", imageUrl: "", entranceLat: null, entranceLng: null, parkingLat: null, parkingLng: null });
  const [initialized, setInitialized] = useState(false);
  const [fileToUpload, setFileToUpload] = useState<File | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [isResetDataOpen, setIsResetDataOpen] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resettingData, setResettingData] = useState(false);

  const currentSchool = user?.school;
  const isDirty = initialized && currentSchool !== undefined && (
    fileToUpload !== null ||
    profileData.generalInfo !== (currentSchool.generalInfo ?? "") ||
    profileData.imageUrl !== (currentSchool.imageUrl ?? "") ||
    profileData.entranceLat !== (currentSchool.entranceLat ?? null) ||
    profileData.entranceLng !== (currentSchool.entranceLng ?? null) ||
    profileData.parkingLat !== (currentSchool.parkingLat ?? null) ||
    profileData.parkingLng !== (currentSchool.parkingLng ?? null)
  );
  useUnsavedChanges(isDirty);

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
        // pinLat/pinLng intentionally stay unclassified legacy data. Do not
        // prefill either new point: that would silently change its meaning.
        entranceLat: user.school.entranceLat ?? null,
        entranceLng: user.school.entranceLng ?? null,
        parkingLat: user.school.parkingLat ?? null,
        parkingLng: user.school.parkingLng ?? null,
      });
      setInitialized(true);
    }
  }, [user, initialized]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingProfile(true);
    try {
      let finalImageUrl = profileData.imageUrl;
      if (fileToUpload) {
        const formData = new FormData();
        formData.append("file", fileToUpload);
        formData.append("purpose", "school_image");
        const upload = await fetch("/api/upload", { method: "POST", body: formData });
        if (!upload.ok) {
          const result = await upload.json().catch(() => ({}));
          toast({ variant: "error", title: result.error || "Das Schulbild konnte nicht hochgeladen werden." });
          return;
        }
        const { url } = await upload.json();
        finalImageUrl = url;
      }
      const res = await fetch("/api/schools", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateInfo",
          schoolId: user?.schoolId,
          generalInfo: profileData.generalInfo,
          imageUrl: finalImageUrl || null,
          entranceLat: profileData.entranceLat,
          entranceLng: profileData.entranceLng,
          parkingLat: profileData.parkingLat,
          parkingLng: profileData.parkingLng,
        }),
      });
      if (!res.ok) {
        toast({ variant: "error", title: "Profil konnte nicht gespeichert werden." });
        return;
      }
      const result = await res.json() as { school?: typeof profileData };
      const saved = result.school;
      if (!saved) throw new Error("Die gespeicherten Profildaten fehlen in der Antwort.");
      setProfileData({
        generalInfo: saved.generalInfo ?? "",
        imageUrl: saved.imageUrl ?? "",
        entranceLat: saved.entranceLat ?? null,
        entranceLng: saved.entranceLng ?? null,
        parkingLat: saved.parkingLat ?? null,
        parkingLng: saved.parkingLng ?? null,
      });
      setFileToUpload(null);
      // AuthProvider intentionally does not subscribe to app-refresh. Keep its
      // own school snapshot in sync without an unbounded follow-up request.
      const currentUser = user;
      if (currentUser?.school) setUser({ ...currentUser, school: { ...currentUser.school, ...saved } });
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

  if (isLoading || !initialized || !user || user.role !== "SCHOOL") {
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

      <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm dark:border-slate-800 dark:bg-card">
        <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight text-slate-900 dark:text-foreground">
          <Building className="h-8 w-8" /> Schulprofil
        </h1>
        <p className="text-muted-foreground mt-2 text-lg">
          {user.school?.name ? <><span className="font-semibold text-foreground">{user.school.name}</span> · </> : null}
          Hinterlegen Sie allgemeine Hinweise, ein Foto und den genauen Eingang/Parkplatz für die Mobilen Reserven.
        </p>
      </div>

      <form onSubmit={handleSaveProfile} className="space-y-8">
        {/* Untereinander statt nebeneinander: So bekommt die Textarea die volle Breite und
            fasst die allgemeinen Informationen ohne langes Scrollen. */}
        <div className="space-y-8">
          {/* Infos & Foto */}
          <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-card">
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
                  className="h-72"
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

          <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-card">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary" /> Ankunftspunkte
              </CardTitle>
              <CardDescription>
                Hinterlegen Sie zuerst den Eingang. Ein optionaler Parkplatz ergänzt die Navigation für Mobile Reserven.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              {user.school?.pinLat != null && user.school?.pinLng != null && (
                <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Ein älterer Karten-Pin ist vorhanden. Er bleibt unverändert gespeichert, bis Sie ihn bewusst als Ankunftspunkt übernehmen.</p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" disabled={profileData.entranceLat != null} onClick={() => setProfileData(prev => ({ ...prev, entranceLat: user.school!.pinLat!, entranceLng: user.school!.pinLng! }))}>Als Eingang übernehmen</Button>
                    <Button type="button" size="sm" variant="outline" disabled={profileData.entranceLat == null} title={profileData.entranceLat == null ? "Setzen Sie zuerst einen Eingang." : undefined} onClick={() => setProfileData(prev => ({ ...prev, parkingLat: user.school!.pinLat!, parkingLng: user.school!.pinLng! }))}>Als Parkplatz übernehmen</Button>
                  </div>
                  {profileData.entranceLat == null && <p className="text-xs">Der Parkplatz kann erst übernommen werden, nachdem ein Eingang gesetzt wurde.</p>}
                </div>
              )}
              <ArrivalPointEditor
                icon={<DoorOpen className="h-5 w-5 text-blue-600" />}
                title="Eingang"
                description="Pflicht für einen Parkplatz. Karte klicken oder Koordinaten per Tastatur eingeben."
                lat={profileData.entranceLat}
                lng={profileData.entranceLng}
                markerType="school"
                markerLabel="Markierung Eingang"
                onChange={(lat, lng) => setProfileData(prev => ({ ...prev, entranceLat: lat, entranceLng: lng }))}
                onRemove={profileData.entranceLat != null && profileData.entranceLng != null && profileData.parkingLat == null && profileData.parkingLng == null
                  ? () => setProfileData(prev => ({ ...prev, entranceLat: null, entranceLng: null }))
                  : undefined}
                removeLabel="Eingang entfernen"
              />
              <div className="border-t border-slate-100 pt-7 dark:border-slate-800">
                {profileData.entranceLat != null && profileData.entranceLng != null ? (
                  <ArrivalPointEditor
                    icon={<ParkingCircle className="h-5 w-5 text-emerald-600" />}
                    title="Parkplatz (optional)"
                    description="Separater Treffpunkt für das Abstellen des Fahrzeugs."
                    lat={profileData.parkingLat}
                    lng={profileData.parkingLng}
                    markerType="parking"
                    markerLabel="Markierung Parkplatz"
                    onChange={(lat, lng) => setProfileData(prev => ({ ...prev, parkingLat: lat, parkingLng: lng }))}
                    onRemove={profileData.parkingLat != null ? () => setProfileData(prev => ({ ...prev, parkingLat: null, parkingLng: null })) : undefined}
                    removeLabel="Parkplatz entfernen"
                  />
                ) : <p className="text-sm text-muted-foreground">Einen Parkplatz können Sie ergänzen, sobald der Eingang gesetzt ist.</p>}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={isSavingProfile} className="gap-2 min-w-[200px]">
            {isSavingProfile ? "Speichern..." : "Profil speichern"}
          </Button>
        </div>
      </form>

      {/* Gefahrenzone: bewusst getrennt vom Profil; keine Schuljahres-Aktion. */}
      <Card className="border-rose-200 dark:border-rose-900 bg-rose-50/40 dark:bg-rose-950/10">
        <CardHeader>
          <CardTitle className="text-rose-600 dark:text-rose-400 flex items-center gap-2 text-lg">
            <AlertTriangle className="h-5 w-5" /> Gefahrenzone
          </CardTitle>
          <CardDescription>
            Löschen Sie hier nur bei einem bewussten Datenbereinigungsbedarf alle Anfragen und Zuweisungen unwiderruflich.
            Das Schulprofil bleibt erhalten.
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

function ArrivalPointEditor({ icon, title, description, lat, lng, markerType, markerLabel, onChange, onRemove, removeLabel }: {
  icon: React.ReactNode; title: string; description: string; lat: number | null; lng: number | null;
  markerType: "school" | "parking"; markerLabel: string; onChange: (lat: number, lng: number) => void; onRemove?: () => void; removeLabel?: string;
}) {
  const [latInput, setLatInput] = useState(lat == null ? "" : String(lat));
  const [lngInput, setLngInput] = useState(lng == null ? "" : String(lng));
  const [error, setError] = useState("");
  useEffect(() => { setLatInput(lat == null ? "" : String(lat)); }, [lat]);
  useEffect(() => { setLngInput(lng == null ? "" : String(lng)); }, [lng]);
  const setMapPosition = (nextLat: number, nextLng: number) => {
    setLatInput(String(nextLat));
    setLngInput(String(nextLng));
    setError("");
    onChange(nextLat, nextLng);
  };
  const useCoordinates = () => {
    const parsedLat = Number(latInput.replace(',', '.'));
    const parsedLng = Number(lngInput.replace(',', '.'));
    if (!latInput.trim() || !lngInput.trim() || !Number.isFinite(parsedLat) || parsedLat < -90 || parsedLat > 90 || !Number.isFinite(parsedLng) || parsedLng < -180 || parsedLng > 180) {
      setError("Bitte geben Sie ein vollständiges gültiges Koordinatenpaar ein (Breite −90 bis 90, Länge −180 bis 180).");
      return;
    }
    setMapPosition(parsedLat, parsedLng);
  };
  return <section aria-label={title} className="space-y-4">
    <div className="flex items-start justify-between gap-4"><div><h2 className="flex items-center gap-2 font-semibold">{icon}{title}</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>{onRemove && <Button type="button" variant="ghost" size="sm" onClick={onRemove} className="gap-1 text-muted-foreground"><X className="h-4 w-4" /> {removeLabel}</Button>}</div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="space-y-1"><Label htmlFor={`${markerType}-lat`}>Breitengrad</Label><Input id={`${markerType}-lat`} inputMode="decimal" value={latInput} onChange={e => setLatInput(e.target.value)} placeholder="z. B. 48,7900" aria-label={`${title} Breitengrad`} /></div>
      <div className="space-y-1"><Label htmlFor={`${markerType}-lng`}>Längengrad</Label><Input id={`${markerType}-lng`} inputMode="decimal" value={lngInput} onChange={e => setLngInput(e.target.value)} placeholder="z. B. 11,4900" aria-label={`${title} Längengrad`} /></div>
    </div>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <Button type="button" size="sm" variant="outline" onClick={useCoordinates}><MapPin className="h-4 w-4" /> Koordinaten verwenden</Button>
    <LocationPickerMap lat={lat} lng={lng} heightClass="h-[300px]" markerType={markerType} markerLabel={markerLabel} onChange={setMapPosition} />
  </section>;
}
