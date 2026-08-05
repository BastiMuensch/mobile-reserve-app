"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { SchulamtProfileForm } from "@/components/schulamt/SchulamtProfileForm";
import { TemplateSettingsForm } from "@/types/models";

/**
 * Nur noch das Schulamt-Profil (Briefkopf, Amtsleitung, Mail-Server). Backup, CSV-Export
 * und der Schuljahres-Reset sind auf die eigene Seite "Dokumentation" umgezogen - dort
 * geht es um wiederkehrende Pflichten und einschneidende Aktionen, hier um Konfiguration.
 */
export default function SchulamtEinstellungenPage() {
  const { toast } = useToast();

  const [templateSettings, setTemplateSettings] = useState<TemplateSettingsForm>({
    headerText: "", returnAddress: "", logoUrl: "", contactAddress: "",
    contactPerson: "", city: "", amtsleitungName: "", amtsleitungTitle: "", signatureUrl: ""
  });
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingSignature, setIsUploadingSignature] = useState(false);

  // Das Profil wurde früher erst beim Öffnen des Dialogs geladen. Auf der eigenen Seite
  // muss es direkt beim Erscheinen da sein, sonst sieht das Formular leer aus.
  useEffect(() => {
    const loadProfile = async () => {
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
      } catch (e) {
        console.error(e);
        toast({ variant: "error", title: "Profil konnte nicht geladen werden: " + (e as Error).message });
      }
    };
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <div className="max-w-4xl space-y-6">
      <SchulamtProfileForm
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
