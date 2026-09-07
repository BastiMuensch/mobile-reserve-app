import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RotateCcw, FileDown, Upload, Database, AlertTriangle } from "lucide-react";
import Link from 'next/link';

interface DocumentationPanelProps {
  selectedYear: string;
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
  selectedYear,
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
            Die Excel-Übersicht enthält Bedarfe und Einsätze des ausgewählten Schuljahres {selectedYear}.
            Stornierungen sind im Blatt „Einsätze“ gekennzeichnet und zählen nicht zu den aktiven Stunden.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-5 sm:px-6">
          <Button variant="outline" onClick={() => window.open(`/api/export?year=${encodeURIComponent(selectedYear)}`, '_blank')} className="h-auto min-h-9 justify-start whitespace-normal py-2 text-left sm:justify-center">
            <FileDown className="h-4 w-4 text-emerald-500" /> Excel-Export {selectedYear}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-white py-5 dark:bg-card">
        <CardHeader className="px-5 sm:px-6"><CardTitle>Schuljahreswechsel & Archiv</CardTitle>
          <CardDescription>Bestehende Daten bleiben erhalten. Zum Nachsehen wählen Sie oben das frühere Schuljahr.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-5 sm:px-6">
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Backup und bei Bedarf den Jahresexport sichern.</li>
            <li>Oben das Ziel-Schuljahr auswählen.</li>
            <li>Unter „Mobile Reserven“ die Aktion „Aus Vorjahr übernehmen“ nutzen und die Auswahl prüfen.</li>
          </ol>
          <Link href="/schulamt/reserven" className="inline-flex min-h-10 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">Zur Reservenübernahme</Link>
        </CardContent>
      </Card>

      <details className="rounded-xl border border-destructive/30 p-5">
        <summary className="cursor-pointer font-semibold text-destructive">Gefahrenzone: Daten endgültig löschen</summary>
      <Card className="mt-4 border-0 bg-white py-5 shadow-none dark:bg-card">
        <CardHeader className="px-5 sm:px-6">
          <CardTitle className="flex items-center gap-2 text-xl text-destructive">
            <AlertTriangle className="w-5 h-5" /> Alle Bedarfe und Einsätze löschen
          </CardTitle>
          <CardDescription>
            Löscht <strong>alle</strong> Anfragen und Zuweisungen dieses Schulamts endgültig.
            Dies betrifft alle Schuljahre, nicht nur {selectedYear}. Für einen Schuljahreswechsel ist das nicht erforderlich.
            Lehrkräfte und Schulen bleiben erhalten. Ziehen Sie vorher unbedingt ein Backup –
            die Aktion lässt sich nicht rückgängig machen.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-5 sm:px-6">
          <Button variant="destructive" onClick={handleReset} className="gap-2">
            <RotateCcw className="h-4 w-4" /> Endgültige Löschung vorbereiten
          </Button>
        </CardContent>
      </Card>
      </details>
    </div>
  );
}
