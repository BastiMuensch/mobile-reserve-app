import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RotateCcw, School as SchoolIcon, Settings, FileText, FileDown } from "lucide-react";
import { MailSettings, TemplateSettingsForm } from "@/types/models";

interface SystemSettingsProps {
  setIsSchoolManagerOpen: (val: boolean) => void;
  setSettings: (val: MailSettings) => void;
  setIsSettingsOpen: (val: boolean) => void;
  setTemplateSettings: (val: TemplateSettingsForm) => void;
  setIsTemplateSettingsOpen: (val: boolean) => void;
  isRestoringBackup: boolean;
  handleRestoreBackup: (file: File) => void;
  loadData: () => void;
}

export function SystemSettings({
  setIsSchoolManagerOpen,
  setSettings,
  setIsSettingsOpen,
  setTemplateSettings,
  setIsTemplateSettingsOpen,
  isRestoringBackup,
  handleRestoreBackup,
  loadData
}: SystemSettingsProps) {
  return (
    <Card className="shadow-xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-t-4 border-t-rose-500">
      <CardHeader className="pb-3">
        <CardTitle className="text-rose-600 dark:text-rose-400 flex items-center gap-2">
          <RotateCcw className="h-5 w-5" />
          System & Export
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button 
          variant="outline" 
          className="w-full justify-start gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-950/30 dark:border-indigo-900/50 dark:text-indigo-300 dark:hover:bg-indigo-900/50 shadow-sm"
          onClick={() => setIsSchoolManagerOpen(true)}
        >
          <SchoolIcon className="h-4 w-4" /> Schulen verwalten
        </Button>
        <Button 
          variant="outline" 
          className="w-full justify-start gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-950/30 dark:border-indigo-900/50 dark:text-indigo-300 dark:hover:bg-indigo-900/50 shadow-sm"
          onClick={async () => {
            try {
              const r = await fetch(`/api/settings?t=${Date.now()}`, { cache: 'no-store' });
              if (!r.ok) throw new Error('Failed');
              const data = await r.json();
              setSettings({
                smtpHost: data.smtpHost || "",
                smtpUser: data.smtpUser || "",
                smtpPass: data.smtpPass || ""
              });
              setIsSettingsOpen(true);
            } catch (e) {
              alert('Einstellungen konnten nicht geladen werden.');
            }
          }}
        >
          <Settings className="h-4 w-4" /> Mail-API konfigurieren
        </Button>
        <Button 
          variant="outline" 
          className="w-full justify-start gap-2 bg-violet-50 hover:bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:border-violet-900/50 dark:text-violet-300 dark:hover:bg-violet-900/50 shadow-sm"
          onClick={async () => {
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
                signatureUrl: data.signatureUrl || ""
              });
              setIsTemplateSettingsOpen(true);
            } catch (e) {
              alert('Briefvorlage konnte nicht geladen werden.');
            }
          }}
        >
          <FileText className="h-4 w-4" /> Briefvorlage konfigurieren
        </Button>
        <Button 
          variant="outline" 
          className="w-full justify-start gap-2 bg-white dark:bg-slate-900 shadow-sm"
          onClick={() => window.open('/api/export', '_blank')}
        >
          <FileDown className="h-4 w-4" /> CSV Export (Jahresende)
        </Button>
        <Button 
          variant="outline" 
          className="w-full justify-start gap-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/50 shadow-sm"
          onClick={() => window.open('/api/backup/export', '_blank')}
        >
          <FileDown className="h-4 w-4" /> Komplett-Backup (JSON) herunterladen
        </Button>
        <div className="relative">
          <Button 
            variant="outline" 
            disabled={isRestoringBackup}
            className="w-full justify-start gap-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:border-rose-900/50 dark:text-rose-300 dark:hover:bg-rose-900/50 shadow-sm"
            onClick={() => document.getElementById('backup-upload-input')?.click()}
          >
            <RotateCcw className="h-4 w-4" /> {isRestoringBackup ? 'Wiederherstellen...' : 'Backup wiederherstellen (Upload)'}
          </Button>
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
        <Button 
          variant="destructive" 
          className="w-full justify-start gap-2 bg-rose-600 hover:bg-rose-700 shadow-md transition-colors"
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
          <RotateCcw className="h-4 w-4" /> Neues Schuljahr (Reset)
        </Button>
      </CardContent>
    </Card>
  );
}
