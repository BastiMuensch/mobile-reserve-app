"use client";

import { useState } from 'react';
import { Loader2, Mail } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';

export function SchoolEmailSettings() {
  const { user, setUser } = useAuth();
  const [email, setEmail] = useState(user?.email ?? '');
  const [confirmation, setConfirmation] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedEmail, setSavedEmail] = useState('');
  const changed = email.trim().toLowerCase() !== (user?.email ?? '').trim().toLowerCase();
  // Only the address is persisted. Browsers/password managers may autofill the
  // confirmation fields even when no address change was requested; those fields
  // alone must not keep the saved school profile marked as dirty.
  useUnsavedChanges(changed);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSavedEmail('');
    if (email.trim().toLowerCase() !== confirmation.trim().toLowerCase()) {
      setError('Die E-Mail-Adressen stimmen nicht überein.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/school/account', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, currentPassword }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'Die E-Mail-Adresse konnte nicht geändert werden.');
      if (user) setUser({ ...user, email: body.email });
      setEmail(body.email);
      setSavedEmail(body.email);
      setConfirmation('');
      setCurrentPassword('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Die E-Mail-Adresse konnte nicht geändert werden.');
    } finally {
      setBusy(false);
    }
  };

  return <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-card">
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-xl"><Mail className="h-5 w-5 text-primary" /> E-Mail-Adresse der Schule</CardTitle>
      <CardDescription>Diese Adresse wird für Ihre Anmeldung und für E-Mail-Benachrichtigungen verwendet. Nach einer Änderung melden Sie sich mit der neuen Adresse und Ihrem bisherigen Passwort an.</CardDescription>
    </CardHeader>
    <CardContent>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="school-email">E-Mail-Adresse</Label>
          <Input id="school-email" type="email" autoComplete="email" value={email} onChange={event => { setEmail(event.target.value); setSavedEmail(''); }} required disabled={busy} maxLength={320} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="school-email-confirmation">Neue E-Mail-Adresse wiederholen</Label>
          <Input id="school-email-confirmation" type="email" autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)} required disabled={busy} maxLength={320} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="school-email-password">Aktuelles Passwort zur Bestätigung</Label>
          <Input id="school-email-password" type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required disabled={busy} maxLength={200} />
          <p className="text-xs text-muted-foreground">Sie bleiben hier angemeldet. Andere bestehende Sitzungen werden abgemeldet.</p>
        </div>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
        {savedEmail && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-300">Gespeichert. Für Ihre nächste Anmeldung und künftige E-Mail-Benachrichtigungen gilt jetzt {savedEmail}.</p>}
        <div className="flex justify-end"><Button type="submit" disabled={busy || !changed}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}E-Mail-Adresse speichern</Button></div>
      </form>
    </CardContent>
  </Card>;
}
