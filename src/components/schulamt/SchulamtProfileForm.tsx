import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { TemplateSettingsForm } from "@/types/models";
import dynamic from 'next/dynamic';
import { FileText, MapPin, Server } from "lucide-react";
import { useToast } from "@/components/ui/toast";

const LocationPickerMap = dynamic(() => import('@/components/LocationPickerMap'), {
  ssr: false,
  loading: () => <div className="h-[300px] w-full bg-muted animate-pulse rounded-lg flex items-center justify-center text-muted-foreground">Lade Karte...</div>
});

interface SchulamtProfileFormProps {
  templateSettings: TemplateSettingsForm;
  setTemplateSettings: (val: TemplateSettingsForm) => void;
  isSavingTemplate: boolean;
  setIsSavingTemplate: (val: boolean) => void;
  isUploadingLogo: boolean;
  handleUploadLogo: (file: File) => void;
  isUploadingSignature: boolean;
  handleUploadSignature: (file: File) => void;
  handleGeneratePreview: () => void;
  profileLoaded: boolean;
  onDirtyChange: (dirty: boolean) => void;
}

/**
 * Profilformular des Schulamts, ehemals in einem Dialog (TemplateSettingsDialog).
 * Auf der eigenen Einstellungsseite ist kein Aufklappen mehr nötig - beide Karten
 * werden geladen sobald die Seite erscheint und teilen sich EINEN Speichern-Vorgang,
 * damit niemand nur den halben Brief oder nur den Mail-Server speichert und die
 * andere Hälfte verliert.
 */
export function SchulamtProfileForm({
  templateSettings,
  setTemplateSettings,
  isSavingTemplate,
  setIsSavingTemplate,
  isUploadingLogo,
  handleUploadLogo,
  isUploadingSignature,
  handleUploadSignature,
  handleGeneratePreview,
  profileLoaded,
  onDirtyChange,
}: SchulamtProfileFormProps) {
  const { toast } = useToast();
  const [isTestingSmtp, setIsTestingSmtp] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [latitudeInput, setLatitudeInput] = useState(String(templateSettings.latitude ?? ""));
  const [longitudeInput, setLongitudeInput] = useState(String(templateSettings.longitude ?? ""));
  useEffect(() => { setLatitudeInput(String(templateSettings.latitude ?? "")); setLongitudeInput(String(templateSettings.longitude ?? "")); }, [templateSettings.latitude, templateSettings.longitude]);
  const coordinateDraftDirty = latitudeInput !== String(templateSettings.latitude ?? "") || longitudeInput !== String(templateSettings.longitude ?? "");
  const mailProvider = templateSettings.mailProvider ?? 'NONE';
  const snapshot = useMemo(() => JSON.stringify(templateSettings), [templateSettings]);
  const isDirty = profileLoaded && Boolean(savedSnapshot) && (snapshot !== savedSnapshot || coordinateDraftDirty);

  const coordinates = () => {
    const latitude = latitudeInput.trim() ? Number(latitudeInput.replace(',', '.')) : null;
    const longitude = longitudeInput.trim() ? Number(longitudeInput.replace(',', '.')) : null;
    if ((latitude === null) !== (longitude === null) || (latitude !== null && (!Number.isFinite(latitude) || Math.abs(latitude) > 90)) || (longitude !== null && (!Number.isFinite(longitude) || Math.abs(longitude) > 180))) {
      toast({ variant: 'error', title: 'Bitte beide Koordinaten gültig eingeben oder beide Felder leeren.' });
      return null;
    }
    return { latitude, longitude };
  };

  useEffect(() => {
    if (profileLoaded && !savedSnapshot) setSavedSnapshot(snapshot);
  }, [profileLoaded, savedSnapshot, snapshot]);
  useEffect(() => { onDirtyChange(isDirty); }, [isDirty, onDirtyChange]);

  const handleSave = async () => {
    const position = coordinates();
    if (!position) return;
    setIsSavingTemplate(true);
    try {
      const res = await fetch('/api/schulamt/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...templateSettings, ...position })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({ variant: "error", title: "Einstellungen konnten nicht gespeichert werden.", description: body.error });
      } else {
        const body = await res.json();
        if (body.profile) {
          setTemplateSettings(body.profile);
          setSavedSnapshot(JSON.stringify(body.profile));
        } else {
          setSavedSnapshot(snapshot);
        }
        toast({ variant: "success", title: "Profil erfolgreich gespeichert!" });
      }
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler beim Speichern der Einstellungen." });
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handleTestSmtp = async () => {
    setIsTestingSmtp(true);
    try {
      const res = await fetch('/api/schulamt/profile/test-smtp', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'SMTP-Test fehlgeschlagen.');
      toast({ variant: 'success', title: data.message || 'SMTP-Test erfolgreich.' });
    } catch (error) {
      toast({ variant: 'error', title: error instanceof Error ? error.message : 'SMTP-Test fehlgeschlagen.' });
    } finally {
      setIsTestingSmtp(false);
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} className="space-y-8">
      <Card id="documents-mail" className="scroll-mt-24 border-border/70 bg-white py-5 dark:bg-card">
        <CardHeader className="px-5 sm:px-6">
          <CardTitle className="flex items-center justify-between gap-3 text-xl">
            <span className="flex items-center gap-2"><FileText className="w-5 h-5 text-muted-foreground" /> Briefkopf & Abordnungsschreiben</span><span className={`text-xs font-medium ${isDirty ? "text-amber-700" : "text-emerald-700"}`}>{isDirty ? "Nicht gespeichert" : "Gespeichert"}</span>
          </CardTitle>
          <CardDescription>
            Diese Angaben erscheinen auf jedem Abordnungsschreiben: Kopfzeile, Absender- und
            Kontaktangaben, Amtsleitung, Logo und Unterschrift.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 px-5 sm:px-6">
          <div className="space-y-2">
            <Label htmlFor="headerText">Briefkopf / Kopfzeile (Text)</Label>
            <Input
              id="headerText"
              value={templateSettings.headerText}
              onChange={e => setTemplateSettings({...templateSettings, headerText: e.target.value})}
              placeholder="Vollständige Behördenbezeichnung"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="returnAddress">Rücksendezeile (über Adressfenster)</Label>
            <Input
              id="returnAddress"
              value={templateSettings.returnAddress}
              onChange={e => setTemplateSettings({...templateSettings, returnAddress: e.target.value})}
              placeholder="Behörde · Straße Hausnummer · PLZ Ort"
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Logo (rechter Seitenrand)</Label>
              <div className="flex min-h-32 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/70 bg-muted/30 p-4">
                {templateSettings.logoUrl ? (
                  <div className="relative group max-h-[100px] overflow-hidden">
                    <Image
                      src={templateSettings.logoUrl}
                      alt="Logo Vorschau"
                      width={200}
                      height={200}
                      className="max-h-[80px] object-contain rounded"
                    />
                    <button
                      type="button"
                      onClick={() => setTemplateSettings({...templateSettings, logoUrl: ""})}
                      className="absolute inset-0 bg-black/60 text-white text-xs opacity-0 group-hover:opacity-100 flex items-center justify-center rounded transition-opacity"
                    >
                      Entfernen
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">Kein Logo hochgeladen</span>
                )}
                <label className="cursor-pointer bg-card hover:bg-muted text-foreground border border-border text-xs px-3 py-1.5 rounded font-medium shadow-sm transition-colors">
                  {isUploadingLogo ? 'Lade hoch...' : 'Datei auswählen'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    className="hidden"
                    disabled={isUploadingLogo}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleUploadLogo(file);
                    }}
                  />
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Ort & Datum-Präfix</Label>
              <Input
                value={templateSettings.city}
                onChange={e => setTemplateSettings({...templateSettings, city: e.target.value})}
                placeholder="Ort"
                required
              />
              <span className="text-[10px] text-muted-foreground block mt-1">Ausgabe im Brief als: &quot;[Ort], den 07.06.2026&quot;</span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contactAddress">Adresse (rechter Seitenrand)</Label>
              <textarea
                id="contactAddress"
                value={templateSettings.contactAddress}
                onChange={e => setTemplateSettings({...templateSettings, contactAddress: e.target.value})}
                placeholder="Straße Hausnummer&#10;PLZ Ort&#10;Telefon"
                rows={4}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contactPerson">Kontaktkanäle (rechter Seitenrand)</Label>
              <textarea
                id="contactPerson"
                value={templateSettings.contactPerson}
                onChange={e => setTemplateSettings({...templateSettings, contactPerson: e.target.value})}
                placeholder="Name&#10;Durchwahl&#10;E-Mail"
                rows={4}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 border-t border-border/70 pt-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="amtsleitungName">Name der Amtsleitung</Label>
              <Input
                id="amtsleitungName"
                value={templateSettings.amtsleitungName}
                onChange={e => setTemplateSettings({...templateSettings, amtsleitungName: e.target.value})}
                placeholder="Vor- und Nachname"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="amtsleitungTitle">Titel/Funktion der Amtsleitung</Label>
              <Input
                id="amtsleitungTitle"
                value={templateSettings.amtsleitungTitle}
                onChange={e => setTemplateSettings({...templateSettings, amtsleitungTitle: e.target.value})}
                placeholder="Schulamtsdirektorin"
                required
              />
            </div>
          </div>

          <div className="space-y-3 border-t border-border/70 pt-6">
            <Label>Handschriftliche Unterschrift</Label>
            <div className="flex min-h-28 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/70 bg-muted/30 p-4">
              {templateSettings.signatureUrl ? (
                <div className="relative group max-h-[80px] overflow-hidden">
                  <Image
                    src={templateSettings.signatureUrl}
                    alt="Unterschrift Vorschau"
                    width={200}
                    height={200}
                    className="max-h-[60px] object-contain rounded"
                  />
                  <button
                    type="button"
                    onClick={() => setTemplateSettings({...templateSettings, signatureUrl: ""})}
                    className="absolute inset-0 bg-black/60 text-white text-xs opacity-0 group-hover:opacity-100 flex items-center justify-center rounded transition-opacity"
                  >
                    Entfernen
                  </button>
                </div>
              ) : (
                  <span className="text-xs text-muted-foreground">Keine Unterschrift hochgeladen</span>
              )}
              <label className="cursor-pointer bg-card hover:bg-muted text-foreground border border-border text-xs px-3 py-1.5 rounded font-medium shadow-sm transition-colors">
                {isUploadingSignature ? 'Lade hoch...' : 'Datei auswählen'}
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  disabled={isUploadingSignature}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUploadSignature(file);
                  }}
                />
              </label>
            </div>
          </div>

          <div className="space-y-5 border-t border-border/70 pt-6">
            <h4 className="font-semibold">Texte des Abordnungs-/Bestätigungsschreibens</h4>
            <div className="space-y-2">
              <Label htmlFor="documentSubject">Betreff</Label>
              <Input id="documentSubject" value={templateSettings.documentSubject} onChange={e => setTemplateSettings({...templateSettings, documentSubject: e.target.value})} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="documentIntro">Einleitung</Label>
              <textarea id="documentIntro" rows={2} className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" value={templateSettings.documentIntro} onChange={e => setTemplateSettings({...templateSettings, documentIntro: e.target.value})} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="documentLegalText">Rechts-/Hinweistext</Label>
              <textarea id="documentLegalText" rows={7} className="flex w-full rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground" value={templateSettings.documentLegalText} readOnly aria-readonly="true" />
              <p className="text-xs text-muted-foreground">Der BayTGV-Hinweis ist rechtlich vorgegeben und kann nicht verändert werden.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="documentClosing">Schlussformel</Label>
              <Input id="documentClosing" value={templateSettings.documentClosing} onChange={e => setTemplateSettings({...templateSettings, documentClosing: e.target.value})} required />
            </div>
          </div>

          <div className="space-y-3 border-t border-border/70 pt-6">
            <Label className="flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" /> Karten-Pin (Schulamt Standort)</Label>
            <p className="text-xs text-muted-foreground mb-2">Dieser Pin markiert die Standard-Kartenansicht für die Schulen in diesem Schulamtbezirk.</p>
            <LocationPickerMap
              lat={templateSettings.latitude ?? null}
              lng={templateSettings.longitude ?? null}
              onChange={(lat, lng) => setTemplateSettings({...templateSettings, latitude: lat, longitude: lng})}
            />
            <fieldset className="rounded-lg border border-border bg-muted/20 p-3">
              <legend className="px-1 text-sm font-medium">Koordinaten ohne Karte eingeben</legend>
              <p className="mb-3 text-xs text-muted-foreground">Für Tastaturbedienung oder wenn die Karte nicht verfügbar ist. Dezimalkomma ist erlaubt.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label htmlFor="office-latitude">Breitengrad</Label><Input id="office-latitude" inputMode="decimal" value={latitudeInput} onChange={(event) => setLatitudeInput(event.target.value)} placeholder="z. B. 48,1234" /></div>
                <div className="space-y-1.5"><Label htmlFor="office-longitude">Längengrad</Label><Input id="office-longitude" inputMode="decimal" value={longitudeInput} onChange={(event) => setLongitudeInput(event.target.value)} placeholder="z. B. 11,5678" /></div>
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => { const position = coordinates(); if (position) setTemplateSettings({ ...templateSettings, ...position }); }}>Koordinaten auf Karte übernehmen</Button>
            </fieldset>
          </div>
        </CardContent>
        <CardFooter className="px-5 sm:px-6">
          <Button type="button" variant="ghost" onClick={handleGeneratePreview} className="text-primary hover:bg-primary/10">Vorschau generieren</Button>
        </CardFooter>
      </Card>

      <Card className="border-border/70 bg-white py-5 dark:bg-card">
        <CardHeader className="px-5 sm:px-6">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Server className="w-5 h-5 text-muted-foreground" /> Mail-Server (SMTP)
          </CardTitle>
          <CardDescription>Zugangsdaten für Benachrichtigungen dieses Schulamts. Mailversand kann jederzeit entfernt oder später aktiviert werden.</CardDescription>
        </CardHeader>
        <CardContent className="px-5 sm:px-6">
          <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Label>Mail-Anbieter</Label>
              <label className="flex items-center gap-2 text-sm"><input type="radio" name="mailProvider" checked={mailProvider === 'NONE'} onChange={() => setTemplateSettings({ ...templateSettings, mailProvider: 'NONE' })} /> Kein Mailversand</label>
              <label className="flex items-center gap-2 text-sm"><input type="radio" name="mailProvider" checked={mailProvider === 'SMTP'} onChange={() => setTemplateSettings({ ...templateSettings, mailProvider: 'SMTP' })} /> SMTP</label>
            </div>
            {mailProvider === 'SMTP' && <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="smtpHost">SMTP Server Host</Label>
              <Input
                id="smtpHost"
                value={templateSettings.smtpHost || ''}
                onChange={e => setTemplateSettings({...templateSettings, smtpHost: e.target.value})}
                placeholder="smtp.beispiel.de"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtpPort">Port</Label>
              <Input id="smtpPort" type="number" min={1} max={65535} value={templateSettings.smtpPort || 587} onChange={e => setTemplateSettings({...templateSettings, smtpPort: Number(e.target.value)})} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtpUser">Benutzername (E-Mail)</Label>
              <Input
                id="smtpUser"
                value={templateSettings.smtpUser || ''}
                onChange={e => setTemplateSettings({...templateSettings, smtpUser: e.target.value})}
                placeholder="schulamt@beispiel.de"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="smtpPass">Passwort</Label>
              <Input
                id="smtpPass"
                type="password"
                value={templateSettings.smtpPass || ''}
                onChange={e => setTemplateSettings({...templateSettings, smtpPass: e.target.value})}
                placeholder="********"
              />
              <p className="text-xs text-muted-foreground">Bei Änderung von Server, Port, TLS oder Benutzer muss das Passwort erneut eingegeben werden. Der Testversand verwendet ausschließlich die zuletzt gespeicherten Einstellungen.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtpFromName">Absendername</Label>
              <Input id="smtpFromName" value={templateSettings.smtpFromName || ''} onChange={e => setTemplateSettings({...templateSettings, smtpFromName: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtpFromAddress">Absender-E-Mail</Label>
              <Input id="smtpFromAddress" type="email" value={templateSettings.smtpFromAddress || ''} onChange={e => setTemplateSettings({...templateSettings, smtpFromAddress: e.target.value})} />
            </div>
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input type="checkbox" checked={Boolean(templateSettings.smtpSecure)} onChange={e => setTemplateSettings({...templateSettings, smtpSecure: e.target.checked})} />
              Direkte TLS-Verbindung (typisch Port 465; andernfalls STARTTLS)
            </label>
            </div>}
            {mailProvider === 'NONE' && <p className="text-sm text-muted-foreground">Es werden keine E-Mails über dieses Schulamt versendet. Beim Speichern werden vorhandene SMTP-Zugangsdaten sicher entfernt.</p>}
            <div className="space-y-2 border-t border-border/70 pt-6">
              <Label htmlFor="teacherInviteValidityDays">Standardgültigkeit für Einladungen Mobiler Reserven</Label>
              <Input
                id="teacherInviteValidityDays"
                type="number"
                min={1}
                max={90}
                value={templateSettings.teacherInviteValidityDays ?? 14}
                onChange={e => setTemplateSettings({ ...templateSettings, teacherInviteValidityDays: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">Einzelne Einladungen können abweichend befristet und beliebig oft erneuert werden.</p>
            </div>
          </div>
        </CardContent>
        <CardFooter className="px-5 sm:px-6">
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={isSavingTemplate}>{isSavingTemplate ? 'Speichern...' : isDirty ? 'Änderungen speichern' : 'Profil gespeichert'}</Button>
            {mailProvider === 'SMTP' && <Button type="button" variant="outline" disabled={isTestingSmtp || isSavingTemplate || isDirty} onClick={handleTestSmtp}>{isTestingSmtp ? 'Teste SMTP...' : isDirty ? 'Erst Änderungen speichern' : 'SMTP-Test senden'}</Button>}
            {mailProvider === 'SMTP' && <p className="self-center text-xs text-muted-foreground">Der SMTP-Test nutzt ausschließlich die zuletzt gespeicherte Konfiguration.</p>}
          </div>
        </CardFooter>
      </Card>
    </form>
  );
}
