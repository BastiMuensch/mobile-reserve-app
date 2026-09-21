"use client";

import { useState } from 'react';
import { Loader2, LockKeyhole, LogOut } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ChangePasswordForm({ required = false }: { required?: boolean }) {
  const { user, setUser, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (newPassword !== confirmation) return setError('Die Passwörter stimmen nicht überein.');
    if (newPassword.length < 12) return setError('Das neue Passwort muss mindestens 12 Zeichen lang sein.');
    if (new TextEncoder().encode(newPassword).byteLength > 72) return setError('Das neue Passwort darf höchstens 72 UTF-8-Bytes lang sein.');
    if (currentPassword === newPassword) return setError('Das neue Passwort muss sich vom bisherigen Passwort unterscheiden.');
    setBusy(true);
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'Das Passwort konnte nicht geändert werden.');
      if (user) setUser({ ...user, mustChangePassword: false });
      setCurrentPassword(''); setNewPassword(''); setConfirmation(''); setSuccess(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Das Passwort konnte nicht geändert werden.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={required ? 'min-h-screen flex items-center justify-center bg-background p-4' : 'mx-auto w-full max-w-xl p-4 sm:p-8'}>
      <Card className="w-full max-w-xl shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><LockKeyhole className="size-5" />{required ? 'Passwort ändern' : 'Eigenes Passwort ändern'}</CardTitle>
          <p className="text-sm text-muted-foreground">{required ? 'Bitte ersetzen Sie Ihr Initialpasswort, bevor Sie MobileReserve.digital nutzen.' : 'Nach dem Speichern bleiben Sie angemeldet; andere Sitzungen werden abgemeldet.'}</p>
        </CardHeader>
        {success ? <CardContent className="text-sm text-green-700 dark:text-green-400">Ihr Passwort wurde geändert.</CardContent> : <form onSubmit={submit}>
          <CardContent className="space-y-4 pb-6">
            <div className="space-y-2"><Label htmlFor="current-password">Aktuelles Passwort</Label><Input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required disabled={busy} maxLength={200} /></div>
            <div className="space-y-2"><Label htmlFor="new-password">Neues Passwort</Label><Input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} required disabled={busy} minLength={12} maxLength={200} /><p className="text-xs text-muted-foreground">Mindestens 12 Zeichen, höchstens 72 UTF-8-Bytes.</p></div>
            <div className="space-y-2"><Label htmlFor="confirm-new-password">Neues Passwort bestätigen</Label><Input id="confirm-new-password" type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} required disabled={busy} minLength={12} maxLength={200} /></div>
            {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-medium text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
          </CardContent>
          <CardFooter className="justify-end gap-2"><Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />}Passwort speichern</Button></CardFooter>
        </form>}
        {required && <CardFooter className="justify-center"><Button variant="ghost" onClick={() => void logout()} disabled={busy}><LogOut />Abmelden</Button></CardFooter>}
      </Card>
    </main>
  );
}
