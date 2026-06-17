import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MailSettings } from "@/types/models";

interface SettingsDialogProps {
  isSettingsOpen: boolean;
  setIsSettingsOpen: (val: boolean) => void;
  settings: { smtpHost: string; smtpUser: string; smtpPass: string; };
  setSettings: (val: MailSettings) => void;
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
          <DialogTitle>Mail-API Konfiguration</DialogTitle>
          <DialogDescription>
            Hinterlegen Sie die Zugangsdaten für den Mail-Versand.
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
          <DialogFooter>
            <Button type="submit" disabled={isSavingSettings}>{isSavingSettings ? 'Speichern...' : 'Speichern'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
