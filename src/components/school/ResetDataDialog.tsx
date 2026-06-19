import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export function ResetDataDialog({
  isOpen,
  setIsOpen,
  resetConfirmation,
  setResetConfirmation,
  schoolName,
  handleResetData,
  resettingData
}: {
  isOpen: boolean;
  setIsOpen: (v: boolean) => void;
  resetConfirmation: string;
  setResetConfirmation: (v: string) => void;
  schoolName: string;
  handleResetData: () => void;
  resettingData: boolean;
}) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if(!open) setResetConfirmation(""); }}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-red-600 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" /> Wirklich alle Daten löschen?
          </DialogTitle>
          <DialogDescription>
            Diese Aktion kann <strong className="text-slate-900 dark:text-white">nicht rückgängig</strong> gemacht werden. Alle vergangenen und zukünftigen Anforderungen sowie Zuweisungen werden permanent aus der Datenbank entfernt.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>
              Zur Bestätigung tippen Sie bitte den Namen Ihrer Schule ein: <br/>
              <span className="font-mono text-sm text-slate-500">{schoolName}</span>
            </Label>
            <Input 
              value={resetConfirmation} 
              onChange={e => setResetConfirmation(e.target.value)} 
              placeholder={schoolName}
              className="font-mono"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>Abbrechen</Button>
          <Button variant="destructive" onClick={handleResetData} disabled={resettingData || resetConfirmation !== schoolName}>
            {resettingData ? "Lösche Daten..." : "Endgültig löschen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
