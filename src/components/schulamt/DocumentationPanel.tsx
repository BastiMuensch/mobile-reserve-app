import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RotateCcw, FileDown, Upload, Database, AlertTriangle } from "lucide-react";

interface DocumentationPanelProps {
  isRestoringBackup: boolean;
  handleRestoreBackup: (file: File) => void;
  handleReset: () => void;
}

/**
 * Nachweis- und Dokumentationsbereich des Schulamts: alles, was für Datenschutz,
 * Abrechnung und den Schuljahreswechsel gebraucht wird. Bewusst getrennt von den
 * Profil-Einstellungen - hier geht es nicht um Konfiguration, sondern um
 * wiederkehrende Pflichten (tägliches Backup) und einschneidende Aktionen (Reset).
 */
export function DocumentationPanel({
  isRestoringBackup,
  handleRestoreBackup,
  handleReset
}: DocumentationPanelProps) {
  return (
    <div className="space-y-8">
      <Card className="border-border/70 bg-white py-5 dark:bg-card">
        <CardHeader className="px-5 sm:px-6">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Database className="w-5 h-5 text-muted-foreground" /> Tägliches Backup
          </CardTitle>
          <CardDescription>
            Aus Datenschutz- und Datensicherheitsgründen liegen die Daten nur auf diesem Server.
            Das reguläre Wiederherstellungsbackup (Version 2.0) ist vollständig und sichert
            sowohl den gesamten Datenbestand als auch alle zugehörigen Dokumentbilder
            (Schulamtslogo, Unterschrift und Schulbilder). Reine Datenbank-Backups der Version 1.0
            bleiben zur Wiederherstellung kompatibel.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-5 sm:flex-row sm:flex-wrap sm:px-6">
          <Button variant="outline" onClick={() => window.open('/api/backup/export', '_blank')} className="h-auto min-h-9 justify-start whitespace-normal py-2 text-left sm:justify-center">
            <FileDown className="h-4 w-4 text-blue-500" /> Vollständiges Backup herunterladen (inkl. Bilder)
          </Button>
          <Button
            variant="outline"
            disabled={isRestoringBackup}
            onClick={() => document.getElementById('backup-upload-input')?.click()}
            className="h-auto min-h-9 justify-start whitespace-normal py-2 text-left sm:justify-center"
          >
            <Upload className="h-4 w-4 text-rose-500" />
            {isRestoringBackup ? 'Wird wiederhergestellt…' : 'Vollständiges Backup wiederherstellen'}
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
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-white py-5 dark:bg-card">
        <CardHeader className="px-5 sm:px-6">
          <CardTitle className="flex items-center gap-2 text-xl">
            <FileDown className="w-5 h-5 text-muted-foreground" /> Abrechnung & Nachweise
          </CardTitle>
          <CardDescription>
            Die CSV-Übersicht listet alle Anfragen und Zuweisungen dieses Schuljahres mit
            Lehrkraft, Schule und Stunden auf – die Grundlage für die Abrechnung am
            Schuljahresende.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-5 sm:px-6">
          <Button variant="outline" onClick={() => window.open('/api/export', '_blank')} className="h-auto min-h-9 justify-start whitespace-normal py-2 text-left sm:justify-center">
            <FileDown className="h-4 w-4 text-emerald-500" /> CSV-Export (Jahresende)
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/30 bg-white py-5 dark:bg-card">
        <CardHeader className="px-5 sm:px-6">
          <CardTitle className="flex items-center gap-2 text-xl text-destructive">
            <AlertTriangle className="w-5 h-5" /> Neues Schuljahr
          </CardTitle>
          <CardDescription>
            Löscht <strong>alle</strong> Anfragen und Zuweisungen dieses Schulamts endgültig.
            Lehrkräfte und Schulen bleiben erhalten. Ziehen Sie vorher unbedingt ein Backup –
            die Aktion lässt sich nicht rückgängig machen.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-5 sm:px-6">
          <Button variant="destructive" onClick={handleReset} className="gap-2">
            <RotateCcw className="h-4 w-4" /> Zurücksetzen
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
