"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { SchulamtProfileForm } from "@/components/schulamt/SchulamtProfileForm";
import { UpdateStatusCard } from "@/components/updates/UpdateStatus";
import { EmailOutboxPanel } from "@/components/schulamt/EmailOutboxPanel";
import { InstanceSettings } from "@/components/schulamt/InstanceSettings";
import { TemplateSettingsForm } from "@/types/models";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { CalendarCheck, FileText, Bell, PanelTop, Settings2 } from "lucide-react";
import type { ProfileSection } from "@/lib/profileSections";
import { Button } from "@/components/ui/button";

const SETTINGS_TOPICS = [
  { id: 'assignment', label: 'Zuweisung', icon: CalendarCheck, hash: 'assignment-settings' },
  { id: 'documents', label: 'Dokumente', icon: FileText, hash: 'documents-mail' },
  { id: 'notifications', label: 'Benachrichtigungen', icon: Bell, hash: 'mail-settings' },
  { id: 'public', label: 'Öffentlicher Auftritt', icon: PanelTop, hash: 'public-instance' },
  { id: 'operations', label: 'Betrieb & Updates', icon: Settings2, hash: 'operations' },
] as const;
type SettingsTopic = (typeof SETTINGS_TOPICS)[number]['id'];

/**
 * Nur noch das Schulamt-Profil (Briefkopf, Amtsleitung, Mail-Server). Backup, CSV-Export
 * und der Schuljahres-Reset sind auf die eigene Seite "Dokumentation" umgezogen - dort
 * geht es um wiederkehrende Pflichten und einschneidende Aktionen, hier um Konfiguration.
 */
export default function SchulamtEinstellungenPage() {
  const { toast } = useToast();
  const [activeTopic, setActiveTopic] = useState<SettingsTopic>('assignment');
  useEffect(() => {
    const syncTopic = () => {
      const hash = window.location.hash.slice(1);
      const topic = hash === 'email-outbox' ? 'notifications' : hash === 'updates' ? 'operations' : SETTINGS_TOPICS.find(topic => topic.hash === hash)?.id;
      if (topic) setActiveTopic(topic);
    };
    syncTopic();
    window.addEventListener('hashchange', syncTopic);
    return () => window.removeEventListener('hashchange', syncTopic);
  }, []);
  const profileTopic = ['assignment', 'documents', 'notifications'].includes(activeTopic);
  const selectTopic = (topic: SettingsTopic) => {
    setActiveTopic(topic);
    window.history.replaceState(null, '', `#${SETTINGS_TOPICS.find(item => item.id === topic)!.hash}`);
  };


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
          teacherInviteValidityDays: data.teacherInviteValidityDays || 14,
          requestUrgencyNoteEnabled: data.requestUrgencyNoteEnabled === true,
          reserveShortageMode: data.reserveShortageMode === true,
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
    <div className="grid max-w-6xl items-start gap-5 xl:grid-cols-[190px_minmax(0,1fr)]">
      <nav aria-label="Einstellungsthemen" className="flex flex-wrap gap-1 xl:sticky xl:top-5 xl:flex-col">
        <div className="w-full space-y-2 text-sm font-medium sm:hidden"><label htmlFor="settings-topic">Bereich</label>
          <select id="settings-topic" className="block w-full rounded-lg border border-border bg-card px-3 py-2" value={activeTopic} disabled={isSavingTemplate} onChange={event => selectTopic(event.target.value as SettingsTopic)}>
            {SETTINGS_TOPICS.map(topic => <option key={topic.id} value={topic.id}>{topic.label}</option>)}
          </select>
        </div>
        {SETTINGS_TOPICS.map(topic => <button key={topic.id} type="button" aria-pressed={activeTopic === topic.id} disabled={isSavingTemplate}
          onClick={() => selectTopic(topic.id)}
          className={`hidden min-h-11 items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm sm:flex disabled:opacity-50 ${activeTopic === topic.id ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted'}`}><topic.icon className="size-4 shrink-0" />{topic.label}</button>)}
        <p className={`mt-3 w-full px-3 text-xs ${hasUnsavedChanges ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`} role="status">{hasUnsavedChanges ? 'Ungespeicherte Änderungen' : 'Alle Änderungen gespeichert'}</p>
      </nav>
      <div className="min-w-0 space-y-5">
      <div className={activeTopic === 'public' ? '' : 'hidden'}><InstanceSettings profileLogoUrl={templateSettings.logoUrl} onDirtyChange={setInstanceDirty} /></div>
      <div className={profileTopic ? '' : 'hidden'}>
      {profileLoaded ? <SchulamtProfileForm
        activeSection={profileTopic ? activeTopic as ProfileSection : "assignment"}
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
      </div>
      <section className={activeTopic === 'notifications' ? '' : 'hidden'}><EmailOutboxPanel /></section>
      <section id="operations" className={activeTopic === 'operations' ? 'scroll-mt-24 space-y-6' : 'hidden'}><UpdateStatusCard /></section>
      </div>
    </div>
  );
}
