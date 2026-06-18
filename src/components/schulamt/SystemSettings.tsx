import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RotateCcw, School as SchoolIcon, Settings, FileText, FileDown, ChevronDown, Upload } from "lucide-react";
import { SystemSettingsForm, TemplateSettingsForm } from "@/types/models";

interface SystemSettingsProps {
  setIsSchoolManagerOpen: (val: boolean) => void;
  setTemplateSettings: (val: TemplateSettingsForm) => void;
  setIsTemplateSettingsOpen: (val: boolean) => void;
  isRestoringBackup: boolean;
  handleRestoreBackup: (file: File) => void;
  loadData: () => void;
}

export function SystemSettings({
  setIsSchoolManagerOpen,
  setTemplateSettings,
  setIsTemplateSettingsOpen,
  isRestoringBackup,
  handleRestoreBackup,
  loadData
}: SystemSettingsProps) {
  return (
    <div className="w-full">
      <DropdownMenu>
        <DropdownMenuTrigger className="w-full flex justify-between items-center bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-slate-200 dark:border-slate-800 shadow-sm h-14 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl transition-all hover:shadow-md px-4 border">
          <span className="flex items-center gap-3 font-semibold">
              <Settings className="h-5 w-5 text-slate-500" />
              Verwaltung & Einstellungen
            </span>
            <ChevronDown className="h-4 w-4 text-slate-400" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[320px] p-2 rounded-xl shadow-xl border-slate-100 dark:border-slate-800" align="start" sideOffset={8}>
          <DropdownMenuLabel className="text-xs text-slate-400 uppercase tracking-wider font-bold mb-1">Stammdaten</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => setIsSchoolManagerOpen(true)} className="cursor-pointer gap-3 py-3 rounded-lg focus:bg-slate-50 dark:focus:bg-slate-800/50">
            <SchoolIcon className="h-4 w-4 text-indigo-500" /> <span className="font-medium">Schulen verwalten</span>
          </DropdownMenuItem>

          <DropdownMenuItem onClick={async () => {
            try {
              const r = await fetch(`/api/schulamt/profile?t=${Date.now()}`, { cache: 'no-store' });
              if (!r.ok) throw new Error('Failed');
              const data = await r.json();
              setTemplateSettings({
                headerText: data.headerText || "",
                returnAddress: data.returnAddress || "",
                logoUrl: data.logoUrl || "",
                contactAddress: data.contactAddress || "",
                contactPerson: data.contactPerson || "",
                city: data.city || "",
                amtsleitungName: data.amtsleitungName || "",
                amtsleitungTitle: data.amtsleitungTitle || "",
                signatureUrl: data.signatureUrl || "",
                smtpHost: data.smtpHost || "",
                smtpUser: data.smtpUser || "",
                smtpPass: data.smtpPass || ""
              });
              setIsTemplateSettingsOpen(true);
            } catch (e) {
              alert('Profil konnte nicht geladen werden.');
            }
          }} className="cursor-pointer gap-3 py-3 rounded-lg focus:bg-slate-50 dark:focus:bg-slate-800/50">
            <FileText className="h-4 w-4 text-violet-500" /> <span className="font-medium">Schulamt Profil & Mail-Server</span>
          </DropdownMenuItem>
          
          <DropdownMenuSeparator className="my-2 bg-slate-100 dark:bg-slate-800" />
          <DropdownMenuLabel className="text-xs text-slate-400 uppercase tracking-wider font-bold mb-1">Daten & Backup</DropdownMenuLabel>
          
          <DropdownMenuItem onClick={() => window.open('/api/export', '_blank')} className="cursor-pointer gap-3 py-3 rounded-lg focus:bg-slate-50 dark:focus:bg-slate-800/50">
            <FileDown className="h-4 w-4 text-emerald-500" /> <span className="font-medium">CSV Export (Jahresende)</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => window.open('/api/backup/export', '_blank')} className="cursor-pointer gap-3 py-3 rounded-lg focus:bg-slate-50 dark:focus:bg-slate-800/50">
            <FileDown className="h-4 w-4 text-blue-500" /> <span className="font-medium">Komplett-Backup herunterladen</span>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={isRestoringBackup} onClick={() => document.getElementById('backup-upload-input')?.click()} className="cursor-pointer gap-3 py-3 rounded-lg focus:bg-slate-50 dark:focus:bg-slate-800/50">
            <Upload className="h-4 w-4 text-rose-500" /> <span className="font-medium">{isRestoringBackup ? 'Wiederherstellen...' : 'Backup wiederherstellen'}</span>
          </DropdownMenuItem>
          
          <DropdownMenuSeparator className="my-2 bg-slate-100 dark:bg-slate-800" />
          
          <DropdownMenuItem 
            className="cursor-pointer gap-3 py-3 rounded-lg text-red-600 focus:text-red-700 focus:bg-red-50 dark:text-red-500 dark:focus:bg-red-950/30"
            onClick={() => {
              const input = prompt('ACHTUNG: Dies löscht ALLE Anfragen und Zuweisungen dauerhaft!\n\nBitte tippen Sie RESET ein, um zu bestätigen:');
              if (input === 'RESET') {
                fetch('/api/reset', { method: 'POST' })
                  .then(res => {
                    if (!res.ok) throw new Error('Reset fehlgeschlagen');
                    loadData();
                    alert('System wurde erfolgreich zurückgesetzt.');
                  })
                  .catch(() => alert('Fehler beim Zurücksetzen des Systems.'));
              } else if (input !== null) {
                alert('Eingabe stimmt nicht überein. Reset wurde abgebrochen.');
              }
            }}
          >
            <RotateCcw className="h-4 w-4" /> <span className="font-bold">Neues Schuljahr (Reset)</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <input 
        id="backup-upload-input"
        type="file" 
        accept=".json,application/json" 
        className="hidden" 
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            handleRestoreBackup(file);
            e.target.value = ''; // Reset input so same file can be selected again
          }
        }}
      />
    </div>
  );
}
