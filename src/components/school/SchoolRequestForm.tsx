import { useState, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PlusCircle, Calendar, Clock, AlertCircle, MessageSquare } from "lucide-react";

import { AuthUser } from "../AuthProvider";
import { useToast } from "@/components/ui/toast";
import { toLocalDateInputValue } from "@/lib/dateKey";
import { handleUnauthorized } from "@/lib/authClient";
import { REQUEST_PRIORITY_OPTIONS } from "@/lib/requestPriority";

export function SchoolRequestForm({ user, fetchRequests, requestUrgencyNoteEnabled = false }: { user: AuthUser | null, fetchRequests: () => void, requestUrgencyNoteEnabled?: boolean }) {
  const { toast } = useToast();
  const [date, setDate] = useState(() => toLocalDateInputValue());
  const [endDate, setEndDate] = useState("");
  const [priority, setPriority] = useState("UNPLANNED_ABSENCE");
  const [startHour, setStartHour] = useState("1");
  const [hours, setHours] = useState("4");
  const [substitutedTeacher, setSubstitutedTeacher] = useState("");
  const [className, setClassName] = useState("");
  const [quals, setQuals] = useState<string[]>([]);
  const [locationId, setLocationId] = useState("");
  const locations = (user?.school?.locations ?? []).filter(location => location.isActive);
  const [comments, setComments] = useState("");
  const [hasUrgencyNote, setHasUrgencyNote] = useState(false);
  const [urgencyNote, setUrgencyNote] = useState("");
  const [isLongTerm, setIsLongTerm] = useState(false);
  // Nur bei Längerfristig + Ungeplanter Ausfall wählbar (siehe Checkbox unten) –
  // deshalb beim Wechsel von Modus oder Priorität immer zurücksetzen.
  const [isOpenEnded, setIsOpenEnded] = useState(false);
  const [schedule, setSchedule] = useState<Record<string, number[]>>({
    "1": [], "2": [], "3": [], "4": [], "5": []
  });
  // State updates are asynchronous, so a ref is necessary to close the small
  // double-click/Enter-key window before a disabled button is rendered.
  const isSubmittingRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Keep a key after an ambiguous network/server failure. A retry of the same
  // form can then return the committed request instead of creating a duplicate;
  // changing any submitted field deliberately starts a fresh attempt.
  const retryAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null);

  // Bei der Anforderung ist nur die Schulart relevant – sie beschreibt, wofür die
  // Vertretung gebraucht wird. Welche Person die Vertretung übernimmt und welchen
  // Qualifikationsstatus sie mitbringt, berücksichtigt das Schulamt bei der
  // Zuweisung; die Schule sieht diese Angabe dann bei der zugewiesenen Person.
  const availableQuals = ["Grundschule", "Mittelschule"];

  const toggleDay = useCallback((day: string) => {
    setSchedule(prev => {
      const allSelected = prev[day].length === 10;
      return { ...prev, [day]: allSelected ? [] : [1,2,3,4,5,6,7,8,9,10] };
    });
  }, []);

  const toggleHour = useCallback((day: string, hour: number) => {
    setSchedule(prev => {
      const prevHours = prev[day];
      if (prevHours.includes(hour)) {
        return { ...prev, [day]: prevHours.filter(h => h !== hour) };
      } else {
        return { ...prev, [day]: [...prevHours, hour].sort((a,b) => a-b) };
      }
    });
  }, []);

  const toggleQual = useCallback((q: string) => {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;
    if (!date) return;
    if (requestUrgencyNoteEnabled && hasUrgencyNote && !urgencyNote.trim()) {
      toast({ variant: "error", title: "Bitte füllen Sie den aktivierten Dringlichkeitshinweis fürs Schulamt aus." });
      return;
    }
    if (locationId && locationId !== "main" && !locations.some(location => location.id === locationId)) {
      setLocationId("");
      toast({ variant: "error", title: "Die gewählte Außenstelle ist nicht mehr aktiv. Bitte prüfen Sie den Einsatzort erneut." });
      return;
    }
    if (locations.length > 0 && !locationId) {
      toast({ variant: "error", title: "Bitte wählen Sie den Einsatzort." });
      return;
    }

    const todayKey = toLocalDateInputValue();
    if (date < todayKey) {
      toast({ variant: "error", title: "Das Startdatum darf nicht in der Vergangenheit liegen." });
      return;
    }

    if (isLongTerm && !isOpenEnded && !endDate) {
      toast({ variant: "error", title: "Bitte geben Sie für längerfristige Bedarfe ein Enddatum an." });
      return;
    }

    if (isLongTerm && !isOpenEnded && endDate && endDate < date) {
      toast({ variant: "error", title: "Das Enddatum darf nicht vor dem Startdatum liegen." });
      return;
    }

    let calculatedWeeklyHours = 0;
    // "hours" bedeutet überall (Schema, Zuweisungslogik) Stunden PRO TAG, nicht
    // pro Woche – daher zusätzlich den größten Tageswert aus dem Stundenplan
    // ermitteln und getrennt von der Wochensumme führen.
    let calculatedMaxDailyHours = 0;
    if (isLongTerm) {
      Object.values(schedule).forEach(hoursArr => {
        calculatedWeeklyHours += hoursArr.length;
        calculatedMaxDailyHours = Math.max(calculatedMaxDailyHours, hoursArr.length);
      });
      if (calculatedWeeklyHours === 0) {
        toast({ variant: "error", title: "Bitte markieren Sie im Stundenplan mindestens eine benötigte Stunde." });
        return;
      }
    } else {
      calculatedWeeklyHours = parseInt(hours);
      calculatedMaxDailyHours = parseInt(hours);
    }

    const payloadSchedule = isLongTerm ? JSON.stringify(schedule) : null;
    const submitPayload = {
      schoolId: user?.schoolId,
      locationId: locations.length > 0 && locationId !== "main" ? locationId : null,
      date,
      endDate: isLongTerm && !isOpenEnded ? (endDate || null) : null,
      priority,
      startHour: isLongTerm ? 1 : parseInt(startHour),
      hours: isLongTerm ? calculatedMaxDailyHours : parseInt(hours),
      weeklyHours: calculatedWeeklyHours,
      substitutedTeacher,
      className,
      schedule: payloadSchedule,
      qualifications: quals.join(","),
      comments: comments.trim(),
      hasUrgencyNote: requestUrgencyNoteEnabled && hasUrgencyNote,
      urgencyNote: requestUrgencyNoteEnabled && hasUrgencyNote ? urgencyNote.trim() : "",
      isOpenEnded: isLongTerm && isOpenEnded,
    };
    const fingerprint = JSON.stringify(submitPayload);
    const retryAttempt = retryAttemptRef.current;
    const idempotencyKey = retryAttempt?.fingerprint === fingerprint
      ? retryAttempt.key
      : crypto.randomUUID();
    retryAttemptRef.current = { fingerprint, key: idempotencyKey };

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...submitPayload, idempotencyKey }),
      });
      if (res.status === 401) {
        retryAttemptRef.current = null;
        handleUnauthorized();
        return;
      }
      
      if (res.ok) {
        retryAttemptRef.current = null;
        setDate(toLocalDateInputValue());
        setEndDate("");
        setPriority("UNPLANNED_ABSENCE");
        setStartHour("1");
        setHours("4");
        setSubstitutedTeacher("");
        setClassName("");
        setComments("");
        setHasUrgencyNote(false);
        setUrgencyNote("");
        setLocationId("");
        setQuals([]);
        setIsLongTerm(false);
        setIsOpenEnded(false);
        setSchedule({ "1": [], "2": [], "3": [], "4": [], "5": [] });
        fetchRequests();
      } else {
        const err = await res.json();
        // Validation/authorization failures cannot have committed the request.
        // A 409 is retained so a same-key/payload mismatch cannot be turned
        // into a new demand by repeatedly pressing submit.
        if (res.status >= 400 && res.status < 500 && res.status !== 409) {
          retryAttemptRef.current = null;
        }
        toast({ variant: "error", title: err.error || "Fehler beim Erstellen der Anfrage." });
      }
    } catch (error) {
      console.error('Failed to submit request:', error);
      toast({ variant: "error", title: "Netzwerkfehler beim Erstellen der Anfrage." });
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="border border-border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl tracking-tight">
          <PlusCircle className="h-5 w-5 text-primary" />
          Bedarf melden
        </CardTitle>
        <CardDescription>Fordern Sie eine Mobile Reserve für einen bestimmten Tag an.</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-5">
          {locations.length > 0 && <fieldset className="space-y-2" disabled={isSubmitting}>
            <legend className="mb-2 font-medium text-sm">Einsatzort</legend>
            <div className="flex flex-wrap gap-2">
              {[{ id: "main", name: "Hauptstandort", address: user?.school?.address }, ...locations].map(location => (
                <label key={location.id} className={`flex max-w-full cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${locationId === location.id ? "border-primary bg-primary/5" : "border-border"}`}>
                  <input type="radio" name="locationId" value={location.id} checked={locationId === location.id} onChange={() => setLocationId(location.id)} required className="shrink-0 accent-primary" />
                  <span className="min-w-0 break-words">{location.name}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{locationId === "main" ? user?.school?.address : locations.find(location => location.id === locationId)?.address || "Wo wird die Mobile Reserve benötigt?"}</p>
          </fieldset>}

          <div className="space-y-2">
            <Label htmlFor="priority" className="flex items-center gap-2 font-medium"><AlertCircle className="h-4 w-4 text-rose-500"/> Vertretungsgrund (Priorität)</Label>
            <Select value={priority} onValueChange={(val) => { if (val) { setPriority(val); setIsOpenEnded(false); } }}>
            <SelectTrigger id="priority" className="min-h-10 h-auto w-full [&_[data-slot=select-value]]:whitespace-normal [&_[data-slot=select-value]]:text-left">
                <SelectValue placeholder="Bitte wählen...">
                  {REQUEST_PRIORITY_OPTIONS.filter(option => option.value === priority).map(option => `${option.label} (Prio ${option.rank})`).join('')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {REQUEST_PRIORITY_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label} (Prio {option.rank})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-2 border-b border-border pb-4 sm:grid-cols-2">
            <Button type="button" variant={!isLongTerm ? "default" : "outline"} className="min-h-10" onClick={() => { setIsLongTerm(false); setIsOpenEnded(false); }}>
              1 Tag Bedarf
            </Button>
            <Button type="button" variant={isLongTerm ? "default" : "outline"} className="min-h-10" onClick={() => setIsLongTerm(true)}>
              Längerfristig
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="date" className="flex items-center gap-2 font-medium"><Calendar className="h-4 w-4 text-blue-500"/> {isLongTerm ? "Startdatum" : "Datum"}</Label>
              <Input id="date" type="date" required value={date} onChange={e => setDate(e.target.value)} className="min-h-10 border-border focus:ring-primary" />
            </div>
            {isLongTerm && (
              <div className="space-y-2">
                <Label htmlFor="endDate" className="flex items-center gap-2 font-medium"><Calendar className="h-4 w-4 text-blue-500"/> Enddatum</Label>
                <Input
                  id="endDate"
                  type="date"
                  min={date}
                  required={!isOpenEnded}
                  disabled={isOpenEnded}
                  value={isOpenEnded ? "" : endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="min-h-10 border-border focus:ring-primary"
                />
              </div>
            )}
          </div>

          {isLongTerm && priority === 'UNPLANNED_ABSENCE' && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={isOpenEnded}
                onChange={e => { setIsOpenEnded(e.target.checked); if (e.target.checked) setEndDate(""); }}
                className="h-4 w-4 rounded border-border accent-primary"
              />
              Ende noch offen (bis auf Weiteres)
            </label>
          )}
          {isLongTerm && priority === 'UNPLANNED_ABSENCE' && isOpenEnded && (
            <p className="text-xs text-muted-foreground -mt-2">
              Bei einer Erkrankung ist das Ende meist unbekannt. Der Bedarf läuft weiter, bis Sie die Rückkehr melden.
            </p>
          )}

          {!isLongTerm && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="startHour" className="flex items-center gap-2 font-medium"><Clock className="h-4 w-4 text-blue-500"/> Ab Stunde</Label>
                <Select value={startHour} onValueChange={(val) => val && setStartHour(val)}>
                  <SelectTrigger id="startHour" className="min-h-10"><SelectValue /></SelectTrigger>
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
                  <SelectTrigger id="hours" className="min-h-10"><SelectValue /></SelectTrigger>
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
            <fieldset className="space-y-2 pt-2">
              <legend className="font-medium flex items-center gap-2 mb-2"><Clock className="h-4 w-4 text-primary"/> Benötigte Unterrichtszeiten (Woche)</legend>
              {isOpenEnded && (
                <p className="text-xs text-muted-foreground -mt-1 mb-1">
                  Dieses Wochenmuster wird jede Woche neu besetzt, solange die Abwesenheit andauert.
                </p>
              )}
              <div className="border border-border rounded-md overflow-hidden text-xs">
                <div className="flex bg-muted text-center font-semibold">
                  <div className="w-10 border-r border-border py-1">Std.</div>
                  {['Mo', 'Di', 'Mi', 'Do', 'Fr'].map((day, i) => (
                    <button
                      type="button"
                      key={day}
                      className="flex-1 border-r border-border last:border-r-0 py-1 cursor-pointer hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                      onClick={() => toggleDay((i+1).toString())}
                    >
                      {day}
                    </button>
                  ))}
                </div>
                {[1,2,3,4,5,6,7,8,9,10].map(h => (
                  <div key={h} className="flex text-center border-t border-border">
                    <div className="w-10 border-r border-border py-1 bg-muted dark:bg-muted/50">{h}.</div>
                    {[1,2,3,4,5].map(day => {
                      const isSelected = schedule[day.toString()].includes(h);
                      return (
                        <button
                          type="button"
                          key={`${day}-${h}`}
                          className={`flex-1 border-r border-border last:border-r-0 py-1 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset ${isSelected ? 'bg-primary/15 text-primary' : 'bg-card text-muted-foreground/40 hover:bg-muted'}`}
                          onClick={() => toggleHour(day.toString(), h)}
                          aria-pressed={isSelected}
                          aria-label={`Stunde ${h}, Tag ${day}${isSelected ? ' ausgewählt' : ''}`}
                        >
                          {isSelected ? '✓' : '·'}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </fieldset>
          )}

          <div className="space-y-2 pt-2">
            <Label htmlFor="substitutedTeacher" className="flex items-center gap-2 font-medium">Vertretung für</Label>
            <Input
              id="substitutedTeacher"
              required
              placeholder="Name der ausgefallenen/fehlenden Lehrkraft..."
              value={substitutedTeacher}
              onChange={e => setSubstitutedTeacher(e.target.value)}
              className="min-h-10 border-border focus:ring-primary"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="className">Klasse / Lerngruppe (optional)</Label>
            <Input id="className" value={className} onChange={event => setClassName(event.target.value)} maxLength={80} placeholder="z. B. 3a" aria-describedby="className-help" />
            <p id="className-help" className="text-xs text-muted-foreground">Für dieselbe Klasse bitte immer dieselbe Bezeichnung verwenden. So kann das Schulamt Einsätze aus der Vorwoche berücksichtigen. Keine Schülernamen eintragen.</p>
          </div>

          <fieldset className="space-y-3 pt-2">
            <legend className="font-medium mb-2">Benötigte Schulart</legend>
            <div className="flex flex-wrap gap-2">
              {availableQuals.map(q => {
                const isSelected = quals.includes(q);
                return (
                  <button
                    type="button"
                    key={q}
                    onClick={() => toggleQual(q)}
                    aria-pressed={isSelected}
                    className={`min-h-10 rounded-lg border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                      isSelected
                        ? 'border-primary/30 bg-primary/10 text-primary dark:border-primary/40 dark:bg-primary/20'
                        : 'bg-muted text-muted-foreground border-border hover:bg-accent'
                    }`}
                  >
                    {q}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="space-y-2 pt-2">
            <Label htmlFor="comments" className="flex items-center gap-2 font-medium"><MessageSquare className="h-4 w-4 text-rose-500"/> Wichtig: Hier Besonderheiten eintragen...</Label>
            <p className="text-xs text-muted-foreground">Das Schulprofil wird automatisch mitübermittelt. Hier können Sie zusätzliche Hinweise für die Mobile Reserve eintragen.</p>
            <Textarea
              id="comments"
              placeholder="WICHTIG: Bitte geben Sie hier genaue Unterrichtsstartzeiten, Treffpunkt und Parkmöglichkeiten ein..."
              className="h-20 resize-none border-rose-200 focus:border-rose-500 focus:ring-primary dark:border-rose-900/50"
              value={comments}
              onChange={e => setComments(e.target.value)}
            />
            <div className="bg-rose-50 dark:bg-rose-950/30 border-l-4 border-rose-500 p-3 mt-2 rounded-r-md">
              <p className="text-sm font-semibold text-rose-800 dark:text-rose-300">⚠️ Achtung Datenschutz:</p>
              <p className="text-xs text-rose-700 dark:text-rose-400 mt-1">Bitte tragen Sie hier keinerlei gesundheitliche Daten (z. B. Diagnosen wie Corona, Beinbruch) oder sensible persönliche Details zur ausfallenden Lehrkraft ein. Diese Angaben sind für die zugewiesene Lehrkraft essenziell (Startzeiten, Parkplatz, etc.), nicht für medizinische Details.</p>
            </div>
          </div>

          {requestUrgencyNoteEnabled && <div className={`space-y-3 rounded-lg border p-4 ${hasUrgencyNote ? "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20" : "border-border"}`}>
            <label className="flex cursor-pointer items-start gap-3 text-sm font-medium">
              <input
                type="checkbox"
                checked={hasUrgencyNote}
                onChange={e => setHasUrgencyNote(e.target.checked)}
                disabled={isSubmitting}
                aria-controls="urgency-note-field"
                aria-describedby="urgency-note-help"
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              />
              Dringlichkeitshinweis fürs Schulamt hinzufügen
            </label>
            <p id="urgency-note-help" className="text-xs text-muted-foreground">Aktivieren Sie diese Option bei besonderer Dringlichkeit. Der Hinweis ist nur für das Schulamt sichtbar und wird nicht an Mobile Reserven weitergegeben.</p>
            {hasUrgencyNote && <div id="urgency-note-field" className="space-y-2">
              <Label htmlFor="urgencyNote">Dringlichkeitshinweis fürs Schulamt (Pflichtfeld)</Label>
              <Textarea
                id="urgencyNote"
                required
                maxLength={2000}
                disabled={isSubmitting}
                value={urgencyNote}
                onChange={e => setUrgencyNote(e.target.value)}
                placeholder="Bitte erläutern Sie, warum dieser Bedarf besonders dringend ist…"
                aria-describedby="urgency-note-privacy"
                className="min-h-24 border-amber-300 focus:ring-primary dark:border-amber-800"
              />
              <p id="urgency-note-privacy" className="text-xs text-muted-foreground">Bitte beschränken Sie sich auf organisatorische Gründe. Keine Gesundheitsdaten oder sensiblen persönlichen Angaben.</p>
            </div>}
          </div>}

        </CardContent>
        <CardFooter>
          <Button type="submit" className="min-h-11 w-full bg-primary py-3 text-primary-foreground hover:bg-primary/90" disabled={isSubmitting}>
            {isSubmitting ? "Wird gesendet..." : "Anfrage absenden"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
