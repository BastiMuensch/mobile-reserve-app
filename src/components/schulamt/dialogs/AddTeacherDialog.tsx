import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { SchoolData, NewTeacherForm } from "@/types/models";

interface AddTeacherDialogProps {
  isAddTeacherOpen: boolean;
  setIsAddTeacherOpen: (val: boolean) => void;
  handleAddTeacher: (e: React.FormEvent) => void;
  newTeacher: NewTeacherForm;
  setNewTeacher: (val: NewTeacherForm) => void;
  isAdding: boolean;
  sortedSchools: SchoolData[];
  schedule: Record<string, number[]>;
  toggleDay: (day: string) => void;
  toggleHour: (day: string, hour: number) => void;
}

export function AddTeacherDialog({
  isAddTeacherOpen,
  setIsAddTeacherOpen,
  handleAddTeacher,
  newTeacher,
  setNewTeacher,
  isAdding,
  sortedSchools,
  schedule,
  toggleDay,
  toggleHour
}: AddTeacherDialogProps) {
  return (
    <Dialog open={isAddTeacherOpen} onOpenChange={setIsAddTeacherOpen}>
      <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Neue Mobile Reserve anlegen</DialogTitle>
          <DialogDescription>
            Fügen Sie eine neue Lehrkraft zum Pool des Staatlichen Schulamts hinzu.
          </DialogDescription>
        </DialogHeader>
        
        {sortedSchools.length === 0 && (
          <div className="mx-4 mt-4 p-3 bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/20 rounded-lg text-sm leading-relaxed">
            <strong>Wichtig für die Ersteinrichtung:</strong> Bitte legen Sie zuerst die Schulen an (im Reiter &quot;Verwaltung&quot;), bevor Sie hier Lehrkräfte hinzufügen. Jede Lehrkraft muss zwingend einer Stammschule zugewiesen werden.
          </div>
        )}

        <form onSubmit={handleAddTeacher} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={newTeacher.name} onChange={e => setNewTeacher({...newTeacher, name: e.target.value})} required />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="gender">Geschlecht</Label>
              <Select value={newTeacher.gender} onValueChange={v => setNewTeacher({...newTeacher, gender: v ?? ""})}>
                <SelectTrigger><SelectValue placeholder="Bitte wählen" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="FEMALE">Weiblich</SelectItem>
                  <SelectItem value="MALE">Männlich</SelectItem>
                  <SelectItem value="DIVERSE">Divers</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-Mail (Optional)</Label>
              <Input id="email" type="email" value={newTeacher.email} onChange={e => setNewTeacher({...newTeacher, email: e.target.value})} placeholder="lehrer@schule.de" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Passwort (Optional)</Label>
              <Input id="password" type="password" value={newTeacher.password} onChange={e => setNewTeacher({...newTeacher, password: e.target.value})} placeholder="Passwort für Login" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Telefonnummer</Label>
            <Input id="phone" type="tel" value={newTeacher.phone} onChange={e => setNewTeacher({...newTeacher, phone: e.target.value})} placeholder="0151 12345678" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="stammschule">Stammschule</Label>
            <Select value={newTeacher.stammschuleId} onValueChange={v => v && setNewTeacher({...newTeacher, stammschuleId: v})}>
              <SelectTrigger><SelectValue placeholder="Schule auswählen" /></SelectTrigger>
              <SelectContent>
                {sortedSchools.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Arbeitszeitmodell</Label>
              <Select value={newTeacher.isPartTime ? "Teilzeit" : "Vollzeit"} onValueChange={v => setNewTeacher({...newTeacher, isPartTime: v === "Teilzeit"})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Vollzeit">Vollzeit</SelectItem>
                  <SelectItem value="Teilzeit">Teilzeit (Stundenplan)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxWeeklyHours">Stunden/Woche</Label>
              <Input id="maxWeeklyHours" type="number" min="1" max="40" value={newTeacher.maxWeeklyHours} onChange={e => setNewTeacher({...newTeacher, maxWeeklyHours: e.target.value})} required />
            </div>
          </div>
          
          {newTeacher.isPartTime && (
            <div className="space-y-2 pt-1">
              <Label className="text-xs text-muted-foreground">Verfügbarkeit (Klick auf Tag markiert alles)</Label>
              <div className="border border-border rounded-md overflow-hidden text-xs">
                <div className="flex bg-muted text-center font-semibold">
                  <div className="w-10 border-r border-border py-1">Std.</div>
                  {['Mo', 'Di', 'Mi', 'Do', 'Fr'].map((day, i) => (
                    <div key={day} className="flex-1 border-r border-border last:border-r-0 py-1 cursor-pointer hover:bg-accent transition-colors" onClick={() => toggleDay((i+1).toString())}>{day}</div>
                  ))}
                </div>
                {[1,2,3,4,5,6,7,8,9,10].map(h => (
                  <div key={h} className="flex text-center border-t border-border">
                    <div className="w-10 border-r border-border py-1 bg-muted/50">{h}.</div>
                    {[1,2,3,4,5].map(day => {
                      const isSelected = schedule[day.toString()].includes(h);
                      return (
                        <div
                          key={`${day}-${h}`}
                          className={`flex-1 border-r border-border last:border-r-0 py-1 cursor-pointer transition-colors ${isSelected ? 'bg-primary/15 text-primary' : 'bg-card text-muted-foreground/40 hover:bg-muted'}`}
                          onClick={() => toggleHour(day.toString(), h)}
                        >
                          {isSelected ? '✓' : '·'}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-2">
              <Label htmlFor="qualifications">Qualifikation</Label>
              <Select value={newTeacher.qualifications} onValueChange={v => v && setNewTeacher({...newTeacher, qualifications: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Grundschule">Grundschule</SelectItem>
                  <SelectItem value="Mittelschule">Mittelschule</SelectItem>
                  <SelectItem value="Student/in">Student/in</SelectItem>
                  <SelectItem value="Drittkraft">Drittkraft</SelectItem>
                  <SelectItem value="Alles">Alles</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="address">Wohnort (Adresse)</Label>
            <Input id="address" placeholder="z.B. Marienplatz 1, München" value={newTeacher.address} onChange={e => setNewTeacher({...newTeacher, address: e.target.value})} required />
            <p className="text-xs text-muted-foreground mt-1">Koordinaten werden automatisch ermittelt.</p>
          </div>
          <DialogFooter className="pt-4">
            <Button type="submit" className="w-full" disabled={isAdding}>
              {isAdding ? "Wird gespeichert..." : "Lehrkraft speichern"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
