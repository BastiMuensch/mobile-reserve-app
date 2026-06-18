import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SystemSettingsForm } from "@/types/models";

interface SettingsDialogProps {
  isSettingsOpen: boolean;
  setIsSettingsOpen: (val: boolean) => void;
  settings: SystemSettingsForm;
  setSettings: (val: SystemSettingsForm) => void;
  isSavingSettings: boolean;
  setIsSavingSettings: (val: boolean) => void;
}

export function SettingsDialog({
  isSettingsOpen,
  setIsSettingsOpen,
  settings,
  setSettings,
  isSavingSettings,
  setIsSavingSettings
}: SettingsDialogProps) {
  return (
    <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Allgemeine Einstellungen</DialogTitle>
          <DialogDescription>
            Hinterlegen Sie die Zugangsdaten für den Mail-Versand und das System-Impressum.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={async (e) => {
          e.preventDefault();
          setIsSavingSettings(true);
          try {
            const res = await fetch('/api/settings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(settings)
            });
            if (!res.ok) {
              alert('Einstellungen konnten nicht gespeichert werden.');
            } else {
              setIsSettingsOpen(false);
            }
          } catch {
            alert('Netzwerkfehler beim Speichern der Einstellungen.');
          } finally {
            setIsSavingSettings(false);
          }
        }} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>SMTP Host</Label>
            <Input value={settings.smtpHost} onChange={e => setSettings({...settings, smtpHost: e.target.value})} placeholder="smtp.example.com" />
          </div>
          <div className="space-y-2">
            <Label>SMTP Benutzer</Label>
            <Input value={settings.smtpUser} onChange={e => setSettings({...settings, smtpUser: e.target.value})} placeholder="user@example.com" />
          </div>
          <div className="space-y-2">
            <Label>SMTP Passwort</Label>
            <Input type="password" value={settings.smtpPass} onChange={e => setSettings({...settings, smtpPass: e.target.value})} />
          </div>
          <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Label>Impressum (wird auf der Startseite angezeigt)</Label>
            <textarea 
              className="flex min-h-[120px] w-full rounded-md border border-slate-200 bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:placeholder:text-slate-400 dark:focus-visible:ring-slate-300"
              placeholder="Angaben gemäß § 5 TMG..."
              value={settings.impressum || ''}
              onChange={e => setSettings({...settings, impressum: e.target.value})}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isSavingSettings}>{isSavingSettings ? 'Speichern...' : 'Speichern'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
