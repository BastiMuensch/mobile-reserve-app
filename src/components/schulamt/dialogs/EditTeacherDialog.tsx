import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { SchoolData, EditTeacherForm } from "@/types/models";

interface EditTeacherDialogProps {
  isEditTeacherOpen: boolean;
  setIsEditTeacherOpen: (val: boolean) => void;
  editTeacherData: EditTeacherForm | null;
  setEditTeacherData: (val: EditTeacherForm | null) => void;
  handleEditTeacher: (e: React.FormEvent) => void;
  isEditingTeacher: boolean;
  sortedSchools: SchoolData[];
  editSchedule: Record<string, number[]>;
  setEditSchedule: React.Dispatch<React.SetStateAction<Record<string, number[]>>>;
}

export function EditTeacherDialog({
  isEditTeacherOpen,
  setIsEditTeacherOpen,
  editTeacherData,
  setEditTeacherData,
  handleEditTeacher,
  isEditingTeacher,
  sortedSchools,
  editSchedule,
  setEditSchedule
}: EditTeacherDialogProps) {
  if (!editTeacherData) return null;

  return (
    <Dialog open={isEditTeacherOpen} onOpenChange={setIsEditTeacherOpen}>
      <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Lehrkraft bearbeiten</DialogTitle>
          <DialogDescription>
            Passen Sie die Daten, Arbeitszeiten oder Kontaktdaten an.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleEditTeacher} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Name</Label>
            <Input id="edit-name" value={editTeacherData.name} onChange={e => setEditTeacherData({...editTeacherData, name: e.target.value})} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-gender">Geschlecht</Label>
            <Select value={editTeacherData.gender} onValueChange={v => setEditTeacherData({...editTeacherData, gender: v ?? ""})}>
              <SelectTrigger><SelectValue placeholder="Bitte wählen" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="FEMALE">Weiblich</SelectItem>
                <SelectItem value="MALE">Männlich</SelectItem>
                <SelectItem value="DIVERSE">Divers</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-email">E-Mail</Label>
              <Input id="edit-email" type="email" value={editTeacherData.email} onChange={e => setEditTeacherData({...editTeacherData, email: e.target.value})} placeholder="lehrer@schule.de" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-password">Neues Passwort (Optional)</Label>
              <Input id="edit-password" type="password" value={editTeacherData.password} onChange={e => setEditTeacherData({...editTeacherData, password: e.target.value})} placeholder="Passwort ändern" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-phone">Telefonnummer</Label>
            <Input id="edit-phone" type="tel" value={editTeacherData.phone} onChange={e => setEditTeacherData({...editTeacherData, phone: e.target.value})} placeholder="0151 12345678" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-stammschule">Stammschule</Label>
            <Select value={editTeacherData.stammschuleId} onValueChange={v => v && setEditTeacherData({...editTeacherData, stammschuleId: v})}>
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
              <Select value={editTeacherData.isPartTime ? "Teilzeit" : "Vollzeit"} onValueChange={v => setEditTeacherData({...editTeacherData, isPartTime: v === "Teilzeit"})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Vollzeit">Vollzeit</SelectItem>
                  <SelectItem value="Teilzeit">Teilzeit (Stundenplan)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-maxWeeklyHours">Stunden/Woche</Label>
              <Input id="edit-maxWeeklyHours" type="number" min="1" max="40" value={editTeacherData.maxWeeklyHours} onChange={e => setEditTeacherData({...editTeacherData, maxWeeklyHours: e.target.value})} required />
            </div>
          </div>
          
          {editTeacherData.isPartTime && (
            <div className="space-y-2 pt-1">
              <Label className="text-xs text-muted-foreground">Verfügbarkeit anpassen</Label>
              <div className="border border-border rounded-md overflow-x-auto text-xs">
                <div className="min-w-[400px]">
                  <div className="flex bg-muted text-center font-semibold">
                    <div className="w-10 border-r border-border py-1">Std.</div>
                    {['Mo', 'Di', 'Mi', 'Do', 'Fr'].map((day, i) => (
                      <div
                        key={day}
                        className="flex-1 border-r border-border last:border-r-0 py-1 cursor-pointer hover:bg-accent transition-colors"
                        onClick={() => {
                          const dStr = (i+1).toString();
                          setEditSchedule(prev => {
                            const allSelected = prev[dStr].length === 10;
                            return { ...prev, [dStr]: allSelected ? [] : [1,2,3,4,5,6,7,8,9,10] };
                          });
                        }}
                      >
                        {day}
                      </div>
                    ))}
                  </div>
                  {[1,2,3,4,5,6,7,8,9,10].map(h => (
                    <div key={h} className="flex text-center border-t border-border">
                      <div className="w-10 border-r border-border py-1 bg-muted/50">{h}.</div>
                      {[1,2,3,4,5].map(day => {
                        const isSelected = editSchedule[day.toString()]?.includes(h);
                        return (
                          <div
                            key={`${day}-${h}`}
                            className={`flex-1 border-r border-border last:border-r-0 py-1 cursor-pointer transition-colors ${isSelected ? 'bg-primary/15 text-primary' : 'bg-card text-muted-foreground/40 hover:bg-muted'}`}
                            onClick={() => {
                              const dStr = day.toString();
                              setEditSchedule(prev => {
                                const hours = prev[dStr] || [];
                                return { ...prev, [dStr]: hours.includes(h) ? hours.filter(x => x !== h) : [...hours, h].sort((a,b) => a-b) };
                              });
                            }}
                          >
                            {isSelected ? '✓' : '·'}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="edit-qualifications">Qualifikation</Label>
            <Select value={editTeacherData.qualifications} onValueChange={v => v && setEditTeacherData({...editTeacherData, qualifications: v})}>
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
          <div className="space-y-2">
            <Label htmlFor="edit-address">Wohnort (Nur ausfüllen bei Änderung)</Label>
            <Input id="edit-address" placeholder="Neue Adresse für Map-Pin..." value={editTeacherData.address} onChange={e => setEditTeacherData({...editTeacherData, address: e.target.value})} />
          </div>
          <DialogFooter className="pt-4">
            <Button type="submit" className="w-full" disabled={isEditingTeacher}>
              {isEditingTeacher ? "Wird gespeichert..." : "Änderungen speichern"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
