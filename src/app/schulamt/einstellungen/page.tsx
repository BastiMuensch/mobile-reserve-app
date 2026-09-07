"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { SchulamtProfileForm } from "@/components/schulamt/SchulamtProfileForm";
import { UpdateStatusCard } from "@/components/updates/UpdateStatus";
import { EmailOutboxPanel } from "@/components/schulamt/EmailOutboxPanel";
import { InstanceSettings } from "@/components/schulamt/InstanceSettings";
import { TemplateSettingsForm } from "@/types/models";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { Button } from "@/components/ui/button";

/**
 * Nur noch das Schulamt-Profil (Briefkopf, Amtsleitung, Mail-Server). Backup, CSV-Export
 * und der Schuljahres-Reset sind auf die eigene Seite "Dokumentation" umgezogen - dort
 * geht es um wiederkehrende Pflichten und einschneidende Aktionen, hier um Konfiguration.
 */
export default function SchulamtEinstellungenPage() {
  const { toast } = useToast();

  const [templateSettings, setTemplateSettings] = useState<TemplateSettingsForm>({
    headerText: "", returnAddress: "", logoUrl: "", contactAddress: "",
    contactPerson: "", city: "", amtsleitungName: "", amtsleitungTitle: "", signatureUrl: "",
    documentSubject: "", documentIntro: "", documentLegalText: "", documentClosing: ""
  });
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingSignature, setIsUploadingSignature] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileLoadError, setProfileLoadError] = useState("");
  const [profileLoadAttempt, setProfileLoadAttempt] = useState(0);
  const [profileDirty, setProfileDirty] = useState(false);
  const [instanceDirty, setInstanceDirty] = useState(false);
  const hasUnsavedChanges = profileDirty || instanceDirty;
  useUnsavedChanges(hasUnsavedChanges);

  // Das Profil wurde früher erst beim Öffnen des Dialogs geladen. Auf der eigenen Seite
  // muss es direkt beim Erscheinen da sein, sonst sieht das Formular leer aus.
  useEffect(() => {
    const loadProfile = async () => {
      setProfileLoaded(false);
      setProfileLoadError("");
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
          documentSubject: data.documentSubject || "",
          documentIntro: data.documentIntro || "",
          documentLegalText: data.documentLegalText || "",
          documentClosing: data.documentClosing || "",
          mailProvider: data.mailProvider === 'SMTP' ? 'SMTP' : 'NONE',
          latitude: data.latitude || null,
          longitude: data.longitude || null,
          smtpHost: data.smtpHost || "",
          smtpPort: data.smtpPort || 587,
          smtpSecure: Boolean(data.smtpSecure),
          smtpUser: data.smtpUser || "",
          smtpPass: data.smtpPass || "",
          smtpFromName: data.smtpFromName || "",
          smtpFromAddress: data.smtpFromAddress || "",
          teacherInviteValidityDays: data.teacherInviteValidityDays || 14
        });
        setProfileLoaded(true);
      } catch (e) {
        console.error(e);
        const message = "Profil konnte nicht geladen werden: " + (e as Error).message;
        setProfileLoadError(message);
        toast({ variant: "error", title: message });
      }
    };
    loadProfile();
  }, [profileLoadAttempt, toast]);

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
    formData.append("purpose", "logo");
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const respData = await res.json();
      if (respData.success) {
        setTemplateSettings(prev => ({ ...prev, logoUrl: respData.url }));
      } else {
        toast({ variant: "error", title: "Upload fehlgeschlagen: " + (respData.error || "Unbekannter Fehler") });
      }
    } catch {
      toast({ variant: "error", title: "Fehler beim Upload des Logos." });
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleUploadSignature = async (file: File) => {
    setIsUploadingSignature(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("purpose", "signature");
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const respData = await res.json();
      if (respData.success) {
        setTemplateSettings(prev => ({ ...prev, signatureUrl: respData.url }));
      } else {
        toast({ variant: "error", title: "Upload fehlgeschlagen: " + (respData.error || "Unbekannter Fehler") });
      }
    } catch {
      toast({ variant: "error", title: "Fehler beim Upload der Unterschrift." });
    } finally {
      setIsUploadingSignature(false);
    }
  };

  return (
    <div className="max-w-5xl space-y-8">
      <div className="sticky top-2 z-20 flex flex-wrap gap-2 rounded-xl border bg-background/95 p-2 shadow-sm backdrop-blur">
        <a href="#public-instance" className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted">Öffentlicher Auftritt</a>
        <a href="#documents-mail" className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted">Dokumente &amp; Mail</a>
        <a href="#operations" className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted">Betrieb</a>
        <span className={`ml-auto self-center px-2 text-xs font-medium ${hasUnsavedChanges ? "text-amber-700" : "text-emerald-700"}`}>{hasUnsavedChanges ? "Nicht gespeicherte Änderungen" : "Alle Änderungen gespeichert"}</span>
      </div>
      <InstanceSettings profileLogoUrl={templateSettings.logoUrl} onDirtyChange={setInstanceDirty} />
      {profileLoaded ? <SchulamtProfileForm
        templateSettings={templateSettings}
        setTemplateSettings={setTemplateSettings}
        isSavingTemplate={isSavingTemplate}
        setIsSavingTemplate={setIsSavingTemplate}
        isUploadingLogo={isUploadingLogo}
        handleUploadLogo={handleUploadLogo}
        isUploadingSignature={isUploadingSignature}
        handleUploadSignature={handleUploadSignature}
        handleGeneratePreview={handleGeneratePreview}
        profileLoaded={profileLoaded}
        onDirtyChange={setProfileDirty}
      /> : profileLoadError ? <div id="documents-mail" className="scroll-mt-24 space-y-3 rounded-xl border bg-card p-6 text-sm" role="alert"><p className="text-destructive">{profileLoadError}</p><Button type="button" variant="outline" onClick={() => setProfileLoadAttempt((attempt) => attempt + 1)}>Erneut laden</Button></div> : <div id="documents-mail" className="scroll-mt-24 rounded-xl border bg-card p-6 text-sm text-muted-foreground" role="status">Dokument- und Mail-Einstellungen werden geladen …</div>}
      <section id="operations" className="scroll-mt-24 space-y-8"><UpdateStatusCard /><EmailOutboxPanel /></section>
    </div>
  );
}
