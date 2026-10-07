"use client";

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { handleUnauthorized } from '@/lib/authClient';
import type { ReleaseNotice } from '@/lib/releaseNotes';

export function InstalledReleaseNotice() {
  const { user, isLoading } = useAuth();
  const pathname = usePathname();
  const inApp = pathname === '/' || pathname === '/schule' || pathname.startsWith('/schule/')
    || pathname === '/schulamt' || pathname.startsWith('/schulamt/');
  if (isLoading || !user || user.mustChangePassword || !inApp
    || (user.role !== 'SCHULAMT' && user.role !== 'SCHOOL')) return null;
  return <AccountReleaseNotice key={`${user.id}:${user.role}`} />;
}

function AccountReleaseNotice() {
  const [notice, setNotice] = useState<ReleaseNotice | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const acknowledged = useRef(new Set<string>());
  const saveController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let lastCheck = 0;
    let loading = false;
    async function load(force = false) {
      if (document.visibilityState === 'hidden' || loading || saveController.current) return;
      if (!force && Date.now() - lastCheck < 60_000) return;
      lastCheck = Date.now();
      loading = true;
      try {
        const response = await fetch('/api/release-notes', { cache: 'no-store', signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 401) { handleUnauthorized(); return; }
        if (!response.ok) return;
        const data = await response.json() as { notice: ReleaseNotice | null };
        if (!controller.signal.aborted && !saveController.current) {
          // A GET started before confirmation must never reopen the same notice.
          setNotice(data.notice && !acknowledged.current.has(data.notice.version) ? data.notice : null);
        }
      } catch {
        // A secondary notice must not prevent using the app while offline.
        // The next refresh or reconnect retries it without marking it as seen.
      } finally {
        loading = false;
      }
    }
    const refresh = () => { void load(); };
    const reconnect = () => { void load(true); };
    void load();
    window.addEventListener('app-refresh', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', reconnect);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller.abort();
      saveController.current?.abort();
      window.removeEventListener('app-refresh', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', reconnect);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  async function acknowledge() {
    if (!notice || saveController.current) return;
    const controller = new AbortController();
    saveController.current = controller;
    setIsSaving(true);
    setError('');
    try {
      const response = await fetch('/api/release-notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: notice.version }), signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (response.status === 401) { handleUnauthorized(); return; }
      if (!response.ok) throw new Error('Acknowledgement failed');
      acknowledged.current.add(notice.version);
      setNotice(null);
    } catch {
      if (!controller.signal.aborted) setError('Die Bestätigung konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.');
    } finally {
      if (!controller.signal.aborted) {
        saveController.current = null;
        setIsSaving(false);
      }
    }
  }

  if (!notice) return null;
  return <ReleaseNoticeDialog notice={notice} isSaving={isSaving} error={error} onAcknowledge={() => void acknowledge()} />;
}

export function ReleaseNoticeDialog({ notice, isSaving, error, onAcknowledge }: {
  notice: ReleaseNotice;
  isSaving: boolean;
  error: string;
  onAcknowledge: () => void;
}) {
  return (
    <Dialog open onOpenChange={open => { if (!open && !isSaving) onAcknowledge(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg" showCloseButton={!isSaving}>
        <DialogHeader className="pr-8">
          <span className="mb-1 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Sparkles className="size-5" aria-hidden="true" /></span>
          <DialogTitle className="text-xl leading-snug">Neu in Version {notice.version}</DialogTitle>
          <DialogDescription>MobileReserve.digital wurde aktualisiert. Das hat sich für Sie geändert:</DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-3 pl-5 text-sm leading-relaxed">
          {notice.changes.map(change => <li key={change}>{change}</li>)}
        </ul>
        <p className="text-xs text-muted-foreground">Nach Ihrer Bestätigung wird dieser Hinweis für Ihren Zugang nicht erneut angezeigt.</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" disabled={isSaving} onClick={onAcknowledge}>{isSaving ? 'Wird gespeichert …' : 'Verstanden'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
