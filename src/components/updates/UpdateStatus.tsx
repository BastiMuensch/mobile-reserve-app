"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, PackageOpen, RefreshCw, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const UPDATE_COMMAND = "cd /opt/mobile-reserve && sudo docker compose pull && sudo docker compose up -d";
const UPDATE_STATUS_EVENT = "mobile-reserve:update-status";
const AUTOMATIC_STATUS_REFRESH_MS = 60 * 60 * 1_000;

interface UpdateStatusData {
  enabled: boolean;
  currentVersion: string;
  currentCommit: string | null;
  updateAvailable: boolean | null;
  latestVersion: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  releaseUrl: string | null;
  publishedAt: string | null;
  checkedAt: string | null;
  lastSuccessfulCheckAt: string | null;
  checkFailed: boolean;
  noRelease: boolean;
  dismissed: boolean;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

function broadcastUpdateStatus(status: UpdateStatusData) {
  window.dispatchEvent(new CustomEvent<UpdateStatusData>(UPDATE_STATUS_EVENT, { detail: status }));
}

function useUpdateStatus() {
  const [status, setStatus] = useState<UpdateStatusData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async (forceRefresh = false) => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const response = await fetch(`/api/update-status${forceRefresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Update status request failed");
      const nextStatus = await response.json() as UpdateStatusData;
      setStatus(nextStatus);
      broadcastUpdateStatus(nextStatus);
    } catch {
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refreshInterval = window.setInterval(() => void load(), AUTOMATIC_STATUS_REFRESH_MS);
    return () => window.clearInterval(refreshInterval);
  }, [load]);

  useEffect(() => {
    const handleStatusChange = (event: Event) => {
      const nextStatus = (event as CustomEvent<UpdateStatusData>).detail;
      if (!nextStatus) return;
      setStatus(nextStatus);
      setLoadError(false);
    };

    window.addEventListener(UPDATE_STATUS_EVENT, handleStatusChange);
    return () => window.removeEventListener(UPDATE_STATUS_EVENT, handleStatusChange);
  }, []);

  return { status, setStatus, isLoading, loadError, load };
}

export function UpdateAvailableBanner({ detailsHref }: { detailsHref: string }) {
  const { toast } = useToast();
  const { status, setStatus, isLoading, loadError } = useUpdateStatus();
  const [isDismissing, setIsDismissing] = useState(false);

  if ((!status && (isLoading || loadError)) || !status?.enabled || !status.updateAvailable || !status.latestVersion || status.dismissed) return null;

  const dismiss = async () => {
    setIsDismissing(true);
    try {
      const response = await fetch("/api/update-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: status.latestVersion }),
      });
      if (!response.ok) throw new Error();
      const nextStatus = { ...status, dismissed: true };
      setStatus(nextStatus);
      broadcastUpdateStatus(nextStatus);
    } catch {
      toast({ variant: "error", title: "Der Updatehinweis konnte nicht ausgeblendet werden." });
    } finally {
      setIsDismissing(false);
    }
  };

  return (
    <section aria-labelledby="available-update-title" className="rounded-2xl border border-sky-300 bg-sky-50 p-4 text-sky-950 shadow-sm dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-100">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 id="available-update-title" className="flex min-w-0 items-center gap-2 break-words font-bold">
            <PackageOpen className="h-5 w-5 shrink-0" /> <span className="min-w-0 break-all">Neue Version {status.latestVersion} verfügbar</span>
          </h2>
          <p className="mt-1 break-all text-sm text-sky-800 dark:text-sky-200">
            {status.releaseName || "Eine neue Version von MobileReserve.digital kann durch die Serverbetreuung eingespielt werden."}
          </p>
          {(status.checkFailed || loadError) && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Die letzte Online-Prüfung ist fehlgeschlagen; angezeigt wird der zuletzt erfolgreich ermittelte Stand.</p>}
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Link href={detailsHref} className={cn(buttonVariants({ variant: "outline" }), "border-sky-300 bg-white/70 dark:border-sky-700 dark:bg-sky-950/60")}>Änderungen ansehen</Link>
          <Button type="button" variant="ghost" disabled={isDismissing} onClick={() => void dismiss()} aria-label={`Hinweis für Version ${status.latestVersion} ausblenden`}>
            <X /> {isDismissing ? "Wird ausgeblendet …" : "Ausblenden"}
          </Button>
        </div>
      </div>
    </section>
  );
}

export function UpdateStatusCard() {
  const { toast } = useToast();
  const { status, isLoading, loadError, load } = useUpdateStatus();
  const [isCopied, setIsCopied] = useState(false);

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(UPDATE_COMMAND);
      setIsCopied(true);
      toast({ variant: "success", title: "Update-Befehl wurde kopiert." });
      window.setTimeout(() => setIsCopied(false), 2_000);
    } catch {
      toast({ variant: "error", title: "Befehl konnte nicht automatisch kopiert werden.", description: "Bitte markieren und manuell kopieren." });
    }
  };

  const publishedAt = formatDate(status?.publishedAt || null);
  const checkedAt = formatDate(status?.checkedAt || null);
  const statusAnnouncement = isLoading
    ? "Update-Stand wird geprüft."
    : loadError
      ? "Die Update-Prüfung ist derzeit nicht erreichbar."
      : status?.checkFailed
        ? "Die letzte Update-Prüfung ist fehlgeschlagen."
        : status?.updateAvailable && status.latestVersion
          ? `Neue Version ${status.latestVersion} verfügbar.`
          : status?.enabled === false
            ? "Die automatische Update-Prüfung ist deaktiviert."
            : "Update-Prüfung abgeschlossen.";

  return (
    <Card id="updates" className="scroll-mt-24 border-border/70 bg-white py-5 dark:bg-card">
      <CardHeader className="px-5 sm:px-6">
        <CardTitle><h2 className="flex items-center gap-2 text-xl"><PackageOpen className="h-6 w-6 text-primary" /> Software-Updates</h2></CardTitle>
        <CardDescription>Die App informiert über freigegebene Versionen. Installiert wird ausschließlich durch die Serverbetreuung.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 px-5 sm:px-6" aria-busy={isLoading}>
        <p className="sr-only" aria-live="polite">{statusAnnouncement}</p>
        {isLoading && !status && <p className="text-sm text-muted-foreground">Update-Stand wird geprüft …</p>}

        {loadError && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            Die Prüfung ist derzeit nicht erreichbar. {status ? "Der bisherige Stand bleibt sichtbar." : "Die Anwendung läuft unverändert weiter."}
          </div>
        )}

        {status && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0 rounded-xl border bg-muted/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Installiert</p>
                <p className="mt-1 break-all text-lg font-bold">Version {status.currentVersion}</p>
                {status.currentCommit && <p className="break-all text-xs text-muted-foreground">Commit {status.currentCommit}</p>}
              </div>
              <div className="min-w-0 rounded-xl border bg-muted/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{status.enabled ? "Veröffentlicht" : "Online-Prüfung"}</p>
                <p className="mt-1 break-all text-lg font-bold">{!status.enabled ? "Deaktiviert" : status.latestVersion ? `Version ${status.latestVersion}` : "Noch keine Version"}</p>
                {publishedAt && <p className="text-xs text-muted-foreground">{publishedAt}</p>}
              </div>
            </div>

            {!status.enabled ? (
              <p className="rounded-lg border p-3 text-sm text-muted-foreground">Der automatische Update-Check ist auf diesem Server deaktiviert.</p>
            ) : status.checkFailed ? (
              <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Die letzte Prüfung ist fehlgeschlagen. Ein zuvor erfolgreich ermittelter Stand bleibt sichtbar; die Anwendung läuft unverändert weiter.
              </p>
            ) : status.updateAvailable ? (
              <p className="flex items-start gap-2 rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-950 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-100">
                <PackageOpen className="mt-0.5 h-4 w-4 shrink-0" /> Eine neue Version kann von der Serverbetreuung eingespielt werden.
              </p>
            ) : status.noRelease ? (
              <p className="rounded-lg border p-3 text-sm text-muted-foreground">Es wurde noch keine stabile GitHub-Version veröffentlicht.</p>
            ) : status.updateAvailable === false ? (
              <p className="flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> Die installierte Version ist aktuell.
              </p>
            ) : (
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">Die lokale Versionsnummer konnte nicht sicher verglichen werden.</p>
            )}

            {status.releaseNotes && (
              <section aria-labelledby="release-notes-title" className="space-y-2">
                <h3 id="release-notes-title" className="break-all font-semibold">Änderungen in {status.latestVersion}</h3>
                <div className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">{status.releaseNotes}</div>
              </section>
            )}

            {status.releaseUrl && (
              <a href={status.releaseUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-primary underline underline-offset-4">
                Vollständige Veröffentlichung auf GitHub <ExternalLink className="h-4 w-4" /><span className="sr-only"> (öffnet einen neuen Tab)</span>
              </a>
            )}

            {status.updateAvailable && (
              <section aria-labelledby="update-command-title" className="space-y-2">
                <h3 id="update-command-title" className="font-semibold">Update durch die Serverbetreuung</h3>
                <p className="text-sm text-muted-foreground">Auf dem Server im Terminal ausführen. Die Web-App führt diesen Befehl niemals selbst aus.</p>
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                  <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-50"><code>{UPDATE_COMMAND}</code></pre>
                  <Button type="button" variant="outline" onClick={() => void copyCommand()} aria-label="Update-Befehl kopieren"><Copy /> {isCopied ? "Kopiert" : "Kopieren"}</Button>
                </div>
              </section>
            )}

            <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">{checkedAt ? `Letzte Prüfung: ${checkedAt}` : "Noch nicht online geprüft."} Das Dashboard fragt stündlich nach. Automatische Abfragen kontaktieren GitHub höchstens einmal täglich; eine manuelle Prüfung ist frühestens nach fünf Minuten erneut möglich.</p>
              <Button type="button" variant="outline" disabled={isLoading || !status.enabled} onClick={() => void load(true)}>
                <RefreshCw className={isLoading ? "animate-spin" : ""} /> {isLoading ? "Prüft …" : "Jetzt prüfen"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
