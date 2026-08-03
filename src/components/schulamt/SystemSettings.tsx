import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RotateCcw, Settings, FileText, FileDown, ChevronDown, Upload } from "lucide-react";
import { TemplateSettingsForm } from "@/types/models";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";

interface SystemSettingsProps {
  setTemplateSettings: (val: TemplateSettingsForm) => void;
  setIsTemplateSettingsOpen: (val: boolean) => void;
  isRestoringBackup: boolean;
  handleRestoreBackup: (file: File) => void;
  loadData: () => void;
}

export function SystemSettings({
  setTemplateSettings,
  setIsTemplateSettingsOpen,
  isRestoringBackup,
  handleRestoreBackup,
  loadData
}: SystemSettingsProps) {
  const { toast } = useToast();
  const confirm = useConfirm();

  return (
    <div className="w-full">
      <DropdownMenu>
        <DropdownMenuTrigger className="w-full flex justify-between items-center bg-card/80 backdrop-blur-sm border-border shadow-sm h-14 text-foreground hover:bg-muted rounded-xl transition-all hover:shadow-md px-4 border">
          <span className="flex items-center gap-3 font-semibold">
              <Settings className="h-5 w-5 text-muted-foreground" />
              Verwaltung & Einstellungen
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[320px] p-2 rounded-xl shadow-xl border-border" align="start" sideOffset={8}>
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs text-muted-foreground uppercase tracking-wider font-bold mb-1">Stammdaten</DropdownMenuLabel>

            <DropdownMenuItem onClick={async (e) => {
              e.preventDefault();
              try {
                const r = await fetch(`/api/schulamt/profile?t=${Date.now()}`, { cache: 'no-store' });
                if (!r.ok) {
                  const text = await r.text();
                  throw new Error(`Failed: ${r.status} ${text}`);
                }
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
                  latitude: data.latitude || null,
                  longitude: data.longitude || null,
                  smtpHost: data.smtpHost || "",
                  smtpUser: data.smtpUser || "",
                  smtpPass: data.smtpPass || ""
                });
                setIsTemplateSettingsOpen(true);
              } catch (e) {
                console.error(e);
                toast({ variant: "error", title: "Profil konnte nicht geladen werden: " + (e as Error).message });
              }
            }} className="cursor-pointer gap-3 py-3 rounded-lg focus:bg-muted">
              <FileText className="h-4 w-4 text-primary" /> <span className="font-medium">Schulamt Profil & Mail-Server</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator className="my-2 bg-border" />
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs text-muted-foreground uppercase tracking-wider font-bold mb-1">Daten & Backup</DropdownMenuLabel>

            <DropdownMenuItem onClick={(e) => { e.preventDefault(); window.open('/api/export', '_blank'); }} className="cursor-pointer gap-3 py-3 rounded-lg focus:bg-muted">
              <FileDown className="h-4 w-4 text-emerald-500" /> <span className="font-medium">CSV Export (Jahresende)</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={(e) => { e.preventDefault(); window.open('/api/backup/export', '_blank'); }} className="cursor-pointer gap-3 py-3 rounded-lg focus:bg-muted">
              <FileDown className="h-4 w-4 text-blue-500" /> <span className="font-medium">Komplett-Backup herunterladen</span>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isRestoringBackup} onClick={(e) => { e.preventDefault(); document.getElementById('backup-upload-input')?.click(); }} className="cursor-pointer gap-3 py-3 rounded-lg focus:bg-muted">
              <Upload className="h-4 w-4 text-rose-500" /> <span className="font-medium">{isRestoringBackup ? 'Wiederherstellen...' : 'Backup wiederherstellen'}</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator className="my-2 bg-border" />

          <DropdownMenuItem
            className="cursor-pointer gap-3 py-3 rounded-lg text-destructive focus:text-destructive focus:bg-destructive/10"
            onClick={async (e) => {
              e.preventDefault();
              const ok = await confirm({
                title: 'Neues Schuljahr starten?',
                description: 'ACHTUNG: Dies löscht ALLE Anfragen und Zuweisungen dauerhaft. Diese Aktion kann nicht rückgängig gemacht werden.',
                confirmLabel: 'Endgültig zurücksetzen',
                variant: 'destructive',
                requireText: 'RESET',
              });
              if (!ok) return;
              try {
                const res = await fetch('/api/reset', { method: 'POST' });
                if (!res.ok) throw new Error('Reset fehlgeschlagen');
                loadData();
                toast({ variant: "success", title: "System wurde erfolgreich zurückgesetzt." });
              } catch {
                toast({ variant: "error", title: "Fehler beim Zurücksetzen des Systems." });
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
