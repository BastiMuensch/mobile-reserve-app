import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { School as SchoolIcon, KeySquare, MapPin, Mail } from "lucide-react";
import { SchoolData, NewSchoolForm } from "@/types/models";

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
  /** Wird nach dem Umschalten von "Kleine Schule" aufgerufen. */
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

  return (
    <div className="space-y-6">
      <Card className="shadow-xl bg-card/80 backdrop-blur-sm border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <SchoolIcon className="w-5 h-5 text-muted-foreground" /> Neue Schule anlegen
          </CardTitle>
          <CardDescription>Die Schule erhält damit einen eigenen Zugang, um Bedarfe zu melden.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddSchool} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name der Schule</Label>
                <Input value={newSchool.name} onChange={e => setNewSchool({ ...newSchool, name: e.target.value })} required placeholder="z.B. GS Mindelheim" />
              </div>
              <div className="space-y-2">
                <Label>Typ</Label>
                <Select value={newSchool.type} onValueChange={v => v && setNewSchool({ ...newSchool, type: v })}>
                  {/* Ohne eigene Ausgabe zeigt die Select-Komponente den rohen Wert
                      ("GRUNDSCHULE") statt der lesbaren Bezeichnung an. */}
                  <SelectTrigger>
                    <SelectValue>{(value: string) => value === 'MITTELSCHULE' ? 'Mittelschule' : 'Grundschule'}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GRUNDSCHULE">Grundschule</SelectItem>
                    <SelectItem value="MITTELSCHULE">Mittelschule</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Adresse</Label>
                <Input value={newSchool.address} onChange={e => setNewSchool({ ...newSchool, address: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label>E-Mail-Adresse (Login)</Label>
                <Input value={newSchool.email} onChange={e => setNewSchool({ ...newSchool, email: e.target.value })} required placeholder="schule@example.de" type="email" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Initiales Passwort</Label>
              <Input value={newSchool.password} onChange={e => setNewSchool({ ...newSchool, password: e.target.value })} required placeholder="z.B. gs-mindelheim-2026" />
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

      <Card className="shadow-xl bg-card/80 backdrop-blur-sm border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <KeySquare className="w-5 h-5 text-muted-foreground" /> Schulen ({sortedSchools.length})
          </CardTitle>
          <CardDescription>Kontakt- und Zugangsdaten aller Schulen dieses Schulamts.</CardDescription>
        </CardHeader>
        <CardContent>
          {sortedSchools.length === 0 ? (
            <p className="text-muted-foreground italic py-4">Noch keine Schulen angelegt.</p>
          ) : (
            <div className="space-y-2">
              {sortedSchools.map(school => (
                <div key={school.id} className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 p-3 border border-border rounded-xl bg-card shadow-sm">
                  <div className="w-full sm:w-auto min-w-0">
                    <div className="font-bold flex items-center gap-2 flex-wrap">
                      {school.name}
                      <Badge variant="outline" className="text-[10px]">
                        {school.type === 'GRUNDSCHULE' ? 'Grundschule' : school.type === 'MITTELSCHULE' ? 'Mittelschule' : school.type}
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
                      <div className="text-sm text-muted-foreground flex items-center gap-1.5 truncate">
                        <Mail className="w-3.5 h-3.5 shrink-0" /> {school.user.email}
                      </div>
                    )}
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
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
