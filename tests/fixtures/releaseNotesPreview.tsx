// Local-only preview: real auth/notice components with synthetic responses.
import { createRoot } from 'react-dom/client';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { AuthProvider, useAuth, type AuthUser } from '../../src/components/AuthProvider';
import { InstalledReleaseNotice } from '../../src/components/updates/InstalledReleaseNotice';
import { Button } from '../../src/components/ui/button';
import { getReleaseNotice, releaseSeenKey } from '../../src/lib/releaseNotes';
import packageJson from '../../package.json';

const params = new URLSearchParams(location.search);
const account = (role: string): AuthUser => ({ id: `preview-${role}`, role, email: `${role}@example.test`, schoolId: null, teacherId: null });
let currentUser = account(params.get('role') || 'SCHOOL');
let version = packageJson.version;
let failNextSave = params.has('fail');
const seen = new Set<string>();

window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (url.origin !== location.origin) return Response.json({}, { status: 403 });
  if (url.pathname === '/api/auth/me') return Response.json({ user: currentUser });
  if (url.pathname === '/api/auth/refresh') return Response.json({ success: true });
  if (url.pathname === '/api/release-notes') {
    const key = releaseSeenKey(currentUser.id, version);
    if (init?.method === 'POST') {
      if (failNextSave) { failNextSave = false; return Response.json({}, { status: 503 }); }
      seen.add(key);
      return Response.json({ success: true });
    }
    return Response.json({ notice: seen.has(key) ? null : getReleaseNotice(version, currentUser.role) });
  }
  return Response.json({}, { status: 404 });
};

function Preview() {
  const { setUser } = useAuth();
  return <main className="mx-auto max-w-3xl space-y-5 p-6">
    <h1 className="text-2xl font-semibold">Vorschau: Neuerungen nach einem Update</h1>
    <p>Lokale Beispieldaten. Bestätigungen gelten nur in diesem geöffneten Vorschaufenster.</p>
    <div className="flex flex-wrap gap-3">
      {(['SCHOOL', 'SCHULAMT', 'TEACHER'] as const).map(role => <Button key={role} variant="outline" onClick={() => { currentUser = account(role); setUser(currentUser); }}>{role === 'SCHOOL' ? 'Schule' : role === 'SCHULAMT' ? 'Schulamt' : 'Lehrkraft'}</Button>)}
      <Button variant="outline" onClick={() => window.dispatchEvent(new Event('online'))}>Erneut prüfen</Button>
      <Button onClick={() => { version = `${packageJson.version}+vorschau.2`; window.dispatchEvent(new Event('online')); }}>Nächstes Update simulieren</Button>
    </div>
    <InstalledReleaseNotice />
  </main>;
}

createRoot(document.getElementById('root')!).render(
  <PathnameContext.Provider value="/"><AuthProvider><Preview /></AuthProvider></PathnameContext.Provider>,
);
