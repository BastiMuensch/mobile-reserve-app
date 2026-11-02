"use client";

import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { previousTeachersFromHistory, shortHistoryDay, type AssignmentHistoryEntry } from '@/lib/requestAssignmentHistory';

type HistoryState = { entries: AssignmentHistoryEntry[]; error?: string } | null;

/** Loads earlier deployments for this demand or the same class once; the result is
 * shared between the history box and the candidate list. */
export function useRequestAssignmentHistory(requestId: string | null, before: string | null, refreshKey = '', initialEntries?: AssignmentHistoryEntry[]): HistoryState {
  const [result, setResult] = useState<{ key: string; entries: AssignmentHistoryEntry[]; error?: string } | null>(null);
  const key = `${requestId}:${before}:${refreshKey}`;
  useEffect(() => {
    if (initialEntries !== undefined || !requestId || !before) return;
    const controller = new AbortController();
    void fetch(`/api/requests/${requestId}/history?before=${encodeURIComponent(before)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Verlauf konnte nicht geladen werden.');
        setResult({ key, entries: body.entries });
      }).catch(cause => { if (!controller.signal.aborted) setResult({ key, entries: [], error: cause instanceof Error ? cause.message : 'Verlauf konnte nicht geladen werden.' }); });
    return () => controller.abort();
  }, [requestId, before, key, initialEntries]);
  if (initialEntries !== undefined) return { entries: initialEntries };
  return result?.key === key ? result : null;
}

export function RequestAssignmentHistory({ requestId, before, initialEntries, className, history }: {
  requestId: string; before: string; initialEntries?: AssignmentHistoryEntry[]; className?: string | null;
  /** Already loaded history (e.g. shared with the candidate list). */
  history?: HistoryState;
}) {
  const own = useRequestAssignmentHistory(history !== undefined ? null : requestId, before, '', initialEntries);
  const loaded = history !== undefined ? history : own;
  if (!loaded) return <p role="status" className="text-xs text-muted-foreground">Bisherige Einsätze werden geladen …</p>;
  if (loaded.error) return <p role="status" className="text-xs text-muted-foreground">{loaded.error}</p>;
  if (!loaded.entries.length) return <p className="text-xs text-muted-foreground">Bisher keine vorherigen Einsätze für diesen Bedarf oder dieselbe Klasse im Schuljahr erfasst.</p>;
  const people = previousTeachersFromHistory(loaded.entries);
  // The people who already know the class are the headline; individual days stay one click away.
  return <section aria-label="Bisher eingeteilte Lehrkräfte" className="rounded-lg border border-primary/30 bg-primary/5 p-3">
    <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
      <History className="size-3.5" aria-hidden="true" />
      {className ? `Zuletzt in Klasse ${className}` : 'Zuletzt bei diesem Bedarf'}
    </p>
    <ul className="mt-2 space-y-1.5">
      {people.slice(0, 3).map(person => <li key={person.teacherId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <strong className="text-sm font-semibold text-foreground">{person.teacherName}</strong>
        <span className="text-xs text-muted-foreground">
          {person.days} {person.days === 1 ? 'Tag' : 'Tage'} · zuletzt {shortHistoryDay(person.lastDate)}{person.onlyOtherRequests ? ' · anderer Bedarf' : ''}
        </span>
      </li>)}
    </ul>
    {people.length > 3 && <p className="mt-1 text-xs text-muted-foreground">und {people.length - 3} weitere</p>}
    <details className="mt-2 text-xs">
      <summary className="min-h-9 cursor-pointer py-1.5 font-medium text-primary">Alle Einsätze ansehen ({loaded.entries.length})</summary>
      <div className="max-h-72 overflow-y-auto border-t border-primary/20 py-2">
        <p className="mb-2 text-muted-foreground">Eingetragene Einsätze vor dem {new Date(`${before}T12:00:00Z`).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })} im selben Schuljahr.</p>
        <ol className="space-y-2">{loaded.entries.map(entry => <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span><time dateTime={entry.date}>{shortHistoryDay(entry.date)}</time> · <strong className="font-medium">{entry.teacherName}</strong>{!entry.sameRequest && <span className="text-muted-foreground"> · gleiche Klasse, anderer Bedarf</span>}</span>
          <span className="text-muted-foreground">{entry.hours} UStd. · {entry.status === 'ACCEPTED' ? 'Bestätigt' : 'Bestätigung offen'}</span>
        </li>)}</ol>
      </div>
    </details>
  </section>;
}
