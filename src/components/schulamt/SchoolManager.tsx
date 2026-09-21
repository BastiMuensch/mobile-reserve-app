import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { SCHOOL_TYPES, schoolTypeLabel } from "@/lib/schoolTypes";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Loader2, School as SchoolIcon, KeySquare, MapPin, Mail } from "lucide-react";
import { SchoolData, NewSchoolForm } from "@/types/models";

const LocationPickerMap = dynamic(() => import("@/components/LocationPickerMap"), { ssr: false });

interface SchoolManagerProps {
  handleAddSchool: (e: React.FormEvent) => void;
  newSchool: NewSchoolForm;
  setNewSchool: (val: NewSchoolForm) => void;
  isAddingSchool: boolean;
  sortedSchools: SchoolData[];
  editingPasswordId: string | null;
  setEditingPasswordId: (val: string | null) => void;
  newEmail: string;
  setNewEmail: (val: string) => void;
  newPassword: string;
  setNewPassword: (val: string) => void;
  handleUpdateCredentials: (schoolId: string) => void;
  /** Wird nach Änderungen an einer bestehenden Schule aufgerufen. */
  onChanged?: () => void;
}

/**
 * Schulverwaltung des Schulamts: neue Schulen anlegen und alle bestehenden mit
 * Kontaktdaten und Zugangsdaten einsehen. Steht bewusst als Abschnitt auf der
 * Einstellungsseite statt in einem Dialog – die Schulübersicht ist Nachschlagewerk,
 * kein kurzer Zwischenschritt, und ein Dialog verdeckt dafür den halben Bildschirm.
 */
export function SchoolManager({
  handleAddSchool,
  newSchool,
  setNewSchool,
  isAddingSchool,
  sortedSchools,
  editingPasswordId,
  setEditingPasswordId,
  newEmail,
  setNewEmail,
  newPassword,
  setNewPassword,
  handleUpdateCredentials,
  onChanged
}: SchoolManagerProps) {
  const { toast } = useToast();
  // Der "Kleine Schule"-Status wird nach einem erfolgreichen PATCH lokal gespiegelt,
  // damit die Liste sofort den neuen Stand zeigt, auch bevor das Neuladen durch ist.
  const [smallOverrides, setSmallOverrides] = useState<Record<string, boolean>>({});
  const [togglingSmallId, setTogglingSmallId] = useState<string | null>(null);
  const [typeOverrides, setTypeOverrides] = useState<Record<string, string>>({});
  const [updatingTypeId, setUpdatingTypeId] = useState<string | null>(null);
  const [geocodingId, setGeocodingId] = useState<string | null>(null);
  const [manualMapId, setManualMapId] = useState<string | null>(null);
  const attemptedGeocoding = useRef(new Set<string>());

  const isSchoolSmall = (school: SchoolData) => smallOverrides[school.id] ?? Boolean(school.isSmall);

  const handleToggleSmall = async (school: SchoolData) => {
    const nextValue = !isSchoolSmall(school);
    setTogglingSmallId(school.id);
    try {
      const res = await fetch("/api/schools", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateFlags", schoolId: school.id, isSmall: nextValue })
      });
      if (res.ok) {
        setSmallOverrides(prev => ({ ...prev, [school.id]: nextValue }));
        toast({
          variant: "success",
          title: nextValue ? "Als kleine Schule markiert." : "Markierung als kleine Schule entfernt."
        });
        onChanged?.();
      } else {
        const body = await res.json().catch(() => ({}));
        toast({ variant: "error", title: body.error || "Fehler beim Aktualisieren der Schule." });
      }
    } catch {
      toast({ variant: "error", title: "Fehler beim Aktualisieren der Schule." });
    } finally {
      setTogglingSmallId(null);
    }
  };

  const handleUpdateType = async (school: SchoolData, type: string) => {
    setUpdatingTypeId(school.id);
    try {
      const res = await fetch("/api/schools", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateType", schoolId: school.id, type }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Schulart konnte nicht gespeichert werden.");
      setTypeOverrides(prev => ({ ...prev, [school.id]: type }));
      toast({ variant: "success", title: "Schulart gespeichert." });
      onChanged?.();
    } catch (error) {
      toast({ variant: "error", title: error instanceof Error ? error.message : "Schulart konnte nicht gespeichert werden." });
    } finally {
      setUpdatingTypeId(null);
    }
  };

  const retryGeocoding = async (school: SchoolData, automatic = false) => {
    setGeocodingId(school.id);
    try {
      const res = await fetch("/api/schools", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retryGeocoding", schoolId: school.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.success) {
        if (!automatic) toast({ variant: "success", title: "Schulstandort wurde ermittelt." });
        onChanged?.();
      } else if (!automatic) {
        toast({ variant: "error", title: body.warning || body.error || "Standort konnte noch nicht ermittelt werden." });
      }
      if (automatic && !(res.ok && body.success)) onChanged?.();
    } catch {
      if (!automatic) toast({ variant: "error", title: "Standortdienst ist derzeit nicht erreichbar." });
    } finally {
      setGeocodingId(null);
    }
  };

  const setManualCoordinates = async (school: SchoolData, latitude: number, longitude: number) => {
    setGeocodingId(school.id);
    try {
      const res = await fetch("/api/schools", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setCoordinates", schoolId: school.id, latitude, longitude }),
      });
      if (!res.ok) throw new Error();
      setManualMapId(null);
      toast({ variant: "success", title: "Kartenpunkt gespeichert." });
      onChanged?.();
    } catch {
      toast({ variant: "error", title: "Kartenpunkt konnte nicht gespeichert werden." });
    } finally {
      setGeocodingId(null);
    }
  };

  useEffect(() => {
    const pending = sortedSchools.find((school) =>
      school.latitude == null &&
      school.longitude == null &&
      !attemptedGeocoding.current.has(school.id),
    );
    if (!pending) return;
    attemptedGeocoding.current.add(pending.id);
    void retryGeocoding(pending, true);
    // Ein automatischer Versuch pro Schule und Seitenaufruf. Weitere Versuche bleiben manuell möglich.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedSchools]);

  return (
    <div className="space-y-7">
      <Card className="shadow-none bg-card ring-border/70 py-6 gap-6">
        <CardHeader className="px-5 sm:px-6 gap-2">
          <CardTitle className="flex items-center gap-2 text-xl">
            <SchoolIcon className="w-5 h-5 text-muted-foreground" /> Neue Schule anlegen
          </CardTitle>
          <CardDescription>Die Schule erhält damit einen eigenen Zugang, um Bedarfe zu melden.</CardDescription>
        </CardHeader>
        <CardContent className="px-5 sm:px-6 [&_input]:min-h-10 [&_button]:min-h-10">
          <form onSubmit={handleAddSchool} className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="new-school-name">Name der Schule</Label>
                <Input id="new-school-name" value={newSchool.name} onChange={e => setNewSchool({ ...newSchool, name: e.target.value })} required placeholder="Name der Schule" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-school-type">Schulart</Label>
                <Select value={newSchool.type} onValueChange={v => v && setNewSchool({ ...newSchool, type: v })}>
                  {/* Ohne eigene Ausgabe zeigt die Select-Komponente den rohen Wert
                      ("GRUNDSCHULE") statt der lesbaren Bezeichnung an. */}
                  <SelectTrigger id="new-school-type">
                    <SelectValue>{schoolTypeLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SCHOOL_TYPES.map(type => <SelectItem key={type} value={type}>{schoolTypeLabel(type)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="new-school-address">Adresse</Label>
                <Input id="new-school-address" value={newSchool.address} onChange={e => setNewSchool({ ...newSchool, address: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-school-email">E-Mail-Adresse (Login)</Label>
                <Input id="new-school-email" value={newSchool.email} onChange={e => setNewSchool({ ...newSchool, email: e.target.value })} required placeholder="schule@example.de" type="email" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-school-password">Initiales Passwort</Label>
              <Input id="new-school-password" type="password" minLength={12} value={newSchool.password} onChange={e => setNewSchool({ ...newSchool, password: e.target.value })} required placeholder="Mindestens 12 Zeichen" />
            </div>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(newSchool.isSmall)}
                onChange={e => setNewSchool({ ...newSchool, isSmall: e.target.checked })}
                className="h-4 w-4 rounded border-border accent-primary mt-0.5"
              />
              <span>
                Kleine Schule
                <span className="block text-xs text-muted-foreground">
                  Bedarfe dieser Schule werden höher gewichtet – kleine Kollegien können Ausfälle kaum selbst auffangen.
                </span>
              </span>
            </label>
            <Button type="submit" disabled={isAddingSchool}>
              {isAddingSchool ? "Wird gespeichert..." : "Schule anlegen"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="shadow-none bg-card ring-border/70 py-6 gap-6">
        <CardHeader className="px-5 sm:px-6 gap-2">
          <CardTitle className="flex items-center gap-2 text-xl">
            <KeySquare className="w-5 h-5 text-muted-foreground" /> Schulen ({sortedSchools.length})
          </CardTitle>
          <CardDescription>Kontakt- und Zugangsdaten aller Schulen dieses Schulamts.</CardDescription>
        </CardHeader>
        <CardContent className="px-5 sm:px-6">
          {sortedSchools.length === 0 ? (
            <p className="text-muted-foreground italic py-4">Noch keine Schulen angelegt.</p>
          ) : (
            <div className="divide-y divide-border/70">
              {sortedSchools.map(school => (
                <div key={school.id} className="flex flex-col sm:flex-row sm:flex-wrap sm:items-start justify-between gap-5 py-6 [&_button]:min-h-10">
                  <div className="w-full sm:w-auto min-w-0">
                    <div className="font-medium text-lg flex items-center gap-2 flex-wrap">
                      {school.name}
                      <Badge variant="outline" className="text-[10px]">
                        {schoolTypeLabel(typeOverrides[school.id] ?? school.type)}
                      </Badge>
                      {isSchoolSmall(school) && (
                        <Badge variant="outline" className="text-[10px] bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/40 dark:text-violet-300 dark:border-violet-800">
                          Kleine Schule
                        </Badge>
                      )}
                    </div>
                    {school.address && (
                      <div className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 shrink-0" /> {school.address}
                      </div>
                    )}
                    {school.user?.email && (
                      <div className="text-sm text-muted-foreground mt-2 flex items-center gap-1.5 [overflow-wrap:anywhere]">
                        <Mail className="w-3.5 h-3.5 shrink-0" /> {school.user.email}
                      </div>
                    )}
                    {school.latitude == null || school.longitude == null ? (
                      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                        <p className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Adresse gespeichert – Standortbestimmung ausstehend. Die App versucht es bei späteren Aufrufen erneut.</p>
                        {school.geocodingError && <p className="mt-1 opacity-80">{school.geocodingError}</p>}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button type="button" size="sm" variant="outline" disabled={geocodingId === school.id} onClick={() => retryGeocoding(school)}>
                            {geocodingId === school.id && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Jetzt erneut versuchen
                          </Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => setManualMapId(manualMapId === school.id ? null : school.id)}>Kartenpunkt manuell setzen</Button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-600"><MapPin className="h-3.5 w-3.5" /> Standort hinterlegt{school.geocodingStatus === 'MANUAL' ? ' (manuell)' : ''}</p>
                    )}
                    <div className="mt-3 space-y-1.5">
                      <Label htmlFor={`school-type-${school.id}`}>Schulart</Label>
                      <Select
                        value={typeOverrides[school.id] ?? school.type}
                        disabled={updatingTypeId !== null}
                        onValueChange={value => value && value !== (typeOverrides[school.id] ?? school.type) && handleUpdateType(school, value)}
                      >
                        <SelectTrigger id={`school-type-${school.id}`} className="w-full sm:w-64">
                          <SelectValue>{schoolTypeLabel}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {SCHOOL_TYPES.map(type => <SelectItem key={type} value={type}>{schoolTypeLabel(type)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground mt-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isSchoolSmall(school)}
                        disabled={togglingSmallId === school.id}
                        onChange={() => handleToggleSmall(school)}
                        className="h-4 w-4 rounded border-border accent-primary"
                      />
                      Kleine Schule
                    </label>
                  </div>

                  {editingPasswordId === school.id ? (
                    <div className="flex flex-col gap-2 items-start sm:items-end w-full sm:w-auto shrink-0">
                      <div className="flex flex-col sm:flex-row gap-2 w-full">
                        <Input
                          type="email"
                          placeholder="Neue E-Mail"
                          value={newEmail}
                          onChange={e => setNewEmail(e.target.value)}
                          className="w-full sm:w-40 h-8 text-sm"
                        />
                        <Input
                          type="password"
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
                    <Button size="sm" variant="outline" className="shrink-0" onClick={() => {
                      setEditingPasswordId(school.id);
                      setNewEmail(school.user?.email || "");
                    }}>
                      Zugangsdaten ändern
                    </Button>
                  )}
                  {manualMapId === school.id && (
                    <div className="w-full sm:basis-full">
                      <LocationPickerMap lat={school.latitude} lng={school.longitude} onChange={(latitude, longitude) => setManualCoordinates(school, latitude, longitude)} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
