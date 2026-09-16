"use client";

import { useId, useRef, useState } from 'react';
import { Upload, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { detectBackupFile, type BackupFileKind } from '@/lib/backupFileDetection';

export function RestoreBackupButton({ busy, onLegacyRestore }: { busy: boolean; onLegacyRestore: (file: File) => void }) {
  const id = useId();
  const selection = useRef(0);
  const [open, setOpen] = useState(false), [checking, setChecking] = useState(false), [recoveryAvailable, setRecoveryAvailable] = useState<boolean | null>(null);
  const [file, setFile] = useState<File | null>(null), [kind, setKind] = useState<BackupFileKind | null>(null);
  const [error, setError] = useState('');
  async function detectRecoveryGateway() {
    setRecoveryAvailable(null);
    try {
      const response = await fetch('/_recovery/api/capabilities', { cache: 'no-store' });
      const capability = response.ok ? await response.json() : null;
      setRecoveryAvailable(capability?.available === true);
    } catch { setRecoveryAvailable(false); }
  }
  function reset(next: boolean) {
    selection.current++; setOpen(next); setFile(null); setKind(null); setError(''); setChecking(false);
    if (next) void detectRecoveryGateway();
  }
  async function select(selected?: File) {
    const token = ++selection.current;
    setKind(null); setFile(null); setError('');
    if (!selected) { setChecking(false); return; }
    setChecking(true);
    try {
      const result = await detectBackupFile(selected);
      if (selection.current === token) { setFile(selected); setKind(result); }
    } catch (e) { if (selection.current === token) setError(e instanceof Error ? e.message : 'Datei konnte nicht gelesen werden.'); }
    finally { if (selection.current === token) setChecking(false); }
  }
  return <>
    <Button variant="outline" disabled={busy} onClick={() => reset(true)}><Upload className="size-4 text-primary" />{busy ? 'Wird wiederhergestellt …' : 'Sicherung wiederherstellen'}</Button>
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="sm:max-w-xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sicherung wiederherstellen</DialogTitle>
          <DialogDescription>Wählen Sie Ihre Backupdatei aus. Wir erkennen das Format und zeigen den passenden nächsten Schritt. Die Auswahl allein verändert keine Daten.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 min-w-0">
          <label htmlFor={id} className="block text-sm font-medium">Backupdatei</label>
          <input id={id} type="file" accept=".mrbackup,.json,application/json,application/octet-stream" className="block w-full min-w-0 text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-2" onChange={e => { void select(e.target.files?.[0]); }} />
          {checking && <p role="status" className="text-sm">Dateiformat wird lokal geprüft …</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {file && <p className="text-xs break-all text-muted-foreground">Ausgewählt: {file.name}</p>}
          {kind === 'full' && <div className="space-y-4">
            <p className="flex items-center gap-2 font-medium"><ShieldCheck className="size-5 shrink-0 text-primary" />Verschlüsseltes Vollbackup erkannt</p>
            {recoveryAvailable === null && <p role="status" className="text-sm text-muted-foreground">Browser-Wiederherstellung wird geprüft …</p>}
            {recoveryAvailable === true ? <>
              <p className="text-sm text-muted-foreground">Die Browser-Wiederherstellung ist eingerichtet. Datei und Sicherungs-Passwort werden im geschützten Wiederherstellungsmodus erneut abgefragt; diese Dateiauswahl wird nicht übertragen.</p>
              <a href="/_recovery/" className="inline-flex min-h-10 items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Zur Browser-Wiederherstellung</a>
              <p className="text-xs text-muted-foreground">Kein Terminal erforderlich. Der Wiederherstellungsmodus bleibt auch während der Wartung erreichbar.</p>
            </> : recoveryAvailable === false ? <>
              <p className="text-sm text-muted-foreground">Die Browser-Wiederherstellung ist auf diesem Server noch nicht eingerichtet. Diese App kann kein Vollbackup automatisch wiederherstellen.</p>
              <p className="text-sm font-medium">Betreiber muss Browser-Wiederherstellung einmalig einrichten.</p>
              <p className="text-xs text-muted-foreground">Bis dahin steht ausschließlich die dokumentierte Betreiber-Wiederherstellung außerhalb dieser laufenden App zur Verfügung.</p>
            </> : null}
          </div>}
          {kind === 'legacy' && <div className="space-y-4">
            <p className="font-medium">Ältere Sicherung erkannt</p>
            <p className="text-sm text-muted-foreground">Diese Sicherung kann hier importiert werden. Sie enthält keine vollständigen Logins und technischen Schlüssel. Beim Import werden bestehende Schulamtsdaten ersetzt. Erstellen Sie vorher ein aktuelles Vollbackup.</p>
            <Button variant="outline" disabled={busy || !file} onClick={() => { if (file) { const selected = file; reset(false); onLegacyRestore(selected); } }}>Import prüfen und bestätigen</Button>
          </div>}
          <Button variant="outline" className="w-full" onClick={() => reset(false)}>Schließen</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
