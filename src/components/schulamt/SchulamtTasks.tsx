"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Mail, UserCheck, ClipboardList } from 'lucide-react';
import { handleUnauthorized } from '@/lib/authClient';

export function SchulamtTasks({ pendingTeacherCount, incompleteSchoolCount = 0 }: { pendingTeacherCount: number; incompleteSchoolCount?: number }) {
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
  if (!pendingTeacherCount && !incompleteSchoolCount && !failed && !error) return null;
  const linkClass = "flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-sm hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-primary";
  return <section aria-label="Offene Aufgaben" className="flex flex-wrap gap-2">
    {pendingTeacherCount > 0 && <Link href="/schulamt/reserven#registrierungen" className={linkClass}>
      <UserCheck className="size-4 shrink-0 text-primary" /><span>{pendingTeacherCount} {pendingTeacherCount === 1 ? 'Registrierung' : 'Registrierungen'} prüfen</span><ArrowUpRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
    </Link>}
    {incompleteSchoolCount > 0 && <Link href="/schulamt/schulen?profile=missing" className={linkClass}>
      <ClipboardList className="size-4 shrink-0 text-amber-700 dark:text-amber-300" /><span>{incompleteSchoolCount} {incompleteSchoolCount === 1 ? 'Schulprofil' : 'Schulprofile'} unvollständig</span><ArrowUpRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
    </Link>}
    {(Boolean(failed) || error) && <Link href="/schulamt/einstellungen#email-outbox" className={linkClass}>
      <Mail className="size-4 shrink-0 text-amber-700 dark:text-amber-300" /><span>{error ? 'Versandstatus prüfen' : `${failed} E-Mail${failed === 1 ? '' : 's'} nicht zugestellt`}</span><ArrowUpRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
    </Link>}
  </section>;
}
