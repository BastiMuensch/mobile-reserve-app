"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { ArrowLeft, ArrowRight, FileText, Mail, Plus, School, Trash2, Upload } from "lucide-react";
import { BAYTGV_LEGAL_TEXT } from "@/lib/onboarding";

type InitialSchool = {
  name: string;
  address: string;
  type: "GRUNDSCHULE" | "MITTELSCHULE";
  email: string;
  password: string;
  isSmall: boolean;
};

const emptySchool = (): InitialSchool => ({
  name: "", address: "", type: "GRUNDSCHULE", email: "", password: "", isSmall: false,
});

const initialState = {
  name: "",
  email: "",
  password: "",
  profile: {
    headerText: "",
    returnAddress: "",
    contactAddress: "",
    contactPerson: "",
    city: "",
    amtsleitungName: "",
    amtsleitungTitle: "",
    logoUrl: "",
    signatureUrl: "",
    documentSubject: "Verwendung als mobile Reserve innerhalb des Schulamtsbereiches",
    documentIntro: "Zur Verwendung als mobile Reserve werden Sie wie folgt eingesetzt:",
    documentLegalText: BAYTGV_LEGAL_TEXT,
    documentClosing: "Mit freundlichen Grüßen",
    smtpEnabled: false,
    smtpHost: "",
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: "",
    smtpPass: "",
    smtpFromName: "",
    smtpFromAddress: "",
  },
  schools: [] as InitialSchool[],
};

export function SchulamtOnboardingDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [data, setData] = useState(initialState);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"logoUrl" | "signatureUrl" | null>(null);
  const steps = ["Zugang", "Dokumente", "Schulen", "Mail"];

  const setProfile = (key: keyof typeof data.profile, value: string | number | boolean) => {
    setData(current => ({ ...current, profile: { ...current.profile, [key]: value } }));
  };

  const updateSchool = (index: number, patch: Partial<InitialSchool>) => {
    setData(current => ({
      ...current,
      schools: current.schools.map((school, schoolIndex) => schoolIndex === index ? { ...school, ...patch } : school),
    }));
  };

  const upload = async (key: "logoUrl" | "signatureUrl", file: File) => {
    setUploading(key);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/upload", { method: "POST", body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Upload fehlgeschlagen.");
      setProfile(key, result.url);
    } catch (error) {
      toast({ variant: "error", title: error instanceof Error ? error.message : "Upload fehlgeschlagen." });
    } finally {
      setUploading(null);
    }
  };

  const submit = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/schulaemter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Schulamt konnte nicht eingerichtet werden.");

      toast({ variant: "success", title: "Schulamt vollständig eingerichtet." });
      setData(initialState);
      setStep(0);
      onOpenChange(false);
      onCreated();
    } catch (error) {
      toast({ variant: "error", title: "Einrichtung fehlgeschlagen.", description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Neues Schulamt einrichten</DialogTitle>
          <DialogDescription>
            Zugang, Briefvorlagen, Schulen und optionaler Mailversand werden gemeinsam angelegt.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-4 gap-2 text-xs">
          {steps.map((label, index) => (
            <button key={label} type="button" onClick={() => setStep(index)} className={`rounded-lg border p-2 ${index === step ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
              {index + 1}. {label}
            </button>
          ))}
        </div>

        {step === 0 && (
          <div className="grid gap-4 py-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="tenant-name">Bezeichnung des Schulamts</Label>
              <Input id="tenant-name" value={data.name} onChange={e => setData({ ...data, name: e.target.value })} placeholder="Staatliches Schulamt …" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tenant-email">Login-E-Mail</Label>
              <Input id="tenant-email" type="email" value={data.email} onChange={e => setData({ ...data, email: e.target.value })} placeholder="schulamt@behoerde.de" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tenant-password">Initiales Passwort</Label>
              <Input id="tenant-password" type="password" minLength={12} value={data.password} onChange={e => setData({ ...data, password: e.target.value })} placeholder="Mindestens 12 Zeichen" required />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="tenant-city">Ort für Schreiben</Label>
              <Input id="tenant-city" value={data.profile.city} onChange={e => setProfile("city", e.target.value)} placeholder="Ort" required />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2 font-semibold"><FileText className="h-4 w-4" /> Briefkopf und Bestätigungen</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2"><Label>Briefkopf</Label><Input value={data.profile.headerText} onChange={e => setProfile("headerText", e.target.value)} placeholder="Vollständige Behördenbezeichnung" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Rücksendezeile</Label><Input value={data.profile.returnAddress} onChange={e => setProfile("returnAddress", e.target.value)} placeholder="Behörde · Straße Hausnummer · PLZ Ort" /></div>
              <div className="space-y-2"><Label>Kontaktanschrift</Label><Textarea rows={5} value={data.profile.contactAddress} onChange={e => setProfile("contactAddress", e.target.value)} placeholder={"Straße Hausnummer\nPLZ Ort\nTelefon"} /></div>
              <div className="space-y-2"><Label>Ansprechperson / Kontaktkanäle</Label><Textarea rows={5} value={data.profile.contactPerson} onChange={e => setProfile("contactPerson", e.target.value)} placeholder={"Name\nDurchwahl\nE-Mail"} /></div>
              <div className="space-y-2"><Label>Name der Amtsleitung</Label><Input value={data.profile.amtsleitungName} onChange={e => setProfile("amtsleitungName", e.target.value)} /></div>
              <div className="space-y-2"><Label>Titel / Funktion</Label><Input value={data.profile.amtsleitungTitle} onChange={e => setProfile("amtsleitungTitle", e.target.value)} /></div>
              <div className="space-y-2">
                <Label>Logo</Label>
                <label className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm"><Upload className="h-4 w-4" />{uploading === "logoUrl" ? "Wird hochgeladen …" : data.profile.logoUrl ? "Logo ersetzen" : "PNG/JPEG auswählen"}<input className="hidden" type="file" accept="image/png,image/jpeg" disabled={Boolean(uploading)} onChange={e => e.target.files?.[0] && upload("logoUrl", e.target.files[0])} /></label>
              </div>
              <div className="space-y-2">
                <Label>Unterschrift</Label>
                <label className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm"><Upload className="h-4 w-4" />{uploading === "signatureUrl" ? "Wird hochgeladen …" : data.profile.signatureUrl ? "Unterschrift ersetzen" : "PNG/JPEG auswählen"}<input className="hidden" type="file" accept="image/png,image/jpeg" disabled={Boolean(uploading)} onChange={e => e.target.files?.[0] && upload("signatureUrl", e.target.files[0])} /></label>
              </div>
              <div className="space-y-2 sm:col-span-2"><Label>Betreff</Label><Input value={data.profile.documentSubject} onChange={e => setProfile("documentSubject", e.target.value)} /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Einleitung</Label><Textarea value={data.profile.documentIntro} onChange={e => setProfile("documentIntro", e.target.value)} /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Rechtlicher BayTGV-Hinweis</Label><Textarea rows={7} value={BAYTGV_LEGAL_TEXT} readOnly className="bg-muted" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Schlussformel</Label><Input value={data.profile.documentClosing} onChange={e => setProfile("documentClosing", e.target.value)} /></div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between"><span className="flex items-center gap-2 font-semibold"><School className="h-4 w-4" /> Initiale Schulen</span><Button type="button" variant="outline" size="sm" onClick={() => setData(current => ({ ...current, schools: [...current.schools, emptySchool()] }))}><Plus className="mr-1 h-4 w-4" /> Schule</Button></div>
            {data.schools.length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Schulen können jetzt angelegt oder später vom Schulamt ergänzt werden.</p>}
            {data.schools.map((school, index) => (
              <div key={index} className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>Name</Label><Input value={school.name} onChange={e => updateSchool(index, { name: e.target.value })} /></div>
                <div className="space-y-2"><Label>Schulart</Label><Select value={school.type} onValueChange={value => value && updateSchool(index, { type: value as InitialSchool["type"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="GRUNDSCHULE">Grundschule</SelectItem><SelectItem value="MITTELSCHULE">Mittelschule</SelectItem></SelectContent></Select></div>
                <div className="space-y-2 sm:col-span-2"><Label>Vollständige Adresse</Label><Input value={school.address} onChange={e => updateSchool(index, { address: e.target.value })} /></div>
                <div className="space-y-2"><Label>Login-E-Mail</Label><Input type="email" value={school.email} onChange={e => updateSchool(index, { email: e.target.value })} /></div>
                <div className="space-y-2"><Label>Initiales Passwort</Label><Input type="password" minLength={12} value={school.password} onChange={e => updateSchool(index, { password: e.target.value })} /></div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={school.isSmall} onChange={e => updateSchool(index, { isSmall: e.target.checked })} /> Kleine Schule</label>
                <div className="text-right"><Button type="button" size="sm" variant="ghost" onClick={() => setData(current => ({ ...current, schools: current.schools.filter((_, i) => i !== index) }))}><Trash2 className="mr-1 h-4 w-4" /> Entfernen</Button></div>
              </div>
            ))}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 py-4">
            <label className="flex items-start gap-3 rounded-xl border p-4"><input type="checkbox" className="mt-1" checked={data.profile.smtpEnabled} onChange={e => setProfile("smtpEnabled", e.target.checked)} /><span><span className="flex items-center gap-2 font-semibold"><Mail className="h-4 w-4" /> Mailversand jetzt einrichten</span><span className="block text-xs text-muted-foreground">Kann übersprungen und später in den Schulamts-Einstellungen ergänzt werden.</span></span></label>
            {data.profile.smtpEnabled && <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>SMTP-Host</Label><Input value={data.profile.smtpHost} onChange={e => setProfile("smtpHost", e.target.value)} placeholder="smtp.behoerde.de" /></div>
              <div className="space-y-2"><Label>Port</Label><Input type="number" min={1} max={65535} value={data.profile.smtpPort} onChange={e => setProfile("smtpPort", Number(e.target.value))} /></div>
              <div className="space-y-2"><Label>Benutzer</Label><Input value={data.profile.smtpUser} onChange={e => setProfile("smtpUser", e.target.value)} /></div>
              <div className="space-y-2"><Label>Passwort</Label><Input type="password" value={data.profile.smtpPass} onChange={e => setProfile("smtpPass", e.target.value)} /></div>
              <div className="space-y-2"><Label>Absendername</Label><Input value={data.profile.smtpFromName} onChange={e => setProfile("smtpFromName", e.target.value)} /></div>
              <div className="space-y-2"><Label>Absender-E-Mail</Label><Input type="email" value={data.profile.smtpFromAddress} onChange={e => setProfile("smtpFromAddress", e.target.value)} /></div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={data.profile.smtpSecure} onChange={e => setProfile("smtpSecure", e.target.checked)} /> Direkte TLS-Verbindung (typisch Port 465; sonst STARTTLS)</label>
            </div>}
          </div>
        )}

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button type="button" variant="outline" disabled={step === 0 || saving} onClick={() => setStep(current => current - 1)}><ArrowLeft className="mr-1 h-4 w-4" /> Zurück</Button>
          {step < steps.length - 1 ? <Button type="button" onClick={() => setStep(current => current + 1)}>Weiter <ArrowRight className="ml-1 h-4 w-4" /></Button> : <Button type="button" disabled={saving || Boolean(uploading)} onClick={submit}>{saving ? "Richtet ein …" : "Schulamt einrichten"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
