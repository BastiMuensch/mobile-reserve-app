"use client";

import { useState } from "react";
import { useSchulamtData } from "@/hooks/useSchulamtData";
import { useSchulamtYear } from "@/hooks/useSchulamtYear";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SystemSettings } from "@/components/schulamt/SystemSettings";
import { SchoolManager } from "@/components/schulamt/SchoolManager";
import { TemplateSettingsDialog } from "@/components/schulamt/dialogs/TemplateSettingsDialog";
import { NewSchoolForm, TemplateSettingsForm } from "@/types/models";

export default function SchulamtEinstellungenPage() {
  const { selectedYear, setSelectedYear } = useSchulamtYear();
  const data = useSchulamtData({ endpoints: ["schools"], year: selectedYear, setYear: setSelectedYear });
  const { toast } = useToast();
  const confirm = useConfirm();

  const [isAddingSchool, setIsAddingSchool] = useState(false);
  const [newSchool, setNewSchool] = useState<NewSchoolForm>({
    name: "", address: "", type: "GRUNDSCHULE", email: "", password: ""
  });
  const [editingPasswordId, setEditingPasswordId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");

  const [isTemplateSettingsOpen, setIsTemplateSettingsOpen] = useState(false);
  const [templateSettings, setTemplateSettings] = useState<TemplateSettingsForm>({
    headerText: "", returnAddress: "", logoUrl: "", contactAddress: "",
    contactPerson: "", city: "", amtsleitungName: "", amtsleitungTitle: "", signatureUrl: ""
  });
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingSignature, setIsUploadingSignature] = useState(false);
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);

  // Kopfzeile und KPI-Kacheln im Layout haben ihre eigene, unabhängige Hook-Instanz - ein
  // einfaches data.loadData() hier würde nur die Schulliste dieser Seite aktualisieren.
  // Das app-refresh-Event sorgt dafür, dass auch das Layout (und z.B. die Reserven-Seite,
  // falls sie noch im Hintergrund gemountet ist) sofort den neuen Stand sehen.
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

  const handleAddSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAddingSchool(true);
    try {
      const res = await fetch("/api/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSchool)
      });
      if (res.ok) {
        setNewSchool({ name: "", address: "", type: "GRUNDSCHULE", email: "", password: "" });
        refresh();
      } else {
        toast({ variant: "error", title: "Fehler beim Anlegen der Schule." });
      }
    } catch {
      toast({ variant: "error", title: "Fehler beim Anlegen der Schule." });
    } finally {
      setIsAddingSchool(false);
    }
  };

  const handleUpdateCredentials = async (schoolId: string) => {
    if (!newPassword && !newEmail) return;
    try {
      const res = await fetch("/api/schools", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId, newPassword: newPassword || undefined, newEmail: newEmail || undefined })
      });
      if (res.ok) {
        setEditingPasswordId(null);
        setNewPassword("");
        setNewEmail("");
        toast({ variant: "success", title: "Zugangsdaten erfolgreich aktualisiert." });
        refresh();
      } else {
        toast({ variant: "error", title: "Fehler beim Aktualisieren der Zugangsdaten." });
      }
    } catch {
      toast({ variant: "error", title: "Fehler beim Aktualisieren der Zugangsdaten." });
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      {/* Die Schulverwaltung steht direkt auf der Seite statt im Dialog: Die Übersicht
          mit Kontaktdaten ist ein Nachschlagewerk, kein kurzer Zwischenschritt. */}
      <SchoolManager
        handleAddSchool={handleAddSchool}
        newSchool={newSchool}
        setNewSchool={setNewSchool}
        isAddingSchool={isAddingSchool}
        sortedSchools={data.sortedSchools}
        editingPasswordId={editingPasswordId}
        setEditingPasswordId={setEditingPasswordId}
        newEmail={newEmail}
        setNewEmail={setNewEmail}
        newPassword={newPassword}
        setNewPassword={setNewPassword}
        handleUpdateCredentials={handleUpdateCredentials}
        onChanged={refresh}
      />

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
