"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, User, MapPin, BookOpen, Clock, AlertCircle } from "lucide-react";
import { SchoolData } from "@/types/models";

function RegisterTeacherForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const schulamtId = searchParams.get("schulamtId");

  const [schools, setSchools] = useState<{id: string, name: string}[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Form State
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [stammschuleId, setStammschuleId] = useState("");
  const [address, setAddress] = useState("");
  const [qualifications, setQualifications] = useState("");
  const [preferredType, setPreferredType] = useState("BOTH");
  const [maxWeeklyHours, setMaxWeeklyHours] = useState("20");
  const [isPartTime, setIsPartTime] = useState(false);
  const [schedule, setSchedule] = useState<Record<string, number[]>>({
    "1": [], "2": [], "3": [], "4": [], "5": []
  });

  useEffect(() => {
    if (!schulamtId) {
      setError("Kein gültiger Registrierungslink. Bitte wenden Sie sich an Ihr Schulamt.");
      setLoading(false);
      return;
    }

    const fetchSchools = async () => {
      try {
        const res = await fetch(`/api/public/schools?schulamtId=${schulamtId}`);
        if (res.ok) {
          const data = await res.json();
          setSchools(data);
        } else {
          setError("Fehler beim Laden der Schulen.");
        }
      } catch (err) {
        setError("Netzwerkfehler.");
      } finally {
        setLoading(false);
      }
    };
    fetchSchools();
  }, [schulamtId]);

  const toggleScheduleHour = (day: string, hour: number) => {
    setSchedule(prev => {
      const dayHours = prev[day] || [];
      if (dayHours.includes(hour)) {
        return { ...prev, [day]: dayHours.filter(h => h !== hour) };
      } else {
        return { ...prev, [day]: [...dayHours, hour].sort((a, b) => a - b) };
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schulamtId) return;

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch('/api/setup/register-teacher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          password,
          stammschuleId,
          address,
          qualifications,
          preferredType,
          isPartTime,
          schedule: isPartTime ? schedule : null,
          maxWeeklyHours: parseInt(maxWeeklyHours)
        })
      });

      if (res.ok) {
        setSuccess(true);
      } else {
        const data = await res.json();
        setError(data.error || "Ein Fehler ist aufgetreten.");
      }
    } catch (err) {
      setError("Netzwerkfehler. Bitte später erneut versuchen.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-[50vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (success) {
    return (
      <Card className="max-w-2xl mx-auto shadow-xl border-t-8 border-t-emerald-500">
        <CardHeader className="text-center pb-8">
          <div className="mx-auto bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 rounded-full p-4 w-20 h-20 flex items-center justify-center mb-6">
            <CheckCircle2 className="h-10 w-10" />
          </div>
          <CardTitle className="text-3xl font-bold text-foreground">Registrierung erfolgreich!</CardTitle>
          <CardDescription className="text-lg mt-4">
            Vielen Dank für Ihre Anmeldung als Mobile Reserve.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center space-y-4 pb-8">
          <p className="text-muted-foreground">
            Ihr Account wurde angelegt und befindet sich nun im <strong>Warteraum</strong>.
          </p>
          <p className="text-muted-foreground">
            Das zuständige Schulamt wurde informiert und wird Ihren Account in Kürze freischalten.
            Sobald dies geschehen ist, können Sie sich einloggen und auf Ihr Dashboard zugreifen.
          </p>
        </CardContent>
        <CardFooter className="flex justify-center">
          <Button onClick={() => router.push('/')} size="lg">Zurück zur Startseite</Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="max-w-2xl mx-auto shadow-xl border-t-8 border-t-primary">
      <CardHeader className="space-y-2">
        <CardTitle className="text-3xl font-bold text-foreground tracking-tight">Als Mobile Reserve registrieren</CardTitle>
        <CardDescription className="text-base text-muted-foreground">
          Willkommen! Bitte füllen Sie das folgende Profil aus. Ihre Angaben helfen uns dabei,
          Sie später passgenau für Einsätze anzufragen.
        </CardDescription>
        {error && (
          <div className="bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 p-4 rounded-xl flex items-start gap-3 mt-4 border border-red-100 dark:border-red-900/50">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-8">
          
          {/* Section 1: Personal Info */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2 text-foreground border-b pb-2">
              <User className="h-5 w-5 text-primary" /> Persönliche Daten
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Vor- und Nachname</Label>
                <Input id="name" required value={name} onChange={e => setName(e.target.value)} placeholder="Max Mustermann" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">E-Mail Adresse (Dienstlich oder Privat)</Label>
                <Input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="max@beispiel.de" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="password">Passwort (für den Login)</Label>
                <Input id="password" type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Mindestens 6 Zeichen" minLength={6} />
              </div>
            </div>
          </div>

          {/* Section 2: School & Address */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2 text-foreground border-b pb-2">
              <MapPin className="h-5 w-5 text-primary" /> Stammschule & Adresse
            </h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="stammschule">Ihre feste Stammschule</Label>
                <Select value={stammschuleId} onValueChange={(val) => val && setStammschuleId(val)} required>
                  <SelectTrigger id="stammschule">
                    <SelectValue placeholder="Bitte Schule wählen...">
                      {stammschuleId ? schools.find(s => s.id === stammschuleId)?.name : undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {schools.map(school => (
                      <SelectItem key={school.id} value={school.id}>{school.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Wohnadresse (Straße, Hausnummer, PLZ, Ort)</Label>
                <p className="text-xs text-muted-foreground">Ihre Adresse wird ausschließlich zur automatischen Berechnung der Fahrzeit zu Einsatzorten (Routenplanung) verwendet.</p>
                <Input id="address" required value={address} onChange={e => setAddress(e.target.value)} placeholder="Musterstraße 1, 87719 Mindelheim" />
              </div>
            </div>
          </div>

          {/* Section 3: Qualifications */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2 text-foreground border-b pb-2">
              <BookOpen className="h-5 w-5 text-primary" /> Einsatz & Qualifikationen
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="preferredType">Einsatzpräferenz</Label>
                <Select value={preferredType} onValueChange={(val) => val && setPreferredType(val)}>
                  <SelectTrigger id="preferredType">
                    <SelectValue>
                      {preferredType === "BOTH" ? "Egal (Grund- und Mittelschule)" : 
                       preferredType === "GRUNDSCHULE" ? "Nur Grundschule" : 
                       "Nur Mittelschule"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BOTH">Egal (Grund- und Mittelschule)</SelectItem>
                    <SelectItem value="GRUNDSCHULE">Nur Grundschule</SelectItem>
                    <SelectItem value="MITTELSCHULE">Nur Mittelschule</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="quals">Fächer / Qualifikationen</Label>
                <Input id="quals" required value={qualifications} onChange={e => setQualifications(e.target.value)} placeholder="z.B. Sport, WTG, Musik" />
              </div>
            </div>
          </div>

          {/* Section 4: Schedule */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2 text-foreground border-b pb-2">
              <Clock className="h-5 w-5 text-primary" /> Arbeitszeit & Stundenplan
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="maxWeeklyHours">Stundenverpflichtung (wöchentlich)</Label>
                <Input id="maxWeeklyHours" type="number" min="1" max="40" required value={maxWeeklyHours} onChange={e => setMaxWeeklyHours(e.target.value)} />
              </div>
              <div className="flex items-center gap-3 pt-6 border p-4 rounded-xl bg-muted dark:bg-muted/50">
                <input 
                  type="checkbox" 
                  id="partTime" 
                  checked={isPartTime}
                  onChange={(e) => setIsPartTime(e.target.checked)}
                  className="w-5 h-5 rounded border-input text-primary focus:ring-primary"
                />
                <Label htmlFor="partTime" className="cursor-pointer font-medium text-base">Ich bin in Teilzeit</Label>
              </div>
            </div>

            {isPartTime && (
              <div className="mt-4 border border-primary/20 rounded-xl p-6 bg-primary/5 animate-in slide-in-from-top-4 fade-in duration-300">
                <h4 className="font-semibold mb-2 text-foreground">Verfügbarkeits-Stundenplan</h4>
                <p className="text-sm text-muted-foreground mb-4">Bitte markieren Sie alle Schulstunden (1. bis 10. Stunde), zu denen Sie regulär an Ihrer Stammschule arbeiten <b>oder</b> für einen Mobilen Einsatz zur Verfügung stehen.</p>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                  {['1', '2', '3', '4', '5'].map((dayNum) => {
                    const dayNames = ["", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"];
                    const dayName = dayNames[parseInt(dayNum)];
                    return (
                      <div key={dayNum} className="space-y-2">
                        <div className="font-medium text-sm text-foreground text-center">{dayName}</div>
                        <div className="flex flex-col gap-1.5">
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(hour => {
                            const isSelected = schedule[dayNum]?.includes(hour);
                            return (
                              <button
                                key={hour}
                                type="button"
                                onClick={() => toggleScheduleHour(dayNum, hour)}
                                className={`py-1.5 text-xs font-medium rounded-md transition-all duration-200 border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                                  isSelected
                                    ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                                    : 'bg-card text-muted-foreground border-border hover:border-primary/40 hover:bg-primary/5'
                                }`}
                                aria-pressed={isSelected}
                              >
                                {hour}. Stunde
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="pt-6">
            <Button type="submit" size="lg" className="w-full text-lg h-12 shadow-md hover:shadow-lg transition-all" disabled={submitting || !schulamtId}>
              {submitting ? "Wird registriert..." : "Kostenpflichtig buchen? Nein Spaß, einfach registrieren!"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default function RegisterTeacherPage() {
  return (
    <div className="min-h-screen bg-background py-12 px-4 sm:px-6 lg:px-8">
      <Suspense fallback={
        <div className="flex justify-center items-center h-[50vh]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      }>
        <RegisterTeacherForm />
      </Suspense>
    </div>
  );
}
