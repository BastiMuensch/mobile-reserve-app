import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { TemplateSettingsForm } from "@/types/models";

interface TemplateSettingsDialogProps {
  isTemplateSettingsOpen: boolean;
  setIsTemplateSettingsOpen: (val: boolean) => void;
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

export function TemplateSettingsDialog({
  isTemplateSettingsOpen,
  setIsTemplateSettingsOpen,
  templateSettings,
  setTemplateSettings,
  isSavingTemplate,
  setIsSavingTemplate,
  isUploadingLogo,
  handleUploadLogo,
  isUploadingSignature,
  handleUploadSignature,
  handleGeneratePreview
}: TemplateSettingsDialogProps) {
  return (
    <Dialog open={isTemplateSettingsOpen} onOpenChange={setIsTemplateSettingsOpen}>
      <DialogContent className="max-w-[95vw] sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Briefvorlage konfigurieren</DialogTitle>
          <DialogDescription>
            Passen Sie die Texte, das Logo und die Unterschrift für die PDF-Einsatznachweise dieses Schulamtes an.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={async (e) => {
          e.preventDefault();
          setIsSavingTemplate(true);
          try {
            const res = await fetch('/api/schulamt/profile', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(templateSettings)
            });
            if (!res.ok) {
              alert('Einstellungen konnten nicht gespeichert werden.');
            } else {
              alert('Briefvorlage erfolgreich gespeichert!');
              setIsTemplateSettingsOpen(false);
            }
          } catch {
            alert('Netzwerkfehler beim Speichern der Einstellungen.');
          } finally {
            setIsSavingTemplate(false);
          }
        }} className="space-y-4 py-2">
          
          <div className="space-y-2">
            <Label htmlFor="headerText">Briefkopf / Kopfzeile (Text)</Label>
            <Input 
              id="headerText"
              value={templateSettings.headerText} 
              onChange={e => setTemplateSettings({...templateSettings, headerText: e.target.value})} 
              placeholder="Staatliche Schulämter im Landkreis Unterallgäu..." 
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="returnAddress">Rücksendezeile (über Adressfenster)</Label>
            <Input 
              id="returnAddress"
              value={templateSettings.returnAddress} 
              onChange={e => setTemplateSettings({...templateSettings, returnAddress: e.target.value})} 
              placeholder="Staatliches Schulamt Unterallgäu - Memminger Str. 18..." 
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Logo (rechter Seitenrand)</Label>
              <div className="flex flex-col gap-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg p-3 justify-center items-center bg-slate-50 dark:bg-slate-900/50">
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
                  <span className="text-xs text-slate-400">Kein Logo hochgeladen (Standard-Logo wird verwendet)</span>
                )}
                <label className="cursor-pointer bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs px-3 py-1.5 rounded font-medium shadow-sm transition-colors">
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
              <span className="text-[10px] text-slate-400 block mt-1">Ausgabe im Brief als: "[Ort], den 07.06.2026"</span>
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-100 dark:border-slate-800 pt-4">
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

          <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-4">
            <Label>Handschriftliche Unterschrift</Label>
            <div className="flex flex-col gap-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg p-3 justify-center items-center bg-slate-50 dark:bg-slate-900/50">
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
                <span className="text-xs text-slate-400">Keine Unterschrift hochgeladen (Standard-Unterschrift wird verwendet)</span>
              )}
              <label className="cursor-pointer bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs px-3 py-1.5 rounded font-medium shadow-sm transition-colors">
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

          <DialogFooter className="pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
            <Button type="button" variant="ghost" onClick={handleGeneratePreview} className="text-primary hover:bg-primary/10">Vorschau generieren</Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setIsTemplateSettingsOpen(false)}>Abbrechen</Button>
              <Button type="submit" disabled={isSavingTemplate}>{isSavingTemplate ? 'Speichern...' : 'Vorlage Speichern'}</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
