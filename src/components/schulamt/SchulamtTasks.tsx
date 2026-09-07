"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Mail, UserCheck } from 'lucide-react';
import { handleUnauthorized } from '@/lib/authClient';

export function SchulamtTasks({ pendingTeacherCount }: { pendingTeacherCount: number }) {
  const [failed, setFailed] = useState<number | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let controller: AbortController | null = null;
    const refresh = async () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        const res = await fetch('/api/schulamt/email-outbox?summary=1', { signal: current.signal, cache: 'no-store' });
        if (res.status === 401) { handleUnauthorized(); return; }
        if (!res.ok) throw new Error('Outbox status unavailable');
        const result = await res.json();
        if (current.signal.aborted) return;
        setFailed(result.failed);
        setError(false);
      } catch {
        if (!current.signal.aborted) setError(true);
      }
    };
    void refresh();
    window.addEventListener('app-refresh', refresh);
    return () => { controller?.abort(); window.removeEventListener('app-refresh', refresh); };
  }, []);
  return <section aria-labelledby="tasks-title" className="rounded-xl border border-border/70 bg-card p-5 sm:p-6">
    <h2 id="tasks-title" className="font-semibold text-lg mb-4">Noch zu erledigen</h2>
    <div className="grid md:grid-cols-2 gap-5">
      <Link href="/schulamt/reserven" className="flex items-center gap-3 rounded-lg border border-border p-4 hover:bg-muted/50">
        <UserCheck className="size-5 text-primary shrink-0" /><div className="min-w-0"><p className="font-medium text-sm">{pendingTeacherCount > 0 ? `${pendingTeacherCount} Registrierungen prüfen` : 'Keine Freigaben ausstehend'}</p><p className="text-xs text-muted-foreground mt-1">Mobile Reserven verwalten</p></div><ArrowRight className="size-4 ml-auto shrink-0 text-primary" />
      </Link>
      <Link href="/schulamt/einstellungen#email-outbox" className="flex items-center gap-3 rounded-lg border border-border p-4 hover:bg-muted/50">
        <Mail className={`size-5 shrink-0 ${failed || error ? 'text-amber-700 dark:text-amber-300' : 'text-primary'}`} /><div className="min-w-0"><p className="font-medium text-sm">{error ? 'Versandstatus nicht verfügbar' : failed === null ? 'Versandstatus wird geladen …' : failed > 0 ? `${failed} E-Mail${failed === 1 ? '' : 's'} nicht zugestellt` : 'Keine fehlgeschlagenen E-Mails'}</p><p className="text-xs text-muted-foreground mt-1">E-Mail-Ausgang prüfen</p></div><ArrowRight className="size-4 ml-auto shrink-0 text-primary" />
      </Link>
    </div>
  </section>;
}
