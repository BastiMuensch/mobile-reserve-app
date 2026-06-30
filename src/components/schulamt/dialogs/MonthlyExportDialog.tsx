import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { TeacherData } from "@/types/models";
import { FileDown } from "lucide-react";

interface MonthlyExportDialogProps {
  teacher: TeacherData | null;
  isOpen: boolean;
  setIsOpen: (val: boolean) => void;
}

export function MonthlyExportDialog({ teacher, isOpen, setIsOpen }: MonthlyExportDialogProps) {
  const [month, setMonth] = useState("");

  useEffect(() => {
    if (isOpen) {
      const currentYear = new Date().getFullYear();
      const currentMonthNum = new Date().getMonth() + 1;
      setMonth(`${currentYear}-${String(currentMonthNum).padStart(2, '0')}`);
    }
  }, [isOpen]);

  if (!teacher) return null;

  const handleExport = () => {
    if (!month) return;
    window.open(`/api/teachers/${teacher.id}/export-monthly?month=${month}`, '_blank');
    setIsOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Monatsübersicht (PDF)</DialogTitle>
          <DialogDescription>
            Wählen Sie den gewünschten Monat aus, um die Monatsübersicht für <strong>{teacher.name}</strong> herunterzuladen.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <input 
            type="month" 
            value={month} 
            onChange={e => setMonth(e.target.value)}
            className="w-full border border-slate-300 dark:border-slate-700 rounded-md px-3 py-2 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-primary focus:outline-none"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            Abbrechen
          </Button>
          <Button onClick={handleExport} className="gap-2">
            <FileDown className="h-4 w-4" /> Herunterladen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
