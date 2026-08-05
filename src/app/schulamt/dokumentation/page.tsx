"use client";

import { useState } from "react";
import { useSchulamtData } from "@/hooks/useSchulamtData";
import { useSchulamtYear } from "@/hooks/useSchulamtYear";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { DocumentationPanel } from "@/components/schulamt/DocumentationPanel";

/**
 * Nachweis- und Dokumentationsseite: tägliches Backup, CSV-Export für die Abrechnung und
 * der Schuljahres-Reset. War vorher Teil der Einstellungsseite (SystemSettings) - jetzt
 * eigene Seite, weil es hier nicht um Konfiguration geht, sondern um wiederkehrende
 * Pflichten und einschneidende, seltene Aktionen.
 */
export default function SchulamtDokumentationPage() {
  const { selectedYear, setSelectedYear } = useSchulamtYear();
  // Wie auf der Einstellungsseite hält der Hook hier nur die gemeinsame Schuljahr-Auswahl
  // am Leben; die eigentlichen Listendaten holt sich jede Seite selbst.
  const data = useSchulamtData({ endpoints: [], year: selectedYear, setYear: setSelectedYear });
  const { toast } = useToast();
  const confirm = useConfirm();

  const [isRestoringBackup, setIsRestoringBackup] = useState(false);

  // Kopfzeile und KPI-Kacheln im Layout haben ihre eigene, unabhängige Hook-Instanz.
  // Das app-refresh-Event bringt sie nach einer Änderung sofort auf den neuen Stand.
  const refresh = () => {
    data.loadData();
    window.dispatchEvent(new Event('app-refresh'));
  };

  const handleRestoreBackup = async (file: File) => {
    const confirmed1 = await confirm({
      title: "Backup wirklich einspielen?",
      description: "ACHTUNG: Wenn Sie ein Backup einspielen, werden ALLE aktuellen Daten dieses Schulamts gelöscht und mit dem Stand des Backups überschrieben! Fortfahren?",
      confirmLabel: "Fortfahren",
      variant: "destructive"
    });
    if (!confirmed1) return;
    const confirmed2 = await confirm({
      title: "Wirklich ganz sicher?",
      description: "Sind Sie wirklich GANZ SICHER? Dies kann nicht rückgängig gemacht werden!",
      confirmLabel: "Ja, einspielen",
      variant: "destructive"
    });
    if (!confirmed2) return;

    setIsRestoringBackup(true);
    try {
      const text = await file.text();
      const jsonData = JSON.parse(text);

      const res = await fetch("/api/backup/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(jsonData)
      });

      if (res.ok) {
        toast({ variant: "success", title: "Backup erfolgreich wiederhergestellt! Die Seite wird neu geladen." });
        window.location.reload();
      } else {
        const err = await res.json();
        toast({ variant: "error", title: "Fehler bei der Wiederherstellung: " + (err.error || "Unbekannter Fehler") });
      }
    } catch (e) {
      toast({ variant: "error", title: "Fehler beim Verarbeiten der Backup-Datei. Ist es eine gültige JSON-Datei?" });
    } finally {
      setIsRestoringBackup(false);
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
      refresh();
      toast({ variant: "success", title: "System wurde erfolgreich zurückgesetzt." });
    } catch {
      toast({ variant: "error", title: "Fehler beim Zurücksetzen des Systems." });
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <DocumentationPanel
        isRestoringBackup={isRestoringBackup}
        handleRestoreBackup={handleRestoreBackup}
        handleReset={handleReset}
      />
    </div>
  );
}
