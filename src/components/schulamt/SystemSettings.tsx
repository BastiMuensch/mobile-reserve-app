import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RotateCcw, FileText, FileDown, Upload, Server, Database, AlertTriangle } from "lucide-react";
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

/**
 * Einstellungen des Schulamts. Lag früher hinter einem Aufklapp-Menü, weil es als
 * schmale Kachel neben dem Dashboard saß. Auf einer eigenen Seite ist das Verstecken
 * unnötig – die drei Bereiche stehen jetzt offen nebeneinander, mit einer kurzen
 * Erklärung, was der jeweilige Knopf tut.
 */
export function SystemSettings({
  setTemplateSettings,
  setIsTemplateSettingsOpen,
  isRestoringBackup,
  handleRestoreBackup,
  loadData
}: SystemSettingsProps) {
  const { toast } = useToast();
  const confirm = useConfirm();

  const openProfile = async () => {
    try {
      const r = await fetch(`/api/schulamt/profile?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`Failed: ${r.status} ${await r.text()}`);
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
  };

  const handleReset = async () => {
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
  };

  return (
    <div className="space-y-6">
      <Card className="shadow-xl bg-card/80 backdrop-blur-sm border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Server className="w-5 h-5 text-muted-foreground" /> Schulamt-Profil & Mail-Server
          </CardTitle>
          <CardDescription>
            Briefkopf, Anschrift, Amtsleitung, Unterschrift und Logo für die Abordnungsschreiben –
            sowie die Zugangsdaten des Mail-Servers, über den Benachrichtigungen verschickt werden.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={openProfile} className="gap-2">
            <FileText className="h-4 w-4 text-primary" /> Profil bearbeiten
          </Button>
        </CardContent>
      </Card>

      <Card className="shadow-xl bg-card/80 backdrop-blur-sm border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Database className="w-5 h-5 text-muted-foreground" /> Daten & Backup
          </CardTitle>
          <CardDescription>
            Aus Datenschutzgründen muss täglich ein lokales Backup gezogen werden. Die
            CSV-Übersicht eignet sich für die Abrechnung am Schuljahresende.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => window.open('/api/backup/export', '_blank')} className="gap-2">
            <FileDown className="h-4 w-4 text-blue-500" /> Komplett-Backup herunterladen
          </Button>
          <Button variant="outline" onClick={() => window.open('/api/export', '_blank')} className="gap-2">
            <FileDown className="h-4 w-4 text-emerald-500" /> CSV-Export (Jahresende)
          </Button>
          <Button
            variant="outline"
            disabled={isRestoringBackup}
            onClick={() => document.getElementById('backup-upload-input')?.click()}
            className="gap-2"
          >
            <Upload className="h-4 w-4 text-rose-500" />
            {isRestoringBackup ? 'Wird wiederhergestellt…' : 'Backup wiederherstellen'}
          </Button>
        </CardContent>
      </Card>

      <Card className="shadow-xl bg-card/80 backdrop-blur-sm border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl text-destructive">
            <AlertTriangle className="w-5 h-5" /> Neues Schuljahr
          </CardTitle>
          <CardDescription>
            Löscht <strong>alle</strong> Anfragen und Zuweisungen dieses Schulamts endgültig.
            Lehrkräfte und Schulen bleiben erhalten. Ziehen Sie vorher ein Backup – die Aktion
            lässt sich nicht rückgängig machen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={handleReset} className="gap-2">
            <RotateCcw className="h-4 w-4" /> Zurücksetzen
          </Button>
        </CardContent>
      </Card>

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
