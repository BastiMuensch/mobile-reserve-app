"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { emptyPublicInstanceSettings, type PublicInstanceSettings } from "@/lib/publicInstanceSettings";
import { useToast } from "@/components/ui/toast";

export function InstanceSettings({ profileLogoUrl, onDirtyChange }: { profileLogoUrl: string; onDirtyChange?: (dirty: boolean) => void }) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<PublicInstanceSettings>(emptyPublicInstanceSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const snapshot = useMemo(() => JSON.stringify(settings), [settings]);
  const isDirty = !loading && Boolean(savedSnapshot) && snapshot !== savedSnapshot;
  const missingPublicFields = [
    !settings.publicInstanceName.trim() && "Instanzname",
    !settings.publicSupportContact.trim() && "Hilfe & Kontakt",
    !settings.impressum.trim() && "Impressum",
    !settings.privacyPolicy.trim() && "Datenschutzerklärung",
  ].filter(Boolean) as string[];

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    fetch("/api/settings", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Die öffentlichen Einstellungen konnten nicht geladen werden.");
        return response.json();
      })
      .then((data) => {
        const next = { ...emptyPublicInstanceSettings, ...data };
        if (!controller.signal.aborted) {
          setSettings(next);
          setSavedSnapshot(JSON.stringify(next));
        }
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) {
          const message = error.message || "Die öffentlichen Einstellungen konnten nicht geladen werden.";
          setLoadError(message);
          toast({ variant: "error", title: message });
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [loadAttempt, toast]);

  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);

  const update = <K extends keyof PublicInstanceSettings>(key: K, value: PublicInstanceSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Die öffentlichen Einstellungen konnten nicht gespeichert werden.");
      setSavedSnapshot(snapshot);
      toast({ title: "Öffentliche Einstellungen gespeichert." });
    } catch (error) {
      toast({ variant: "error", title: error instanceof Error ? error.message : "Die öffentlichen Einstellungen konnten nicht gespeichert werden." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card id="public-instance" className="scroll-mt-24 border-emerald-950/10 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">Öffentlicher Auftritt <span className={`text-xs font-medium ${loadError || isDirty ? "text-amber-700" : "text-emerald-700"}`}>{loadError ? "Laden fehlgeschlagen" : isDirty ? "Nicht gespeichert" : "Gespeichert"}</span></CardTitle>
        <CardDescription>Diese Angaben erscheinen vor der Anmeldung. Zugangsdaten und interne Profilangaben bleiben davon getrennt.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div> : loadError ? <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4" role="alert"><p className="text-sm text-destructive">{loadError}</p><Button type="button" variant="outline" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Erneut laden</Button></div> : <>
          {missingPublicFields.length > 0 && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="status">Für einen vollständigen öffentlichen Auftritt fehlen noch: {missingPublicFields.join(", ")}.</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="instance-name">Name der Instanz</Label><Input id="instance-name" value={settings.publicInstanceName} onChange={(event) => update("publicInstanceName", event.target.value)} required /></div>
            <div className="space-y-2"><Label htmlFor="instance-support">Hilfe & Kontakt</Label><Input id="instance-support" value={settings.publicSupportContact} onChange={(event) => update("publicSupportContact", event.target.value)} placeholder="Telefon, E-Mail oder Ansprechperson" /></div>
          </div>
          <div className="space-y-2">
            <Label>Login-Logo</Label>
            <p className="text-xs text-muted-foreground">Es kann nur das eigene, bereits hochgeladene Dokumentenlogo verwendet werden.</p>
            {profileLogoUrl ? <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              <Image src={profileLogoUrl} alt="Aktuelles Dokumentenlogo" width={120} height={60} className="h-12 w-24 object-contain" unoptimized />
              <Button type="button" variant="outline" onClick={() => update("loginLogoUrl", settings.loginLogoUrl === profileLogoUrl ? "" : profileLogoUrl)}>
                {settings.loginLogoUrl === profileLogoUrl ? "Nicht auf Login zeigen" : "Dokumentenlogo auf Login zeigen"}
              </Button>
            </div> : <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Laden Sie zuerst im Schulamtsprofil ein Dokumentenlogo hoch.</p>}
            {settings.loginLogoUrl && <div className="space-y-2"><Label htmlFor="instance-logo-alt">Alternativtext für das Login-Logo</Label><Input id="instance-logo-alt" value={settings.loginLogoAlt} onChange={(event) => update("loginLogoAlt", event.target.value)} placeholder="Logo des Staatlichen Schulamts" /></div>}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="instance-impressum">Impressum</Label><Textarea id="instance-impressum" rows={8} value={settings.impressum} onChange={(event) => update("impressum", event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="instance-privacy">Datenschutzerklärung</Label><Textarea id="instance-privacy" rows={8} value={settings.privacyPolicy} onChange={(event) => update("privacyPolicy", event.target.value)} /></div>
          </div>
          <details className="rounded-lg border bg-muted/20 p-3">
            <summary className="cursor-pointer font-medium">Öffentliche Vorschau</summary>
            <div className="mt-3 space-y-3 text-sm">
              <p className="font-semibold">{settings.publicInstanceName || "Name der Instanz"}</p>
              {settings.publicSupportContact && <p>Hilfe &amp; Kontakt: {settings.publicSupportContact}</p>}
              <div><p className="font-medium">Impressum</p><p className="whitespace-pre-wrap text-muted-foreground">{settings.impressum || "Noch nicht hinterlegt."}</p></div>
              <div><p className="font-medium">Datenschutz</p><p className="whitespace-pre-wrap text-muted-foreground">{settings.privacyPolicy || "Noch nicht hinterlegt."}</p></div>
            </div>
          </details>
        </>}
      </CardContent>
      <CardFooter className="justify-end"><Button type="button" disabled={loading || Boolean(loadError) || saving} onClick={save}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Speichern</Button></CardFooter>
    </Card>
  );
}
