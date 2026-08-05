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
  handleGeneratePreview
}: SchulamtProfileFormProps) {
  const { toast } = useToast();

  const handleSave = async () => {
    setIsSavingTemplate(true);
    try {
      const res = await fetch('/api/schulamt/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(templateSettings)
      });
      if (!res.ok) {
        toast({ variant: "error", title: "Einstellungen konnten nicht gespeichert werden." });
      } else {
        toast({ variant: "success", title: "Profil erfolgreich gespeichert!" });
      }
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler beim Speichern der Einstellungen." });
    } finally {
      setIsSavingTemplate(false);
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} className="space-y-6">
      <Card className="shadow-xl bg-card/80 backdrop-blur-sm border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <FileText className="w-5 h-5 text-muted-foreground" /> Briefkopf & Abordnungsschreiben
          </CardTitle>
          <CardDescription>
            Diese Angaben erscheinen auf jedem Abordnungsschreiben: Kopfzeile, Absender- und
            Kontaktangaben, Amtsleitung, Logo und Unterschrift.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="headerText">Briefkopf / Kopfzeile (Text)</Label>
            <Input
              id="headerText"
              value={templateSettings.headerText}
              onChange={e => setTemplateSettings({...templateSettings, headerText: e.target.value})}
              placeholder="Staatliches Schulamt Musterstadt"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="returnAddress">Rücksendezeile (über Adressfenster)</Label>
            <Input
              id="returnAddress"
              value={templateSettings.returnAddress}
              onChange={e => setTemplateSettings({...templateSettings, returnAddress: e.target.value})}
              placeholder="Staatliches Schulamt Musterstadt - Musterstr. 1..."
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Logo (rechter Seitenrand)</Label>
              <div className="flex flex-col gap-2 border border-dashed border-border rounded-lg p-3 justify-center items-center bg-muted/50">
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
                  <span className="text-xs text-muted-foreground">Kein Logo hochgeladen (Standard-Logo wird verwendet)</span>
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
                placeholder="Mindelheim"
                required
              />
              <span className="text-[10px] text-muted-foreground block mt-1">Ausgabe im Brief als: &quot;[Ort], den 07.06.2026&quot;</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="contactAddress">Adresse (rechter Seitenrand)</Label>
              <textarea
                id="contactAddress"
                value={templateSettings.contactAddress}
                onChange={e => setTemplateSettings({...templateSettings, contactAddress: e.target.value})}
                placeholder="Memminger Str. 18&#10;87719 Mindelheim..."
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
                placeholder="Tamara Schmidt&#10;Durchwahl: 08261 995 441..."
                rows={4}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-border pt-4">
            <div className="space-y-2">
              <Label htmlFor="amtsleitungName">Name der Amtsleitung</Label>
              <Input
                id="amtsleitungName"
                value={templateSettings.amtsleitungName}
                onChange={e => setTemplateSettings({...templateSettings, amtsleitungName: e.target.value})}
                placeholder="Ursula Abt"
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

          <div className="space-y-2 border-t border-border pt-4">
            <Label>Handschriftliche Unterschrift</Label>
            <div className="flex flex-col gap-2 border border-dashed border-border rounded-lg p-3 justify-center items-center bg-muted/50">
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
                <span className="text-xs text-muted-foreground">Keine Unterschrift hochgeladen (Standard-Unterschrift wird verwendet)</span>
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

          <div className="space-y-2 border-t border-border pt-4">
            <Label className="flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" /> Karten-Pin (Schulamt Standort)</Label>
            <p className="text-xs text-muted-foreground mb-2">Dieser Pin markiert die Standard-Kartenansicht für die Schulen in diesem Schulamtbezirk.</p>
            <LocationPickerMap
              lat={templateSettings.latitude ?? null}
              lng={templateSettings.longitude ?? null}
              onChange={(lat, lng) => setTemplateSettings({...templateSettings, latitude: lat, longitude: lng})}
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button type="button" variant="ghost" onClick={handleGeneratePreview} className="text-primary hover:bg-primary/10">Vorschau generieren</Button>
        </CardFooter>
      </Card>

      <Card className="shadow-xl bg-card/80 backdrop-blur-sm border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Server className="w-5 h-5 text-muted-foreground" /> Mail-Server (SMTP)
          </CardTitle>
          <CardDescription>
            Zugangsdaten des E-Mail-Servers, über den Benachrichtigungen aus diesem Schulamt verschickt werden.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={isSavingTemplate}>{isSavingTemplate ? 'Speichern...' : 'Profil speichern'}</Button>
        </CardFooter>
      </Card>
    </form>
  );
}
