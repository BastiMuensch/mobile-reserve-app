import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { SCHOOL_TYPES, schoolTypeLabel } from "@/lib/schoolTypes";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Loader2, School as SchoolIcon, KeySquare, MapPin, Mail, Trash2, FileDown } from "lucide-react";
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
 * Schulart, Zugangsdaten und druckbare Accountbriefe verwalten.
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
  const confirm = useConfirm();
  // Der "Kleine Schule"-Status wird nach einem erfolgreichen PATCH lokal gespiegelt,
  // damit die Liste sofort den neuen Stand zeigt, auch bevor das Neuladen durch ist.
  const [smallOverrides, setSmallOverrides] = useState<Record<string, boolean>>({});
  const [togglingSmallId, setTogglingSmallId] = useState<string | null>(null);
  const [typeOverrides, setTypeOverrides] = useState<Record<string, string>>({});
  const [updatingTypeId, setUpdatingTypeId] = useState<string | null>(null);
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [typeDraft, setTypeDraft] = useState('GRUNDSCHULE');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [schoolFilter, setSchoolFilter] = useState('ALL');
  const [schoolSort, setSchoolSort] = useState('NAME');
  const [generatingLetters, setGeneratingLetters] = useState(false);
  const [accountPdf, setAccountPdf] = useState<{ url: string; filename: string; count: number } | null>(null);
  const pdfUrlRef = useRef<string | null>(null);
  const [geocodingId, setGeocodingId] = useState<string | null>(null);
  const [manualMapId, setManualMapId] = useState<string | null>(null);
  const attemptedGeocoding = useRef(new Set<string>());

  const isSchoolSmall = (school: SchoolData) => smallOverrides[school.id] ?? Boolean(school.isSmall);
  const activeSchools = sortedSchools.filter(school => !deletedIds.includes(school.id));
  const schoolsWithLogin = activeSchools.filter(school => school.user?.role === 'SCHOOL');
  const visibleSchools = activeSchools
    .filter(school => schoolFilter === 'ALL' || (typeOverrides[school.id] ?? school.type) === schoolFilter)
    .sort((a, b) => {
      if (schoolSort === 'TYPE') {
        const order = (type: string) => SCHOOL_TYPES.findIndex(value => value === type);
        const typeOrder = order(typeOverrides[a.id] ?? a.type) - order(typeOverrides[b.id] ?? b.type);
        if (typeOrder) return typeOrder;
      }
      return a.name.localeCompare(b.name, 'de');
    });
  const schoolActionBusy = generatingLetters || deletingId !== null || updatingTypeId !== null;
  const discardAccountPdf = () => {
    if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    pdfUrlRef.current = null;
    setAccountPdf(null);
  };

  useEffect(() => () => {
    if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
  }, []);

  const handleAccountLetters = async (schools: SchoolData[], allSchools = false) => {
    if (!schools.length || schoolActionBusy) return;
    const confirmed = await confirm({
      title: schools.length === 1 ? 'Accountbrief erstellen?' : `Accountbriefe für ${schools.length} Schulen erstellen?`,
      description: `${schools.length === 1 ? `Für „${schools[0].name}“ wird ein neues Initialpasswort gesetzt.` : 'Für alle aufgeführten Schulen wird jeweils ein neues Initialpasswort gesetzt.'} Bisherige Passwörter und angemeldete Schulsitzungen werden ungültig. Beim nächsten Login muss die Schule ihr Passwort ändern. Das PDF enthält die neuen Zugangsdaten. Auch erneutes Erstellen setzt wieder neue Passwörter.`,
      confirmLabel: 'Neue Passwörter setzen und PDF erstellen',
      variant: 'destructive',
    });
    if (!confirmed) return;
    setGeneratingLetters(true);
    try {
      const response = await fetch('/api/schools/account-letters', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(allSchools ? { allSchools: true } : { schoolIds: schools.map(school => school.id) }), confirmPasswordReset: true }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Accountbriefe konnten nicht erstellt werden.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = url;
      const count = Number(response.headers.get('X-Account-Letter-Count')) || schools.length;
      const filename = count === 1 ? 'Accountbrief-Schule.pdf' : 'Accountbriefe-Schulen.pdf';
      setAccountPdf({ url, filename, count });
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      toast({ variant: 'success', title: 'Accountbriefe erstellt und neue Passwörter gesetzt.' });
      onChanged?.();
    } catch (error) {
      toast({ variant: 'error', title: error instanceof Error ? error.message : 'Accountbriefe konnten nicht geladen werden.' });
    } finally {
      setGeneratingLetters(false);
    }
  };

  const handleDeleteSchool = async (school: SchoolData) => {
    const ok = await confirm({
      title: 'Schule löschen?',
      description: `„${school.name}“ und der zugehörige Schulzugang werden dauerhaft gelöscht. Das ist nur möglich, wenn noch keine Lehrkräfte oder Bedarfe hinterlegt sind.`,
      confirmLabel: 'Schule löschen',
      variant: 'destructive',
    });
    if (!ok) return;
    setDeletingId(school.id);
    try {
      const response = await fetch('/api/schools', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schoolId: school.id }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Schule konnte nicht gelöscht werden.');
      setDeletedIds(ids => [...ids, school.id]);
      discardAccountPdf();
      toast({ variant: 'success', title: 'Schule und Schulzugang gelöscht.' });
      onChanged?.();
    } catch (error) {
      toast({ variant: 'error', title: error instanceof Error ? error.message : 'Schule konnte nicht gelöscht werden.' });
    } finally {
      setDeletingId(null);
    }
  };

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
      setEditingTypeId(null);
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
            <KeySquare className="w-5 h-5 text-muted-foreground" /> Schulen ({schoolFilter === 'ALL' ? activeSchools.length : `${visibleSchools.length} von ${activeSchools.length}`})
          </CardTitle>
          <CardDescription>Schulart und Zugangsdaten ändern, Accountbriefe drucken oder versehentlich angelegte Schulen löschen.</CardDescription>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="school-type-filter">Nach Schulart filtern</Label>
              <Select value={schoolFilter} onValueChange={value => value && setSchoolFilter(value)}>
                <SelectTrigger id="school-type-filter" className="w-full"><SelectValue>{(value: string) => value === 'ALL' ? 'Alle Schularten' : schoolTypeLabel(value)}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Alle Schularten</SelectItem>
                  {SCHOOL_TYPES.map(type => <SelectItem key={type} value={type}>{schoolTypeLabel(type)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="school-sort">Sortierung</Label>
              <Select value={schoolSort} onValueChange={value => value && setSchoolSort(value)}>
                <SelectTrigger id="school-sort" className="w-full"><SelectValue>{(value: string) => value === 'TYPE' ? 'Schulart, dann Name' : 'Name (A–Z)'}</SelectValue></SelectTrigger>
                <SelectContent><SelectItem value="NAME">Name (A–Z)</SelectItem><SelectItem value="TYPE">Schulart, dann Name</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={schoolActionBusy || !schoolsWithLogin.length} onClick={() => handleAccountLetters(schoolsWithLogin, true)}>
              {generatingLetters ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
              {generatingLetters ? 'Accountbriefe werden erstellt...' : `Accountbriefe für alle Schulen (${schoolsWithLogin.length})`}
            </Button>
          </div>
          {schoolsWithLogin.length < activeSchools.length && <p className="text-sm text-muted-foreground">Schulen ohne Schulzugang sind nicht im Sammelbrief enthalten.</p>}
          {accountPdf && <div role="status" className="rounded-lg border border-border bg-muted/40 p-3 text-sm space-y-2">
            <p>{accountPdf.count === 1 ? 'Ein Accountbrief ist' : `${accountPdf.count} Accountbriefe sind`} bereit. Dieses PDF können Sie erneut laden oder drucken, ohne die Passwörter nochmals zu ändern.</p>
            <div className="flex flex-wrap gap-4 font-medium">
              <a className="underline underline-offset-4" href={accountPdf.url} download={accountPdf.filename}>PDF erneut herunterladen</a>
              <a className="underline underline-offset-4" href={accountPdf.url} target="_blank" rel="noopener noreferrer">PDF öffnen / drucken</a>
            </div>
            <p className="text-xs text-muted-foreground">Nur bis zum Verlassen oder Neuladen dieser Seite verfügbar. Zugangsdaten vertraulich aufbewahren.</p>
          </div>}
        </CardHeader>
        <CardContent className="px-5 sm:px-6">
          {visibleSchools.length === 0 ? (
            <p className="text-muted-foreground italic py-4">{activeSchools.length ? 'Keine Schulen dieser Schulart vorhanden.' : 'Noch keine Schulen angelegt.'}</p>
          ) : (
            <div className="divide-y divide-border/70">
              {visibleSchools.map(school => (
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
                    {editingTypeId === school.id && <div className="mt-3 space-y-1.5">
                      <Label htmlFor={`school-type-${school.id}`}>Schulart</Label>
                      <Select
                        value={typeDraft}
                        disabled={updatingTypeId !== null}
                        onValueChange={value => value && setTypeDraft(value)}
                      >
                        <SelectTrigger id={`school-type-${school.id}`} className="w-full sm:w-64">
                          <SelectValue>{schoolTypeLabel}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {SCHOOL_TYPES.map(type => <SelectItem key={type} value={type}>{schoolTypeLabel(type)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" disabled={updatingTypeId !== null} onClick={() => handleUpdateType(school, typeDraft)}>{updatingTypeId === school.id ? 'Wird gespeichert...' : 'Schulart speichern'}</Button>
                        <Button size="sm" variant="ghost" disabled={updatingTypeId !== null} onClick={() => setEditingTypeId(null)}>Abbrechen</Button>
                      </div>
                    </div>}
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

                  <div className="flex flex-col gap-2 w-full sm:w-auto shrink-0">
                  <Button size="sm" variant="outline" disabled={schoolActionBusy} onClick={() => {
                    setTypeDraft(typeOverrides[school.id] ?? school.type);
                    setEditingTypeId(school.id);
                  }}>Schulart ändern</Button>
                  {editingPasswordId === school.id ? (
                    <div className="flex flex-col gap-2 items-start sm:items-end w-full sm:w-auto shrink-0">
                      <p className="max-w-sm text-xs text-muted-foreground">Ein neues Passwort ist ein Initialpasswort. Die Schule muss es beim nächsten Login ändern.</p>
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
                        <Button size="sm" disabled={schoolActionBusy} onClick={() => { discardAccountPdf(); handleUpdateCredentials(school.id); }}>Speichern</Button>
                        <Button size="sm" variant="ghost" onClick={() => {
                          setEditingPasswordId(null);
                          setNewEmail("");
                          setNewPassword("");
                        }}>Abbrechen</Button>
                      </div>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" className="shrink-0" disabled={schoolActionBusy} onClick={() => {
                      setEditingPasswordId(school.id);
                      setNewEmail(school.user?.email || "");
                    }}>
                      Zugangsdaten ändern
                    </Button>
                  )}
                  <Button size="sm" variant="outline" disabled={schoolActionBusy || !school.user} onClick={() => handleAccountLetters([school])}>
                    <FileDown className="h-4 w-4" /> Accountbrief erstellen
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={schoolActionBusy} onClick={() => handleDeleteSchool(school)}>
                    {deletingId === school.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Schule löschen
                  </Button>
                  </div>
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
