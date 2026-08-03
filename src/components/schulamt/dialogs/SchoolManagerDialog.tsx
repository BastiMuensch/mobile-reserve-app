import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { School as SchoolIcon, KeySquare } from "lucide-react";
import { SchoolData, NewSchoolForm } from "@/types/models";

interface SchoolManagerDialogProps {
  isSchoolManagerOpen: boolean;
  setIsSchoolManagerOpen: (val: boolean) => void;
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
}

export function SchoolManagerDialog({
  isSchoolManagerOpen,
  setIsSchoolManagerOpen,
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
  handleUpdateCredentials
}: SchoolManagerDialogProps) {
  const { toast } = useToast();
  // Der Dialog bekommt vom Elternteil keinen Refresh-Callback für die Schulliste
  // (SchulamtDashboard reicht nur sortedSchools durch, kein onChanged o.ä.). Statt dafür den
  // Elternteil anzufassen, spiegeln wir den "Kleine Schule"-Status nach einem erfolgreichen
  // PATCH lokal - so zeigt die Liste sofort den neuen Stand, bis sie beim nächsten regulären
  // Neuladen (z.B. anderer Aktionen im Dashboard) ohnehin aktualisiert wird.
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
    <Dialog open={isSchoolManagerOpen} onOpenChange={setIsSchoolManagerOpen}>
      <DialogContent className="max-w-3xl sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Schul- und Passwortverwaltung</DialogTitle>
          <DialogDescription>
            Neue Schulen anlegen oder Passwörter für bestehende Schulen zurücksetzen.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 py-4 space-y-8">
          
          <div className="bg-muted/50 p-4 rounded-xl border border-border">
            <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
              <SchoolIcon className="w-5 h-5" /> Neue Schule hinzufügen
            </h3>
            <form onSubmit={handleAddSchool} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Name der Schule</Label>
                  <Input value={newSchool.name} onChange={e => setNewSchool({...newSchool, name: e.target.value})} required placeholder="z.B. GS Mindelheim" />
                </div>
                <div className="space-y-2">
                  <Label>Typ</Label>
                  <Select value={newSchool.type} onValueChange={v => v && setNewSchool({...newSchool, type: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
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
                  <Input value={newSchool.address} onChange={e => setNewSchool({...newSchool, address: e.target.value})} required />
                </div>
                <div className="space-y-2">
                  <Label>E-Mail-Adresse (Login)</Label>
                  <Input value={newSchool.email} onChange={e => setNewSchool({...newSchool, email: e.target.value})} required placeholder="schule@example.de" type="email" />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-2">
                  <Label>Initiales Passwort</Label>
                  <Input value={newSchool.password} onChange={e => setNewSchool({...newSchool, password: e.target.value})} required placeholder="z.B. gs-mindelheim-2026" />
                </div>
              </div>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(newSchool.isSmall)}
                  onChange={e => setNewSchool({...newSchool, isSmall: e.target.checked})}
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
          </div>

          <div>
            <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
              <KeySquare className="w-5 h-5" /> Passwörter verwalten
            </h3>
            <div className="space-y-2">
              {sortedSchools.map(school => (
                <div key={school.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 border border-border rounded-lg bg-card shadow-sm">
                  <div className="w-full sm:w-auto overflow-hidden">
                    <div className="font-bold truncate flex items-center gap-2">
                      {school.name}
                      {isSchoolSmall(school) && <Badge variant="outline">Kleine Schule</Badge>}
                    </div>
                    <div className="text-sm text-muted-foreground">{school.type}</div>
                    {school.user?.email && <div className="text-xs text-muted-foreground mt-1 truncate">{school.user.email}</div>}
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
                    <div className="flex flex-col gap-2 items-start sm:items-end w-full sm:w-auto">
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
                    <Button size="sm" variant="outline" onClick={() => {
                      setEditingPasswordId(school.id);
                      setNewEmail(school.user?.email || "");
                    }}>
                      Zugangsdaten ändern
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
