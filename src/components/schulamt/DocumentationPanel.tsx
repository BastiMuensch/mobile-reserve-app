import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { RotateCcw, FileDown, Upload, Database, AlertTriangle, FolderArchive, ArrowRight, ChevronDown } from "lucide-react";
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
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2" data-testid="documentation-exports">
      <Card className="min-w-0 border-border/70 py-5">
        <CardHeader className="px-5 sm:px-6">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Database className="size-5 shrink-0 text-primary" /> Datensicherung
          </CardTitle>
          <CardDescription>
            Sichern Sie regelmäßig den Datenbestand aller Schuljahre einschließlich
            Schulamtslogo, Unterschrift und Schulbildern. Bewahren Sie Backups geschützt auf.
          </CardDescription>
        </CardHeader>
        <CardContent className="mt-auto px-5 sm:px-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button variant="outline" onClick={() => window.open('/api/backup/export', '_blank')}>
            <FileDown className="size-4 text-primary" /> Backup herunterladen
          </Button>
          <Button
            variant="outline"
            disabled={isRestoringBackup}
            onClick={() => document.getElementById('backup-upload-input')?.click()}
          >
            <Upload className="size-4 text-primary" />
            {isRestoringBackup ? 'Wird wiederhergestellt…' : 'Backup wiederherstellen'}
          </Button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Backup-Format 2.0 mit Bildern. Ältere Datenbank-Backups (1.0) können weiterhin eingespielt werden.</p>
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

      <Card className="min-w-0 border-border/70 py-5">
        <CardHeader className="px-5 sm:px-6">
          <CardTitle className="flex items-center gap-2 text-xl">
            <FileDown className="size-5 shrink-0 text-primary" /> Abrechnung & Nachweise
          </CardTitle>
          <CardDescription>
            Die Excel-Übersicht enthält Bedarfe und Einsätze des ausgewählten Schuljahres {selectedYear}.
            Stornierungen sind im Blatt „Einsätze“ gekennzeichnet und zählen nicht zu den aktiven Stunden.
          </CardDescription>
        </CardHeader>
        <CardContent className="mt-auto px-5 sm:px-6">
          <Button variant="outline" onClick={() => window.open(`/api/export?year=${encodeURIComponent(selectedYear)}`, '_blank')} className="w-full sm:w-auto">
            <FileDown className="size-4 text-primary" /> Excel-Export {selectedYear}
          </Button>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Für die Abrechnung und Dokumentation. Der Excel-Export ersetzt kein Wiederherstellungsbackup.</p>
        </CardContent>
      </Card>
      </div>

      <Card className="border-border/70 py-5">
        <CardHeader className="px-5 sm:px-6"><CardTitle className="flex items-center gap-2 text-xl"><FolderArchive className="size-5 shrink-0 text-primary" />Schuljahreswechsel & Archiv</CardTitle>
          <CardDescription>Bestehende Daten bleiben erhalten. Zum Nachsehen wählen Sie oben das frühere Schuljahr.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 px-5 sm:px-6">
          <ol className="grid gap-4 text-sm md:grid-cols-3">
            {[
              ['Daten sichern', 'Backup und bei Bedarf den Jahresexport herunterladen.'],
              ['Ziel-Schuljahr wählen', 'Oben das Schuljahr auswählen, in das die Reserven übernommen werden sollen.'],
              ['Reserven übernehmen', 'Unter „Mobile Reserven“ die Aktion „Aus Vorjahr übernehmen“ nutzen und die Auswahl prüfen.'],
            ].map(([title, description], index) => <li key={title} className="flex gap-3">
              <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>
              <div><p className="font-medium">{title}</p><p className="mt-1 leading-relaxed text-muted-foreground">{description}</p></div>
            </li>)}
          </ol>
          <Link href="/schulamt/reserven" className={buttonVariants({ variant: "outline", className: "w-full sm:w-auto" })}>Zur Reservenübernahme<ArrowRight className="size-4" /></Link>
        </CardContent>
      </Card>

      <details className="group rounded-xl border border-border bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-5 py-4 text-sm font-medium text-destructive focus-visible:outline-2 focus-visible:outline-ring sm:px-6 [&::-webkit-details-marker]:hidden">
          <AlertTriangle className="size-4 shrink-0" />Daten endgültig löschen
          <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
      <Card className="border-0 border-t border-border rounded-t-none py-5 shadow-none ring-0">
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
