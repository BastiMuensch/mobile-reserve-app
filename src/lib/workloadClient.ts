import type { WorkloadReport } from '@/lib/workload';

export type WorkloadLoadState = { schoolYear: string; report: WorkloadReport | null; loading: boolean; error: string | null };

/** Coalesce refresh ticks: a slow response must outlive the 15-second dashboard poll. */
export function createWorkloadLoader(schoolYear: string, publish: (state: WorkloadLoadState) => void, options: {
  fetcher?: typeof fetch; timeoutMs?: number; onUnauthorized?: () => void;
} = {}) {
  let state: WorkloadLoadState = { schoolYear, report: null, loading: false, error: null };
  let inFlight: Promise<void> | null = null;
  let controller: AbortController | null = null;
  let disposed = false;
  const update = (patch: Partial<WorkloadLoadState>) => {
    if (!disposed) { state = { ...state, ...patch }; publish(state); }
  };
  return {
    refresh(): Promise<void> {
      if (disposed) return Promise.resolve();
      if (inFlight) return inFlight;
      controller = new AbortController();
      const signal = controller.signal;
      const timeout = setTimeout(() => controller?.abort('timeout'), options.timeoutMs ?? 20_000);
      update({ loading: true, error: null });
      inFlight = Promise.resolve().then(async () => {
        try {
          const response = await (options.fetcher ?? fetch)(`/api/schulamt/workload?year=${encodeURIComponent(schoolYear)}`, { cache: 'no-store', signal });
          if (response.status === 401) { options.onUnauthorized?.(); throw new Error('Bitte erneut anmelden.'); }
          if (!response.ok) throw new Error('Die Stundenübersicht konnte nicht geladen werden.');
          const report: WorkloadReport = await response.json();
          if (report.schoolYear !== schoolYear || !Array.isArray(report.teachers)) throw new Error('Unvollständige Stundenübersicht.');
          if (!signal.aborted) update({ report, loading: false, error: null });
        } catch {
          if (!signal.aborted || signal.reason === 'timeout') update({ loading: false, error: signal.reason === 'timeout'
            ? 'Das Laden der Stundenübersicht dauert zu lange. Bitte erneut versuchen.'
            : 'Die Stundenübersicht konnte nicht aktualisiert werden. Bitte erneut versuchen.' });
        } finally {
          clearTimeout(timeout);
          inFlight = null;
        }
      });
      return inFlight;
    },
    dispose() { disposed = true; controller?.abort(); },
  };
}
