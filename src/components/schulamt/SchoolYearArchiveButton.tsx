"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Copy, Download, FolderArchive, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type PreparedArchive = { filename: string; url: string };
type ArchiveSummary = {
  schoolYear: string;
  createdAt: string;
  requestCount: number;
  assignmentCount: number;
  proofCount: number;
  reportCount: number;
  warnings: string[];
};

function parseArchiveSummary(value: string | null): ArchiveSummary | null {
  if (!value) return null;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - base64.length % 4) % 4), "=");
    const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object") return null;
    const summary = parsed as Record<string, unknown>;
    const numberFields = ["requestCount", "assignmentCount", "proofCount", "reportCount"];
    if (typeof summary.schoolYear !== "string" || summary.schoolYear.length > 20 ||
      typeof summary.createdAt !== "string" || Number.isNaN(Date.parse(summary.createdAt)) ||
      numberFields.some(field => typeof summary[field] !== "number" || !Number.isSafeInteger(summary[field]) || summary[field] < 0 || summary[field] > 10_000_000) ||
      !Array.isArray(summary.warnings) || summary.warnings.length > 25 ||
      !summary.warnings.every(warning => typeof warning === "string" && warning.length <= 500)) return null;
    return summary as ArchiveSummary;
  } catch {
    return null;
  }
}

/**
 * Creates a portable, encrypted snapshot for one school year.  This intentionally
 * only downloads the archive; completing a school-year transition remains a
 * separate action elsewhere in the application.
 */
export function SchoolYearArchiveButton({ selectedYear }: { selectedYear: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [activeYear, setActiveYear] = useState(selectedYear);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [archivePassword, setArchivePassword] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [ready, setReady] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<ArchiveSummary | null>(null);
  const archive = useRef<PreparedArchive | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => {
    controller.current?.abort();
    if (archive.current) URL.revokeObjectURL(archive.current.url);
  }, []);

  function reset() {
    controller.current = null;
    if (archive.current) URL.revokeObjectURL(archive.current.url);
    archive.current = null;
    setPassword("");
    setArchivePassword("");
    setPasswordSaved(false);
    setReady(false);
    setDownloaded(false);
    setCopied(false);
    setError("");
    setSummary(null);
  }

  function changeOpen(next: boolean) {
    if (busy) return;
    if (!next && ready && !downloaded && !window.confirm("Das Archiv wurde noch nicht heruntergeladen. Archiv und Passwort wirklich verwerfen?")) return;
    if (!next) reset();
    setOpen(next);
  }

  function openDialog() {
    setActiveYear(selectedYear);
    setOpen(true);
  }

  async function createArchive(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !password) return;

    const currentPassword = password;
    // 24 random bytes encode to exactly 32 URL-safe Base64 characters.
    const secret = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))))
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const requestController = new AbortController();
    controller.current = requestController;
    setPassword("");
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/schulamt/year-archive", {
        method: "POST",
        cache: "no-store",
        signal: requestController.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: activeYear, password: currentPassword, archivePassword: secret }),
      });
      if (!response.ok) {
        const responseError = await response.json().catch(() => null);
        throw new Error(responseError?.error || "Das Schuljahresarchiv konnte nicht erstellt werden.");
      }

      const archiveSummary = parseArchiveSummary(response.headers.get("x-archive-summary"));
      if (!archiveSummary || archiveSummary.schoolYear !== activeYear) {
        throw new Error("Die Archivzusammenfassung konnte nicht geprüft werden. Der Download wurde nicht vorbereitet.");
      }
      const blob = await response.blob();
      const filename = response.headers.get("content-disposition")?.match(/filename="?([^";]+)"?/i)?.[1] || "Archivinhalt.zip";
      archive.current = { url: URL.createObjectURL(blob), filename };
      setArchivePassword(secret);
      setSummary(archiveSummary);
      setReady(true);
    } catch (failure) {
      if (!requestController.signal.aborted) {
        setError(failure instanceof Error ? failure.message : "Das Schuljahresarchiv konnte nicht erstellt werden.");
      }
    } finally {
      setPassword("");
      if (controller.current === requestController) controller.current = null;
      setBusy(false);
    }
  }

  function download() {
    if (!passwordSaved || !archive.current) return;
    const link = document.createElement("a");
    link.href = archive.current.url;
    link.download = archive.current.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setDownloaded(true);
  }

  return <>
    <Button variant="outline" onClick={openDialog}>
      <FolderArchive className="size-4 text-primary" /> Schuljahresarchiv {selectedYear}
    </Button>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6"><LockKeyhole className="size-5 shrink-0" /> Verschlüsseltes Schuljahresarchiv</DialogTitle>
          <DialogDescription>Archiviert ausschließlich das ausgewählte Schuljahr <strong>{activeYear}</strong>. Es ist ein portables Offline-Archiv, kein Vollbackup und keine Wiederherstellungsfunktion.</DialogDescription>
        </DialogHeader>

        {!ready ? <form onSubmit={createArchive} className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <p className="font-medium">Inhalt und Grenzen</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Enthalten sind nur die für {activeYear} noch gespeicherten Daten und Nachweise.</li>
              <li>Berichte enthalten den zuletzt gespeicherten, geprüften Stand – nicht die ursprünglich versendeten Fassungen.</li>
              <li>PDFs werden mit dem aktuellen Profil neu erzeugt.</li>
              <li>Bereits aus der App gelöschte Daten können im Paket nicht nachträglich ergänzt werden.</li>
            </ul>
          </div>
          <p className="text-sm text-muted-foreground">Das Archiv verändert keine Daten, schließt keinen Schuljahreswechsel ab und ersetzt nicht das verschlüsselte Vollbackup.</p>
          <div className="space-y-2">
            <label htmlFor={`${id}-password`} className="font-medium">Aktuelles Anmeldepasswort bestätigen</label>
            <Input id={`${id}-password`} type="password" autoComplete="current-password" value={password} required maxLength={200} disabled={busy} onChange={event => setPassword(event.target.value)} />
          </div>
          {busy && <p role="status" className="text-sm text-muted-foreground">Archiv wird erstellt und verschlüsselt. Bitte warten …</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy || !password}>{busy ? "Archiv wird erstellt …" : `Identität bestätigen und ${activeYear} archivieren`}</Button>
        </form> : <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor={`${id}-archive-password`} className="font-medium">Passwort für dieses Archiv</label>
            <textarea id={`${id}-archive-password`} readOnly rows={2} value={archivePassword} autoComplete="off" spellCheck={false} className="w-full resize-none rounded-md border border-input bg-muted/40 px-3 py-2 font-mono text-sm break-all focus-visible:outline-2 focus-visible:outline-ring" />
            <Button type="button" variant="outline" onClick={async () => {
              try { await navigator.clipboard.writeText(archivePassword); setCopied(true); setError(""); }
              catch { setError("Bitte das Passwort im Feld markieren und manuell kopieren."); }
            }}><Copy className="size-4" /> {copied ? "Passwort kopiert" : "Passwort kopieren"}</Button>
          </div>
          {summary && <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <p className="font-medium">Archivinhalt für {summary.schoolYear}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
              <div className="flex justify-between gap-2"><dt>Bedarfe</dt><dd>{summary.requestCount}</dd></div>
              <div className="flex justify-between gap-2"><dt>Einsätze</dt><dd>{summary.assignmentCount}</dd></div>
              <div className="flex justify-between gap-2"><dt>Nachweise</dt><dd>{summary.proofCount}</dd></div>
              <div className="flex justify-between gap-2"><dt>Berichte</dt><dd>{summary.reportCount}</dd></div>
            </dl>
            {summary.warnings.length > 0 && <div className="mt-3 border-t border-border pt-3 text-muted-foreground">
              <p className="font-medium text-foreground">Hinweise zur Verfügbarkeit</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">{summary.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>
            </div>}
          </div>}
          <p className="text-sm text-muted-foreground">Das Passwort wird nicht gespeichert. Bewahren Sie es getrennt von der Datei auf; ohne dieses Passwort lässt sich das Archiv nicht öffnen.</p>
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            Die heruntergeladene ZIP-Datei ist AES-verschlüsselt. Öffnen Sie sie mit einer AES-kompatiblen Archiv-App (z. B. 7-Zip, Keka oder WinZip); die Windows-Bordmittel unterstützen AES-ZIP möglicherweise nicht. Nach dem Entschlüsseln enthält sie eine weitere, normale ZIP-Datei mit den Unterlagen.
          </div>
          <label htmlFor={`${id}-saved`} className="flex items-start gap-3 text-sm"><input id={`${id}-saved`} type="checkbox" checked={passwordSaved} onChange={event => setPasswordSaved(event.target.checked)} className="mt-1 size-4 shrink-0" />Ich habe das Archivpasswort sicher und getrennt von der Datei aufbewahrt.</label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="button" onClick={download} disabled={!passwordSaved} className="w-full"><Download className="size-4" />{downloaded ? "Verschlüsseltes Archiv erneut herunterladen" : "Verschlüsseltes Archiv herunterladen"}</Button>
          {downloaded && <p role="status" className="text-sm text-muted-foreground">Download gestartet. Prüfen Sie, ob die Datei in Ihrem Download-Ordner gespeichert wurde.</p>}
          <Button type="button" variant="outline" onClick={() => changeOpen(false)} className="w-full">Schließen</Button>
        </div>}
      </DialogContent>
    </Dialog>
  </>;
}
