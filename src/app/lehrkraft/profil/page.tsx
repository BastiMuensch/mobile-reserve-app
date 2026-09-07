"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { PostalCodeLocationPicker } from "@/components/teacher/PostalCodeLocationPicker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";

type ProfileForm = { address: string; postalCode: string; homeLat: number | null; homeLng: number | null; phone: string };
const emptyProfile: ProfileForm = { address: "", postalCode: "", homeLat: null, homeLng: null, phone: "" };

export default function LehrkraftProfilPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [profile, setProfile] = useState<ProfileForm>(emptyProfile);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const profileSnapshot = useMemo(() => JSON.stringify(profile), [profile]);
  const isDirty = Boolean(savedSnapshot) && savedSnapshot !== profileSnapshot;
  const confirmDiscard = useUnsavedChanges(isDirty);
  const userId = user?.id;
  const teacherRole = user?.role;

  useEffect(() => {
    if (!isLoading && (!user || user.role !== "TEACHER")) router.replace("/");
  }, [isLoading, router, user]);

  const loadProfile = useCallback(async (signal: AbortSignal) => {
    if (teacherRole !== "TEACHER" || !userId) return;
    setLoadingProfile(true);
    setLoadError("");
    try {
      const response = await fetch("/api/teacher/profile", { cache: "no-store", signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Das Profil konnte nicht geladen werden.");
      if (signal.aborted) return;
      const next = { address: data.address || "", postalCode: data.postalCode || "", homeLat: data.homeLat ?? null, homeLng: data.homeLng ?? null, phone: data.phone || "" };
      setProfile(next);
      setSavedSnapshot(JSON.stringify(next));
    } catch (error) {
      if (signal.aborted) return;
      const message = error instanceof Error ? error.message : "Das Profil konnte nicht geladen werden.";
      setLoadError(message);
      toast({ variant: "error", title: message });
    } finally {
      if (!signal.aborted) setLoadingProfile(false);
    }
  }, [teacherRole, toast, userId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadProfile(controller.signal);
    return () => controller.abort();
  }, [loadAttempt, loadProfile]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (profile.homeLat === null || profile.homeLng === null) {
      toast({ variant: "error", title: "Bitte bestätigen Sie Ihre Heimposition auf der Karte." });
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/teacher/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Das Profil konnte nicht gespeichert werden.");
      setSavedSnapshot(profileSnapshot);
      toast({ variant: "success", title: "Kontakt- und Standortdaten gespeichert." });
    } catch (error) {
      toast({ variant: "error", title: error instanceof Error ? error.message : "Das Profil konnte nicht gespeichert werden." });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || !user || user.role !== "TEACHER" || loadingProfile) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  if (loadError) return <div className="mx-auto w-full max-w-xl space-y-4 rounded-xl border bg-card p-6 text-center"><p role="alert" className="text-sm text-destructive">{loadError}</p><Button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Erneut laden</Button></div>;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 animate-in fade-in slide-in-from-bottom-3 duration-300">
      <Button type="button" variant="ghost" className="w-fit" onClick={() => { if (confirmDiscard()) router.push("/"); }}><ArrowLeft className="mr-2 h-4 w-4" />Zum Einsatzplan</Button>
      <Card>
        <CardHeader><CardTitle>Mein Profil</CardTitle><CardDescription>Aktualisieren Sie nur Ihre Kontakt- und Standortdaten. Die vollständige Anschrift bleibt intern; für die Standortsuche wird ausschließlich die Postleitzahl verwendet.</CardDescription></CardHeader>
        <CardContent>
          <form className="space-y-6" onSubmit={save}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="teacher-address">Vollständige postalische Anschrift</Label><Input id="teacher-address" autoComplete="street-address" value={profile.address} onChange={(event) => setProfile((current) => ({ ...current, address: event.target.value }))} required /></div>
              <div className="space-y-2"><Label htmlFor="teacher-postal-code">Postleitzahl</Label><Input id="teacher-postal-code" inputMode="numeric" autoComplete="postal-code" maxLength={5} value={profile.postalCode} onChange={(event) => setProfile((current) => ({ ...current, postalCode: event.target.value.replace(/\D/g, "").slice(0, 5) }))} required /></div>
              <div className="space-y-2"><Label htmlFor="teacher-phone">Telefon (optional)</Label><Input id="teacher-phone" type="tel" autoComplete="tel" value={profile.phone} onChange={(event) => setProfile((current) => ({ ...current, phone: event.target.value }))} /></div>
            </div>
            <PostalCodeLocationPicker postalCode={profile.postalCode} latitude={profile.homeLat} longitude={profile.homeLng} onChange={(homeLat, homeLng) => setProfile((current) => ({ ...current, homeLat, homeLng }))} />
            <div className="flex justify-end"><Button type="submit" disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Speichern</Button></div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
