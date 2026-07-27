import { useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PlusCircle, Calendar, Clock, AlertCircle, MessageSquare } from "lucide-react";

import { AuthUser } from "../AuthProvider";
import { useToast } from "@/components/ui/toast";

export function SchoolRequestForm({ user, fetchRequests }: { user: AuthUser | null, fetchRequests: () => void }) {
  const { toast } = useToast();
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState("");
  const [priority, setPriority] = useState("UNPLANNED_ABSENCE");
  const [startHour, setStartHour] = useState("1");
  const [hours, setHours] = useState("4");
  const [substitutedTeacher, setSubstitutedTeacher] = useState("");
  const [quals, setQuals] = useState<string[]>([]);
  const [comments, setComments] = useState("");
  const [isLongTerm, setIsLongTerm] = useState(false);
  const [schedule, setSchedule] = useState<Record<string, number[]>>({
    "1": [], "2": [], "3": [], "4": [], "5": []
  });

  // Bei der Anforderung ist nur die Schulart relevant – sie beschreibt, wofür die
  // Vertretung gebraucht wird. Ob die Vertretung später von einer Lehrkraft, einer
  // Studentin oder einer Drittkraft übernommen wird, entscheidet das Schulamt bei der
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
    if (!date) return;
    if (isLongTerm && !endDate) {
      toast({ variant: "error", title: "Bitte geben Sie für längerfristige Bedarfe ein Enddatum an." });
      return;
    }
    if (!comments.trim()) {
      toast({ variant: "error", title: "Bitte füllen Sie das Kommentarfeld mit Startzeiten und Parkmöglichkeiten aus." });
      return;
    }

    let calculatedWeeklyHours = 0;
    if (isLongTerm) {
      Object.values(schedule).forEach(hoursArr => {
        calculatedWeeklyHours += hoursArr.length;
      });
      if (calculatedWeeklyHours === 0) {
        toast({ variant: "error", title: "Bitte markieren Sie im Stundenplan mindestens eine benötigte Stunde." });
        return;
      }
    } else {
      calculatedWeeklyHours = parseInt(hours);
    }

    const payloadSchedule = isLongTerm ? JSON.stringify(schedule) : null;

    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolId: user?.schoolId,
          date,
          endDate: isLongTerm ? (endDate || null) : null,
          priority,
          startHour: isLongTerm ? 1 : parseInt(startHour),
          hours: isLongTerm ? calculatedWeeklyHours : parseInt(hours),
          weeklyHours: calculatedWeeklyHours,
          schoolType: "GRUNDSCHULE",
          substitutedTeacher,
          schedule: payloadSchedule,
          qualifications: quals.join(","),
          comments: comments.trim(),
        }),
      });
      
      if (res.ok) {
        setDate(new Date().toISOString().split('T')[0]);
        setEndDate("");
        setPriority("UNPLANNED_ABSENCE");
        setStartHour("1");
        setHours("4");
        setSubstitutedTeacher("");
        setComments("");
        setQuals([]);
        setIsLongTerm(false);
        setSchedule({ "1": [], "2": [], "3": [], "4": [], "5": [] });
        fetchRequests();
      } else {
        const err = await res.json();
        toast({ variant: "error", title: err.error || "Fehler beim Erstellen der Anfrage." });
      }
    } catch (error) {
      console.error('Failed to submit request:', error);
      toast({ variant: "error", title: "Netzwerkfehler beim Erstellen der Anfrage." });
    }
  };

  return (
    <Card className="border-t-4 border-t-blue-500 shadow-xl bg-card/80 backdrop-blur-sm transition-all duration-300 hover:shadow-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <PlusCircle className="h-6 w-6 text-blue-500" />
          Bedarf melden
        </CardTitle>
        <CardDescription>Fordern Sie eine Mobile Reserve für einen bestimmten Tag an.</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="priority" className="flex items-center gap-2 font-medium"><AlertCircle className="h-4 w-4 text-rose-500"/> Grund (Priorität)</Label>
            <Select value={priority} onValueChange={(val) => val && setPriority(val)}>
              <SelectTrigger id="priority" className="shadow-sm">
                <SelectValue placeholder="Bitte wählen...">
                  {priority === 'UNPLANNED_ABSENCE' ? 'Ungeplanter Ausfall (Prio 1)' :
                   priority === 'FORTBILDUNG' ? 'Fortbildung (Prio 2)' :
                   'Schulintern geblockt (Prio 3)'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="UNPLANNED_ABSENCE">Ungeplanter Ausfall (Prio 1)</SelectItem>
                <SelectItem value="FORTBILDUNG">Fortbildung (Prio 2)</SelectItem>
                <SelectItem value="SCHULINTERN">Schulintern geblockt (Prio 3)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4 pb-4 border-b border-border">
            <Button type="button" variant={!isLongTerm ? "default" : "outline"} onClick={() => setIsLongTerm(false)}>
              1 Tag Bedarf
            </Button>
            <Button type="button" variant={isLongTerm ? "default" : "outline"} onClick={() => setIsLongTerm(true)}>
              Längerfristig
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date" className="flex items-center gap-2 font-medium"><Calendar className="h-4 w-4 text-blue-500"/> {isLongTerm ? "Startdatum" : "Datum"}</Label>
              <Input id="date" type="date" required value={date} onChange={e => setDate(e.target.value)} className="border-border focus:ring-blue-500 transition-all shadow-sm" />
            </div>
            {isLongTerm && (
              <div className="space-y-2">
                <Label htmlFor="endDate" className="flex items-center gap-2 font-medium"><Calendar className="h-4 w-4 text-blue-500"/> Enddatum</Label>
                <Input id="endDate" type="date" min={date} required value={endDate} onChange={e => setEndDate(e.target.value)} className="border-border focus:ring-blue-500 transition-all shadow-sm" />
              </div>
            )}
          </div>

          {!isLongTerm && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startHour" className="flex items-center gap-2 font-medium"><Clock className="h-4 w-4 text-blue-500"/> Ab Stunde</Label>
                <Select value={startHour} onValueChange={(val) => val && setStartHour(val)}>
                  <SelectTrigger id="startHour" className="shadow-sm"><SelectValue /></SelectTrigger>
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
                  <SelectTrigger id="hours" className="shadow-sm"><SelectValue /></SelectTrigger>
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
              className="border-border focus:ring-blue-500 shadow-sm"
            />
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
                    className={`text-sm px-4 py-2 rounded-xl cursor-pointer transition-all duration-200 border font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                      isSelected
                        ? 'bg-blue-100 text-blue-800 border-blue-300 shadow-sm dark:bg-blue-900/60 dark:text-blue-200 dark:border-blue-700 transform scale-105'
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
            <Label htmlFor="comments" className="flex items-center gap-2 font-medium"><MessageSquare className="h-4 w-4 text-rose-500"/> Pflicht: Bemerkungen (Startzeiten etc.)</Label>
            <Textarea
              id="comments"
              required
              placeholder="WICHTIG: Bitte geben Sie hier genaue Unterrichtsstartzeiten, Treffpunkt und Parkmöglichkeiten ein..."
              className="resize-none h-20 shadow-sm border-rose-200 focus:border-rose-500 focus:ring-blue-500 dark:border-rose-900/50"
              value={comments}
              onChange={e => setComments(e.target.value)}
            />
            <div className="bg-rose-50 dark:bg-rose-950/30 border-l-4 border-rose-500 p-3 mt-2 rounded-r-md">
              <p className="text-sm font-semibold text-rose-800 dark:text-rose-300">⚠️ Achtung Datenschutz:</p>
              <p className="text-xs text-rose-700 dark:text-rose-400 mt-1">Bitte tragen Sie hier keinerlei gesundheitliche Daten (z. B. Diagnosen wie Corona, Beinbruch) oder sensible persönliche Details zur ausfallenden Lehrkraft ein. Diese Angaben sind für die zugewiesene Lehrkraft essenziell (Startzeiten, Parkplatz, etc.), nicht für medizinische Details.</p>
            </div>
          </div>

        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-md hover:shadow-lg transition-all py-6 text-lg">
            Anfrage absenden
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
