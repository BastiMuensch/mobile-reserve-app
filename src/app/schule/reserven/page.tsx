"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarDays, Loader2, Mail, MapPin, RefreshCw, UsersRound } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { handleUnauthorized } from '@/lib/authClient';
import type { ReserveAssignmentGroup, SchoolReservesData } from '@/lib/schoolReserves';

const phaseLabels = { CURRENT: 'Heute im Einsatz', PLANNED: 'Geplant', ENDED: 'Beendet', CANCELLED: 'Entfallen' };
const dateFormatter = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const formatDate = (value: string) => dateFormatter.format(new Date(`${value}T00:00:00Z`));

function AssignmentRow({ assignment }: { assignment: ReserveAssignmentGroup }) {
  const { phase, confirmation } = assignment;
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="flex items-start gap-2 font-semibold"><MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span className="break-words">{assignment.school.name}</span></p>
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarDays aria-hidden="true" className="size-4 shrink-0" />{formatDate(assignment.startDate)}{assignment.endDate !== assignment.startDate ? ` – ${formatDate(assignment.endDate)}` : ''}</p>
        <p className="pl-6 text-sm text-muted-foreground">{assignment.hoursPerDay} {assignment.hoursPerDay === 1 ? 'Unterrichtsstunde' : 'Unterrichtsstunden'}{assignment.days > 1 ? ` pro Tag · ${assignment.days} Einsatztage` : ''}</p>
      </div>
      <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${phase === 'CURRENT' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : phase === 'PLANNED' ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200' : 'bg-muted text-muted-foreground'}`}>{phaseLabels[phase]}</span>
        {confirmation !== 'REJECTED' && <span className="text-xs text-muted-foreground">{confirmation === 'ACCEPTED' ? 'Bestätigt' : 'Zugewiesen · Bestätigung ausstehend'}</span>}
      </div>
    </li>
  );
}

export default function SchoolReservesPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [data, setData] = useState<SchoolReservesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const savingRef = useRef(false);
  const schoolId = user?.role === 'SCHOOL' ? user.schoolId : null;

  useEffect(() => {
    if (!isLoading && (!user || user.role !== 'SCHOOL')) router.replace('/');
  }, [isLoading, user, router]);

  const load = useCallback(async () => {
    if (!schoolId || savingRef.current) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/school/reserves', { cache: 'no-store', signal: controller.signal });
      if (response.status === 401) { handleUnauthorized(); return; }
      if (!response.ok) throw new Error('Die Mobilen Reserven konnten nicht geladen werden. Bitte versuchen Sie es erneut.');
      const result: SchoolReservesData = await response.json();
      if (!controller.signal.aborted) setData(result);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut.');
    } finally {
      if (controllerRef.current === controller) setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    setData(null);
    void load();
    const refresh = () => { void load(); };
    window.addEventListener('app-refresh', refresh);
    return () => { controllerRef.current?.abort(); window.removeEventListener('app-refresh', refresh); };
  }, [load]);

  const setNotifications = async (enabled: boolean) => {
    savingRef.current = true;
    setSaving(true);
    // Cancel an older GET so it cannot overwrite the newly saved preference.
    controllerRef.current?.abort();
    try {
      const response = await fetch('/api/school/reserves', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reserveNotificationsEnabled: enabled }),
      });
      if (response.status === 401) { handleUnauthorized(); return; }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Die Einstellung konnte nicht gespeichert werden.');
      setData(current => current ? { ...current, reserveNotificationsEnabled: result.reserveNotificationsEnabled } : current);
      toast({ variant: 'success', title: enabled ? 'E-Mail-Benachrichtigungen aktiviert.' : 'E-Mail-Benachrichtigungen deaktiviert.' });
    } catch (cause) {
      toast({ variant: 'error', title: cause instanceof Error ? cause.message : 'Die Einstellung konnte nicht gespeichert werden.' });
    } finally {
      savingRef.current = false;
      setSaving(false);
      void load();
    }
  };

  if (isLoading || !user || user.role !== 'SCHOOL') return <div role="status" className="flex min-h-[40vh] items-center justify-center gap-2"><Loader2 aria-hidden="true" className="size-6 animate-spin" />Wird geladen…</div>;

  return (
    <div className="space-y-6">
      <header className="flex flex-col items-start justify-between gap-4 rounded-3xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:p-7">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">{data ? `Schuljahr ${data.schoolYear}` : 'Stammschule'}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Unsere Mobilen Reserven</h1>
          <p className="mt-2 text-sm text-muted-foreground">Einsatzorte und Termine der Mobilen Reserven Ihrer Stammschule.</p>
        </div>
        <Button variant="outline" disabled={loading || saving || !schoolId} onClick={() => void load()} className="gap-2"><RefreshCw aria-hidden="true" className={`size-4 ${loading ? 'animate-spin' : ''}`} />Aktualisieren</Button>
      </header>

      {error && <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">{error}<Button variant="outline" className="ml-3" onClick={() => void load()} disabled={loading}>Erneut laden</Button></div>}
      {loading && !data && <p role="status" className="flex items-center gap-2 p-6 text-muted-foreground"><Loader2 aria-hidden="true" className="size-5 animate-spin" />Mobile Reserven werden geladen…</p>}
      {!schoolId && <p role="alert">Diesem Konto ist noch keine Schule zugeordnet. Bitte wenden Sie sich an Ihr Schulamt.</p>}

      {data && <>
        <section aria-labelledby="reserve-mails" className="rounded-2xl border border-border bg-card p-5">
          <h2 id="reserve-mails" className="flex items-center gap-2 font-semibold"><Mail aria-hidden="true" className="size-5 text-primary" />Per E-Mail auf dem Laufenden bleiben</h2>
          <p className="mt-2 text-sm text-muted-foreground">Benachrichtigungen zu neuen Zuweisungen, Bestätigungen, Änderungen und Absagen gehen an <span className="inline-block max-w-full break-all align-bottom font-medium text-foreground">{data.notificationEmail}</span>.</p>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-3 text-sm font-medium">
              <input type="checkbox" className="size-5 accent-primary" checked={data.reserveNotificationsEnabled} disabled={saving || loading} onChange={event => void setNotifications(event.target.checked)} />
              E-Mail-Benachrichtigungen aktivieren {saving && <Loader2 aria-label="Wird gespeichert" className="size-4 animate-spin" />}
            </label>
            <Link href="/schule/profil" className="text-sm font-medium text-primary underline underline-offset-4">E-Mail-Adresse ändern</Link>
          </div>
        </section>

        {data.teachers.length === 0 ? <section className="rounded-2xl border border-dashed border-border p-8 text-center"><UsersRound aria-hidden="true" className="mx-auto mb-3 size-8 text-muted-foreground" /><h2 className="font-semibold">Noch keine Mobilen Reserven zugeordnet</h2><p className="mt-2 text-sm text-muted-foreground">Für dieses Schuljahr sind Ihrer Stammschule noch keine Mobilen Reserven zugeordnet.</p></section> : data.teachers.map(teacher => {
          const upcoming = teacher.assignments.filter(assignment => assignment.phase === 'CURRENT' || assignment.phase === 'PLANNED');
          const history = teacher.assignments.filter(assignment => assignment.phase === 'ENDED' || assignment.phase === 'CANCELLED').reverse();
          return <section key={teacher.id} className="rounded-2xl border border-border bg-card p-5" aria-labelledby={`teacher-${teacher.id}`}>
            <h2 id={`teacher-${teacher.id}`} className="mb-4 flex items-center gap-2 text-lg font-semibold"><UsersRound aria-hidden="true" className="size-5 shrink-0 text-primary" />{teacher.name}</h2>
            {upcoming.length > 0 ? <ul className="space-y-3">{upcoming.map(assignment => <AssignmentRow key={assignment.id} assignment={assignment} />)}</ul> : <p className="text-sm text-muted-foreground">Aktuell und demnächst sind keine Einsätze zugewiesen.</p>}
            {history.length > 0 && <details className="mt-5"><summary className="cursor-pointer text-sm font-medium text-muted-foreground">Beendete und entfallene Einsätze ({history.length})</summary><ul className="mt-3 space-y-3">{history.map(assignment => <AssignmentRow key={assignment.id} assignment={assignment} />)}</ul></details>}
          </section>;
        })}
      </>}
    </div>
  );
}
