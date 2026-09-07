"use client";

import { useState } from "react";
import { useSchulamtData } from "@/hooks/useSchulamtData";
import { useSchulamtYear } from "@/hooks/useSchulamtYear";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { DocumentationPanel } from "@/components/schulamt/DocumentationPanel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

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
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [resetPhrase, setResetPhrase] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [isResetting, setIsResetting] = useState(false);

  // Geteilter SchulamtDataContext aktualisiert Layout-KPIs und diese Ansicht gemeinsam.
  const refresh = () => {
    data.loadData();
  };

  const handleRestoreBackup = async (file: File) => {
    const confirmed = await confirm({
      title: "Backup wirklich einspielen?",
      description: "ACHTUNG: Wenn Sie ein Backup einspielen, werden ALLE aktuellen Daten dieses Schulamts gelöscht und mit dem Stand des Backups überschrieben! Fortfahren?",
      confirmLabel: "Fortfahren",
      variant: "destructive"
    });
    if (!confirmed) return;

    setIsRestoringBackup(true);
    try {
      const text = await file.text();
      const json = JSON.parse(text);

      const res = await fetch("/api/backup/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Wiederherstellung fehlgeschlagen");
      }

      toast({ variant: "success", title: "Backup erfolgreich wiederhergestellt!" });
      refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Fehler beim Verarbeiten der Backup-Datei.";
      toast({ variant: "error", title: msg });
    } finally {
      setIsRestoringBackup(false);
    }
  };

  const handleOpenResetDialog = () => {
    setResetPhrase("");
    setResetPassword("");
    setIsResetDialogOpen(true);
  };

  const handleExecuteReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resetPhrase !== 'RESET' || !resetPassword) return;

    setIsResetting(true);
    try {
      const res = await fetch('/api/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmationPhrase: resetPhrase,
          password: resetPassword,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Reset fehlgeschlagen');
      }

      setIsResetDialogOpen(false);
      setResetPhrase("");
      setResetPassword("");
      refresh();
      toast({ variant: "success", title: "System wurde erfolgreich zurückgesetzt." });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Fehler beim Zurücksetzen des Systems.";
      toast({ variant: "error", title: msg });
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="max-w-5xl space-y-8">
      <DocumentationPanel
        selectedYear={selectedYear}
        isRestoringBackup={isRestoringBackup}
        handleRestoreBackup={handleRestoreBackup}
        handleReset={handleOpenResetDialog}
      />

      <Dialog open={isResetDialogOpen} onOpenChange={setIsResetDialogOpen}>
        <DialogContent>
          <form onSubmit={handleExecuteReset}>
            <DialogHeader>
              <DialogTitle className="text-destructive flex items-center gap-2">
                ⚠️ Alle Bedarfe und Einsätze endgültig löschen?
              </DialogTitle>
              <DialogDescription>
                ACHTUNG: Dies löscht ALLE Anfragen und Zuweisungen dieses Schulamts über sämtliche Schuljahre dauerhaft.
                Diese Aktion kann nicht rückgängig gemacht werden. Bitte sichern Sie vorher ein Backup.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="reset-phrase">
                  Geben Sie zur Bestätigung exakt <span className="font-bold text-destructive">RESET</span> ein:
                </Label>
                <Input
                  id="reset-phrase"
                  value={resetPhrase}
                  onChange={(e) => setResetPhrase(e.target.value)}
                  placeholder="RESET"
                  autoComplete="off"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="reset-password">
                  Bestätigen Sie mit Ihrem Schulamt-Passwort:
                </Label>
                <Input
                  id="reset-password"
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder="Ihr Passwort"
                  autoComplete="current-password"
                  required
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsResetDialogOpen(false)}
                disabled={isResetting}
              >
                Abbrechen
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={isResetting || resetPhrase !== 'RESET' || !resetPassword}
              >
                {isResetting ? 'Wird zurückgesetzt...' : 'Endgültig zurücksetzen'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
