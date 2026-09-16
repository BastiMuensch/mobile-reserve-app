import { createRoot } from 'react-dom/client';
import { FullBackupButton } from '../../src/components/schulamt/FullBackupButton';
import { RestoreBackupButton } from '../../src/components/schulamt/RestoreBackupButton';
import { useState } from 'react';

function Preview() {
  const [dark, setDark] = useState(false);
  const [imported, setImported] = useState('');
  return <div className={dark ? 'dark' : ''}><main className="min-h-screen bg-background text-foreground p-4 sm:p-8 space-y-6">
    <h1 className="text-2xl font-semibold">Vollbackup – lokale UI-Prüfung</h1>
    <p>Nur erfundene Daten. Test-Anmeldepasswort: UI-Testpasswort</p>
    <button onClick={() => setDark(!dark)}>Hell/Dunkel wechseln</button>
    <section className="rounded-xl border bg-card p-4 max-w-2xl flex flex-wrap gap-2"><FullBackupButton /><RestoreBackupButton busy={false} onLegacyRestore={file => setImported(file.name)} /></section>
    <p role="status">{imported ? `TEST: Import angefragt: ${imported}` : 'TEST: Kein Import angefragt'}</p>
  </main></div>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
