import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
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
  return (
    <Dialog open={isSchoolManagerOpen} onOpenChange={setIsSchoolManagerOpen}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Schul- und Passwortverwaltung</DialogTitle>
          <DialogDescription>
            Neue Schulen anlegen oder Passwörter für bestehende Schulen zurücksetzen.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 py-4 space-y-8">
          
          <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border">
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
                <div key={school.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 border rounded-lg bg-white dark:bg-slate-900 shadow-sm">
                  <div className="w-full sm:w-auto overflow-hidden">
                    <div className="font-bold truncate">{school.name}</div>
                    <div className="text-sm text-slate-500">{school.type}</div>
                    {school.user?.email && <div className="text-xs text-slate-400 mt-1 truncate">{school.user.email}</div>}
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
