import { AlertTriangle } from "lucide-react";

export function RequestUrgencyBadge({ note }: { note?: string | null }) {
  if (!note?.trim()) return null;
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      Dringlichkeitshinweis
    </span>
  );
}

export function RequestUrgencyNote({ note }: { note?: string | null }) {
  if (!note?.trim()) return null;
  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
      <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />Dringlichkeitshinweis der Schule</p>
      <p className="whitespace-pre-wrap break-words">{note}</p>
      <p className="text-xs text-amber-800 dark:text-amber-300">Nur für das Schulamt · Für Mobile Reserven nicht sichtbar</p>
    </div>
  );
}
