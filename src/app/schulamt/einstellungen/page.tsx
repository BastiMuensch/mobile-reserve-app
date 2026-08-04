"use client";

import { useState } from "react";
import { useSchulamtData } from "@/hooks/useSchulamtData";
import { useSchulamtYear } from "@/hooks/useSchulamtYear";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SystemSettings } from "@/components/schulamt/SystemSettings";
import { TemplateSettingsDialog } from "@/components/schulamt/dialogs/TemplateSettingsDialog";
import { TemplateSettingsForm } from "@/types/models";

export default function SchulamtEinstellungenPage() {
  const { selectedYear, setSelectedYear } = useSchulamtYear();
  // Seit die Schulverwaltung eine eigene Seite hat, rendert diese Seite keine Listendaten
  // mehr - der Hook hält hier nur noch die gemeinsame Schuljahr-Auswahl am Leben.
  const data = useSchulamtData({ endpoints: [], year: selectedYear, setYear: setSelectedYear });
  const { toast } = useToast();
  const confirm = useConfirm();

  const [isTemplateSettingsOpen, setIsTemplateSettingsOpen] = useState(false);
  const [templateSettings, setTemplateSettings] = useState<TemplateSettingsForm>({
    headerText: "", returnAddress: "", logoUrl: "", contactAddress: "",
    contactPerson: "", city: "", amtsleitungName: "", amtsleitungTitle: "", signatureUrl: ""
  });
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingSignature, setIsUploadingSignature] = useState(false);
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);

  // Kopfzeile und KPI-Kacheln im Layout haben ihre eigene, unabhängige Hook-Instanz.
  // Das app-refresh-Event bringt sie nach einer Änderung sofort auf den neuen Stand.
  const refresh = () => {
    data.loadData();
    window.dispatchEvent(new Event('app-refresh'));
  };

  const handleGeneratePreview = async () => {
    try {
      const res = await fetch('/api/schulamt/profile/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(templateSettings)
      });
      if (!res.ok) throw new Error('Fehler beim Generieren der Vorschau');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (error) {
      console.error(error);
      toast({ variant: "error", title: "Vorschau konnte nicht generiert werden." });
    }
  };

  const handleUploadLogo = async (file: File) => {
    setIsUploadingLogo(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const respData = await res.json();
      if (respData.success) {
        setTemplateSettings(prev => ({ ...prev, logoUrl: respData.url }));
      } else {
        toast({ variant: "error", title: "Upload fehlgeschlagen: " + (respData.error || "Unbekannter Fehler") });
      }
    } catch (e) {
      toast({ variant: "error", title: "Fehler beim Upload des Logos." });
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleUploadSignature = async (file: File) => {
    setIsUploadingSignature(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const respData = await res.json();
      if (respData.success) {
        setTemplateSettings(prev => ({ ...prev, signatureUrl: respData.url }));
      } else {
        toast({ variant: "error", title: "Upload fehlgeschlagen: " + (respData.error || "Unbekannter Fehler") });
      }
    } catch (e) {
      toast({ variant: "error", title: "Fehler beim Upload der Unterschrift." });
    } finally {
      setIsUploadingSignature(false);
    }
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



  return (
    <div className="max-w-4xl space-y-6">
      <SystemSettings
        setTemplateSettings={setTemplateSettings}
        setIsTemplateSettingsOpen={setIsTemplateSettingsOpen}
        isRestoringBackup={isRestoringBackup}
        handleRestoreBackup={handleRestoreBackup}
        loadData={refresh}
      />

      <TemplateSettingsDialog
        isTemplateSettingsOpen={isTemplateSettingsOpen}
        setIsTemplateSettingsOpen={setIsTemplateSettingsOpen}
        templateSettings={templateSettings}
        setTemplateSettings={setTemplateSettings}
        isSavingTemplate={isSavingTemplate}
        setIsSavingTemplate={setIsSavingTemplate}
        isUploadingLogo={isUploadingLogo}
        handleUploadLogo={handleUploadLogo}
        isUploadingSignature={isUploadingSignature}
        handleUploadSignature={handleUploadSignature}
        handleGeneratePreview={handleGeneratePreview}
      />
    </div>
  );
}
