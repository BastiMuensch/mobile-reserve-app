"use client";

import dynamic from "next/dynamic";
import { SCHOOL_TYPES, schoolTypeLabel, type SchoolType } from "@/lib/schoolTypes";
import { useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, FileText, Loader2, Mail, MapPin, Plus, School, Trash2, Upload } from "lucide-react";
import { BAYTGV_LEGAL_TEXT } from "@/lib/onboarding";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const LocationPickerMap = dynamic(() => import("@/components/LocationPickerMap"), { ssr: false });

type GeocodingState = "IDLE" | "SEARCHING" | "RESOLVED" | "NOT_FOUND" | "UNAVAILABLE" | "MANUAL";
type InitialSchool = {
  name: string;
  address: string;
  type: SchoolType;
  email: string;
  password: string;
  isSmall: boolean;
  latitude: number | null;
  longitude: number | null;
  geocodingStatus: GeocodingState;
  geocodingMessage: string;
};

const emptySchool = (): InitialSchool => ({
  name: "",
  address: "",
  type: "GRUNDSCHULE",
  email: "",
  password: "",
  isSmall: false,
  latitude: null,
  longitude: null,
  geocodingStatus: "IDLE",
  geocodingMessage: "",
});

const initialData = {
  name: "",
  email: "",
  password: "",
  setupToken: "",
  publicSettings: {
    supportContact: "",
    impressum: "",
    privacyPolicy: "",
  },
  profile: {
    headerText: "",
    returnAddress: "",
    contactAddress: "",
    contactPerson: "",
    city: "",
    amtsleitungName: "",
    amtsleitungTitle: "",
    latitude: null as number | null,
    longitude: null as number | null,
    documentSubject: "Verwendung als mobile Reserve innerhalb des Schulamtsbereiches",
    documentIntro: "Zur Verwendung als mobile Reserve werden Sie wie folgt eingesetzt:",
    documentClosing: "Mit freundlichen Grüßen",
    mailProvider: "NONE" as "NONE" | "SMTP",
    smtpHost: "",
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: "",
    smtpPass: "",
    smtpFromName: "",
    smtpFromAddress: "",
    teacherInviteValidityDays: 14,
  },
  schools: [emptySchool()],
};

const steps = ["Zugang", "Dokumente", "Schulen", "Mail", "Prüfen"];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InitialSetupWizard({
  setupTokenRequired,
  setupBlocked,
  onCompleted,
}: {
  setupTokenRequired: boolean;
  setupBlocked: boolean;
  onCompleted: (email: string, password: string) => Promise<void>;
}) {
  // Do not render a usable setup form when production has no server-side setup
  // token. This avoids collecting credentials that the server must reject.
  if (setupBlocked) {
    return (
      <Card className="w-full border-red-200 bg-white shadow-xl">
        <CardHeader><CardTitle>Ersteinrichtung gesperrt</CardTitle><CardDescription>Diese Installation benötigt einen auf dem Server gesetzten SETUP_TOKEN, bevor Konten angelegt werden können.</CardDescription></CardHeader>
      </Card>
    );
  }
  return <InitialSetupWizardForm setupTokenRequired={setupTokenRequired} onCompleted={onCompleted} />;
}

function InitialSetupWizardForm({
  setupTokenRequired,
  onCompleted,
}: {
  setupTokenRequired: boolean;
  onCompleted: (email: string, password: string) => Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState(initialData);
  const [logo, setLogo] = useState<File | null>(null);
  const [signature, setSignature] = useState<File | null>(null);
  const [manualMapIndex, setManualMapIndex] = useState<number | null>(null);
  const [officeGeocoding, setOfficeGeocoding] = useState<GeocodingState>("IDLE");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const setProfile = <K extends keyof typeof data.profile>(key: K, value: (typeof data.profile)[K]) => {
    setData((current) => ({ ...current, profile: { ...current.profile, [key]: value } }));
  };

  const updateSchool = (index: number, patch: Partial<InitialSchool>) => {
    setData((current) => ({
      ...current,
      schools: current.schools.map((school, currentIndex) => currentIndex === index ? { ...school, ...patch } : school),
    }));
  };

  const validateStep = (targetStep: number): string | null => {
    if (targetStep === 0) {
      if (setupTokenRequired && !data.setupToken.trim()) return "Der Einrichtungsschlüssel ist erforderlich.";
      if (!data.name.trim()) return "Bitte geben Sie die Bezeichnung des Schulamts ein.";
      if (!emailPattern.test(data.email.trim())) return "Bitte geben Sie eine gültige Login-E-Mail ein.";
      if (data.password.length < 12) return "Das Schulamts-Passwort muss mindestens 12 Zeichen lang sein.";
      if (!data.profile.city.trim()) return "Bitte geben Sie den Ort des Schulamts ein.";
    }
    if (targetStep === 1) {
      const required = [data.profile.headerText, data.profile.returnAddress, data.profile.contactAddress, data.profile.contactPerson, data.profile.amtsleitungName, data.profile.amtsleitungTitle, data.profile.documentSubject, data.profile.documentIntro, data.profile.documentClosing];
      if (required.some((value) => !value.trim())) return "Bitte füllen Sie alle Pflichtangaben für das Schreiben aus.";
    }
    if (targetStep === 2) {
      if (data.schools.length === 0) return "Mindestens eine Schule ist erforderlich.";
      for (const school of data.schools) {
        if (!school.name.trim() || !school.address.trim() || !emailPattern.test(school.email.trim())) return "Bitte füllen Sie Name, vollständige Adresse und Login-E-Mail jeder Schule aus.";
        if (school.password.length < 12) return `Das Passwort für „${school.name || "eine Schule"}“ muss mindestens 12 Zeichen lang sein.`;
      }
      const emails = [data.email, ...data.schools.map((school) => school.email)].map((email) => email.trim().toLowerCase());
      if (new Set(emails).size !== emails.length) return "Alle Login-E-Mail-Adressen müssen eindeutig sein.";
    }
    if (targetStep === 3) {
      if (!Number.isInteger(data.profile.teacherInviteValidityDays) || data.profile.teacherInviteValidityDays < 1 || data.profile.teacherInviteValidityDays > 90) {
        return "Die Gültigkeit von Einladungen muss eine ganze Zahl zwischen 1 und 90 Tagen sein.";
      }
      if (data.profile.mailProvider === "SMTP") {
        if (!data.profile.smtpHost.trim() || !data.profile.smtpUser.trim() || !data.profile.smtpPass.trim() || !data.profile.smtpFromName.trim() || !data.profile.smtpFromAddress.trim()) {
          return "Bitte vervollständigen Sie die SMTP-Konfiguration oder wählen Sie „Später einrichten“.";
        }
        if (!Number.isInteger(data.profile.smtpPort) || data.profile.smtpPort < 1 || data.profile.smtpPort > 65535) {
          return "Der SMTP-Port muss eine ganze Zahl zwischen 1 und 65535 sein.";
        }
        if (!emailPattern.test(data.profile.smtpFromAddress.trim())) {
          return "Bitte geben Sie eine gültige Absender-E-Mail-Adresse ein.";
        }
      }
    }
    return null;
  };

  const geocode = async (address: string) => {
    const response = await fetch("/api/setup/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Setup-Token": data.setupToken },
      body: JSON.stringify({ address, setupToken: data.setupToken }),
    });
    const result = await response.json();
    return { response, result };
  };

  const geocodeSchool = async (index: number) => {
    const school = data.schools[index];
    if (!school.address.trim()) return;
    updateSchool(index, { geocodingStatus: "SEARCHING", geocodingMessage: "Standort wird gesucht …" });
    try {
      const { response, result } = await geocode(school.address);
      if (response.ok) {
        updateSchool(index, { latitude: result.latitude, longitude: result.longitude, geocodingStatus: "RESOLVED", geocodingMessage: "Standort wurde gefunden." });
      } else {
        const status: GeocodingState = result.status === "NOT_FOUND" ? "NOT_FOUND" : "UNAVAILABLE";
        updateSchool(index, { latitude: null, longitude: null, geocodingStatus: status, geocodingMessage: result.error || "Standort konnte noch nicht ermittelt werden." });
      }
    } catch {
      updateSchool(index, { latitude: null, longitude: null, geocodingStatus: "UNAVAILABLE", geocodingMessage: "Standortdienst derzeit nicht erreichbar. Die Ermittlung wird später nachgeholt." });
    }
  };

  const geocodeOffice = async () => {
    if (!data.profile.contactAddress.trim()) return;
    setOfficeGeocoding("SEARCHING");
    try {
      const { response, result } = await geocode(`${data.profile.contactAddress.replace(/\n/g, " ")}, ${data.profile.city}`);
      if (response.ok) {
        setProfile("latitude", result.latitude);
        setProfile("longitude", result.longitude);
        setOfficeGeocoding("RESOLVED");
      } else {
        setOfficeGeocoding(result.status === "NOT_FOUND" ? "NOT_FOUND" : "UNAVAILABLE");
      }
    } catch {
      setOfficeGeocoding("UNAVAILABLE");
    }
  };

  const goForward = async () => {
    const validationError = validateStep(step);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    if (step === 1 && data.profile.latitude == null) void geocodeOffice();
    if (step === 2) {
      // Den externen Geokodierungsdienst beim Massenupload nicht mit dutzenden
      // parallelen Anfragen überlasten. Weitere Standorte bleiben sichtbar ausstehend
      // und werden in der Schulverwaltung nacheinander nachgeholt.
      const unresolvedIndexes = data.schools
        .map((school, index) => school.latitude == null ? index : -1)
        .filter((index) => index >= 0)
        .slice(0, 5);
      for (const index of unresolvedIndexes) await geocodeSchool(index);
    }
    setStep((current) => Math.min(current + 1, steps.length - 1));
  };

  const buildPayload = () => ({
    ...data,
    profile: { ...data.profile, documentLegalText: BAYTGV_LEGAL_TEXT },
    schools: data.schools.map(({ geocodingMessage, ...school }) => {
      void geocodingMessage;
      return {
        ...school,
        geocodingStatus: school.geocodingStatus === "IDLE" || school.geocodingStatus === "SEARCHING" ? "PENDING" : school.geocodingStatus,
      };
    }),
  });

  const buildFormData = () => {
    const formData = new FormData();
    formData.append("payload", JSON.stringify(buildPayload()));
    if (logo) formData.append("logo", logo);
    if (signature) formData.append("signature", signature);
    return formData;
  };

  const preview = async () => {
    setPreviewing(true);
    setError("");
    try {
      const response = await fetch("/api/setup/preview", { method: "POST", headers: { "X-Setup-Token": data.setupToken }, body: buildFormData() });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "Die PDF-Vorschau konnte nicht erstellt werden.");
      }
      const blobUrl = URL.createObjectURL(await response.blob());
      window.open(blobUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Die PDF-Vorschau konnte nicht erstellt werden.");
    } finally {
      setPreviewing(false);
    }
  };

  const submit = async () => {
    for (let index = 0; index <= 3; index += 1) {
      const validationError = validateStep(index);
      if (validationError) {
        setStep(index);
        setError(validationError);
        return;
      }
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/setup/register", { method: "POST", headers: { "X-Setup-Token": data.setupToken }, body: buildFormData() });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Die Einrichtung konnte nicht abgeschlossen werden.");
      await onCompleted(data.email.trim(), data.password);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Die Einrichtung konnte nicht abgeschlossen werden.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="w-full shadow-2xl">
      <CardHeader>
        <CardTitle>Schulamt einrichten</CardTitle>
        <CardDescription>Zugang, Schreiben, Schulen und optionaler Mailversand werden gemeinsam eingerichtet.</CardDescription>
        <div className="grid grid-cols-2 gap-2 pt-4 sm:grid-cols-5">
          {steps.map((label, index) => (
            <button key={label} type="button" disabled={index > step} onClick={() => index <= step && setStep(index)} className={`rounded-lg border p-2 text-xs ${index === step ? "bg-primary text-primary-foreground" : "bg-muted"} disabled:opacity-50`}>
              {index + 1}. {label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {step === 0 && <div className="grid gap-4 sm:grid-cols-2">
          {setupTokenRequired && <div className="space-y-2 sm:col-span-2"><Label htmlFor="setup-token">Einrichtungsschlüssel</Label><Input id="setup-token" type="password" autoComplete="one-time-code" value={data.setupToken} onChange={(event) => setData({ ...data, setupToken: event.target.value })} /></div>}
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="setup-office-name">Bezeichnung des Schulamts</Label><Input id="setup-office-name" value={data.name} onChange={(event) => setData({ ...data, name: event.target.value })} placeholder="Staatliches Schulamt …" /></div>
          <div className="space-y-2"><Label htmlFor="setup-office-email">Login-E-Mail</Label><Input id="setup-office-email" type="email" value={data.email} onChange={(event) => setData({ ...data, email: event.target.value })} placeholder="schulamt@behoerde.de" /></div>
          <div className="space-y-2"><Label htmlFor="setup-office-password">Passwort</Label><Input id="setup-office-password" type="password" minLength={12} value={data.password} onChange={(event) => setData({ ...data, password: event.target.value })} placeholder="Mindestens 12 Zeichen" /></div>
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="setup-office-city">Ort für Schreiben</Label><Input id="setup-office-city" value={data.profile.city} onChange={(event) => setProfile("city", event.target.value)} placeholder="Ort" /></div>
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="setup-public-support">Öffentlicher Hilfe- und Kontaktweg (optional)</Label><Input id="setup-public-support" value={data.publicSettings.supportContact} onChange={(event) => setData({ ...data, publicSettings: { ...data.publicSettings, supportContact: event.target.value } })} placeholder="Telefon, E-Mail oder Ansprechperson" /><p className="text-xs text-muted-foreground">Erscheint vor der Anmeldung. Ohne Angabe wird die Kontaktperson aus dem Briefkopf verwendet.</p></div>
        </div>}

        {step === 1 && <div className="space-y-4">
          <div className="flex items-center gap-2 font-semibold"><FileText className="h-4 w-4" /> Briefkopf, Unterschrift und Schreiben</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="setup-header-text">Briefkopf</Label><Input id="setup-header-text" value={data.profile.headerText} onChange={(event) => setProfile("headerText", event.target.value)} placeholder="Vollständige Behördenbezeichnung" /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="setup-return-address">Rücksendezeile</Label><Input id="setup-return-address" value={data.profile.returnAddress} onChange={(event) => setProfile("returnAddress", event.target.value)} placeholder="Behörde · Straße Hausnummer · PLZ Ort" /></div>
            <div className="space-y-2"><Label htmlFor="setup-contact-address">Kontaktanschrift</Label><Textarea id="setup-contact-address" rows={5} value={data.profile.contactAddress} onChange={(event) => { setProfile("contactAddress", event.target.value); setOfficeGeocoding("IDLE"); }} placeholder={"Straße Hausnummer\nPLZ Ort\nTelefon"} /></div>
            <div className="space-y-2"><Label htmlFor="setup-contact-person">Ansprechperson / Kontaktkanäle</Label><Textarea id="setup-contact-person" rows={5} value={data.profile.contactPerson} onChange={(event) => setProfile("contactPerson", event.target.value)} placeholder={"Name\nDurchwahl\nE-Mail"} /></div>
            <div className="space-y-2"><Label htmlFor="setup-director-name">Name der Amtsleitung</Label><Input id="setup-director-name" value={data.profile.amtsleitungName} onChange={(event) => setProfile("amtsleitungName", event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="setup-director-title">Titel / Funktion</Label><Input id="setup-director-title" value={data.profile.amtsleitungTitle} onChange={(event) => setProfile("amtsleitungTitle", event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="setup-logo">Logo</Label><label htmlFor="setup-logo" className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm"><Upload className="h-4 w-4" />{logo?.name || "PNG/JPEG auswählen"}<input id="setup-logo" type="file" accept="image/png,image/jpeg" className="hidden" onChange={(event) => setLogo(event.target.files?.[0] || null)} /></label></div>
            <div className="space-y-2"><Label htmlFor="setup-signature">Unterschrift</Label><label htmlFor="setup-signature" className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm"><Upload className="h-4 w-4" />{signature?.name || "PNG/JPEG auswählen"}<input id="setup-signature" type="file" accept="image/png,image/jpeg" className="hidden" onChange={(event) => setSignature(event.target.files?.[0] || null)} /></label></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="setup-document-subject">Betreff</Label><Input id="setup-document-subject" value={data.profile.documentSubject} onChange={(event) => setProfile("documentSubject", event.target.value)} /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="setup-document-intro">Einleitung</Label><Textarea id="setup-document-intro" value={data.profile.documentIntro} onChange={(event) => setProfile("documentIntro", event.target.value)} /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="setup-baytgv-text">Rechtlicher BayTGV-Hinweis</Label><Textarea id="setup-baytgv-text" rows={7} value={BAYTGV_LEGAL_TEXT} readOnly className="bg-muted" /><p className="text-xs text-muted-foreground">Der rechtlich konkrete Text ist fest hinterlegt und kann nicht versehentlich verändert werden.</p></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="setup-document-closing">Schlussformel</Label><Input id="setup-document-closing" value={data.profile.documentClosing} onChange={(event) => setProfile("documentClosing", event.target.value)} /></div>
            <div className="sm:col-span-2"><Button type="button" variant="outline" onClick={geocodeOffice} disabled={officeGeocoding === "SEARCHING"}><MapPin className="mr-2 h-4 w-4" />{officeGeocoding === "SEARCHING" ? "Standort wird gesucht …" : "Schulamtsstandort ermitteln"}</Button>{officeGeocoding === "RESOLVED" && <span className="ml-3 text-sm text-emerald-600">Standort gefunden.</span>}{(officeGeocoding === "NOT_FOUND" || officeGeocoding === "UNAVAILABLE") && <span className="ml-3 text-sm text-amber-700">Kann später in den Einstellungen nachgeholt werden.</span>}</div>
          </div>
        </div>}

        {step === 2 && <div className="space-y-4">
          <fieldset className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
            <legend className="px-1 font-semibold">Öffentliche Betreiberinformationen (optional)</legend>
            <p className="text-sm text-muted-foreground">Impressum und Datenschutzerklärung erscheinen vor der Anmeldung. Bitte nur fachlich und rechtlich freigegebene Texte eintragen; sie können später in den Einstellungen ergänzt oder geändert werden.</p>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="setup-impressum">Impressum</Label><Textarea id="setup-impressum" rows={6} value={data.publicSettings.impressum} onChange={(event) => setData({ ...data, publicSettings: { ...data.publicSettings, impressum: event.target.value } })} /></div>
              <div className="space-y-2"><Label htmlFor="setup-privacy-policy">Datenschutzerklärung</Label><Textarea id="setup-privacy-policy" rows={6} value={data.publicSettings.privacyPolicy} onChange={(event) => setData({ ...data, publicSettings: { ...data.publicSettings, privacyPolicy: event.target.value } })} /></div>
            </div>
          </fieldset>
          <div className="space-y-2">
            <div className="flex items-center justify-between"><span className="flex items-center gap-2 font-semibold"><School className="h-4 w-4" /> Schulen</span><Button type="button" variant="outline" size="sm" onClick={() => setData((current) => ({ ...current, schools: [...current.schools, emptySchool()] }))}><Plus className="mr-1 h-4 w-4" /> Schule</Button></div>
            <p className="text-sm text-muted-foreground">Für die Ersteinrichtung muss mindestens eine Schule angelegt werden. Weitere Schulen können später ergänzt werden.</p>
          </div>
          {data.schools.map((school, index) => <div key={index} className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor={`setup-school-${index}-name`}>Name</Label><Input id={`setup-school-${index}-name`} value={school.name} onChange={(event) => updateSchool(index, { name: event.target.value })} placeholder="Grundschule Beispielort" className="setup-example-placeholder placeholder:text-muted-foreground/70" /></div>
            <div className="space-y-2"><Label htmlFor={`setup-school-${index}-type`}>Schulart</Label><Select value={school.type} onValueChange={(value) => value && updateSchool(index, { type: value as InitialSchool["type"] })}><SelectTrigger id={`setup-school-${index}-type`}><SelectValue>{schoolTypeLabel}</SelectValue></SelectTrigger><SelectContent>{SCHOOL_TYPES.map(type => <SelectItem key={type} value={type}>{schoolTypeLabel(type)}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor={`setup-school-${index}-address`}>Vollständige Adresse</Label><Input id={`setup-school-${index}-address`} value={school.address} onChange={(event) => updateSchool(index, { address: event.target.value, latitude: null, longitude: null, geocodingStatus: "IDLE", geocodingMessage: "" })} placeholder="Schulstraße 1, 12345 Beispielort" className="setup-example-placeholder placeholder:text-muted-foreground/70" /></div>
            <div className="space-y-2"><Label htmlFor={`setup-school-${index}-email`}>Login-E-Mail</Label><Input id={`setup-school-${index}-email`} type="email" value={school.email} onChange={(event) => updateSchool(index, { email: event.target.value })} placeholder="verwaltung@schule.de" className="setup-example-placeholder placeholder:text-muted-foreground/70" /></div>
            <div className="space-y-2"><Label htmlFor={`setup-school-${index}-password`}>Initiales Passwort</Label><Input id={`setup-school-${index}-password`} type="password" minLength={12} value={school.password} onChange={(event) => updateSchool(index, { password: event.target.value })} placeholder="Mindestens 12 Zeichen" className="setup-example-placeholder placeholder:text-muted-foreground/70" /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={school.isSmall} onChange={(event) => updateSchool(index, { isSmall: event.target.checked })} /> Kleine Schule</label>
            <div className="text-right"><Button type="button" size="sm" variant="ghost" disabled={data.schools.length === 1} onClick={() => setData((current) => ({ ...current, schools: current.schools.filter((_, currentIndex) => currentIndex !== index) }))}><Trash2 className="mr-1 h-4 w-4" /> Entfernen</Button></div>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2"><Button type="button" size="sm" variant="outline" onClick={() => geocodeSchool(index)} disabled={!school.address.trim() || school.geocodingStatus === "SEARCHING"}><MapPin className="mr-1 h-4 w-4" />{school.geocodingStatus === "SEARCHING" ? "Sucht …" : "Standort prüfen"}</Button><Button type="button" size="sm" variant="ghost" onClick={() => setManualMapIndex(manualMapIndex === index ? null : index)}>Kartenpunkt manuell setzen</Button></div>
            {school.geocodingStatus === "RESOLVED" && <p className="flex items-center gap-2 text-sm text-emerald-600 sm:col-span-2"><CheckCircle2 className="h-4 w-4" /> Standort gefunden.</p>}
            {(school.geocodingStatus === "NOT_FOUND" || school.geocodingStatus === "UNAVAILABLE") && <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 sm:col-span-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Adresse wird gespeichert. Der Standort konnte noch nicht ermittelt werden und wird später erneut geprüft. {school.geocodingMessage}</p>}
            {manualMapIndex === index && <div className="sm:col-span-2"><LocationPickerMap lat={school.latitude} lng={school.longitude} onChange={(latitude, longitude) => updateSchool(index, { latitude, longitude, geocodingStatus: "MANUAL", geocodingMessage: "Kartenpunkt wurde manuell gesetzt." })} /></div>}
          </div>)}
        </div>}

        {step === 3 && <div className="space-y-5">
          <div className="flex items-center gap-2 font-semibold"><Mail className="h-4 w-4" /> Mailversand</div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Mail-Anbindung</legend>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <label className={`relative min-w-0 cursor-pointer rounded-xl border p-4 text-left transition-colors focus-within:ring-3 focus-within:ring-ring/50 ${data.profile.mailProvider === "NONE" ? "border-primary bg-primary/10 ring-1 ring-primary" : "bg-card hover:bg-muted/60"}`}>
                <input type="radio" name="setup-mail-provider" value="NONE" checked={data.profile.mailProvider === "NONE"} onChange={() => { setProfile("mailProvider", "NONE"); setError(""); }} className="sr-only" />
                <span className="block break-words font-semibold">Später einrichten</span>
                <span className="mt-1 block break-words text-sm text-muted-foreground">Die App funktioniert zunächst ohne Mailversand. SMTP kann jederzeit in den Einstellungen ergänzt werden.</span>
              </label>
              <label className={`relative min-w-0 cursor-pointer rounded-xl border p-4 text-left transition-colors focus-within:ring-3 focus-within:ring-ring/50 ${data.profile.mailProvider === "SMTP" ? "border-primary bg-primary/10 ring-1 ring-primary" : "bg-card hover:bg-muted/60"}`}>
                <input type="radio" name="setup-mail-provider" value="SMTP" checked={data.profile.mailProvider === "SMTP"} onChange={() => { setProfile("mailProvider", "SMTP"); setError(""); }} className="sr-only" />
                <span className="block break-words font-semibold">SMTP jetzt einrichten</span>
                <span className="mt-1 block break-words text-sm text-muted-foreground">E-Mails werden über den Mailserver des Schulamts versendet.</span>
              </label>
            </div>
          </fieldset>
          {data.profile.mailProvider === "SMTP" && <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="setup-smtp-host">SMTP-Host</Label><Input id="setup-smtp-host" value={data.profile.smtpHost} onChange={(event) => setProfile("smtpHost", event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="setup-smtp-port">Port</Label><Input id="setup-smtp-port" type="number" min={1} max={65535} value={data.profile.smtpPort} onChange={(event) => setProfile("smtpPort", Number(event.target.value))} /></div>
            <div className="space-y-2"><Label htmlFor="setup-smtp-user">Benutzer</Label><Input id="setup-smtp-user" value={data.profile.smtpUser} onChange={(event) => setProfile("smtpUser", event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="setup-smtp-password">Passwort</Label><Input id="setup-smtp-password" type="password" value={data.profile.smtpPass} onChange={(event) => setProfile("smtpPass", event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="setup-smtp-from-name">Absendername</Label><Input id="setup-smtp-from-name" value={data.profile.smtpFromName} onChange={(event) => setProfile("smtpFromName", event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="setup-smtp-from-address">Absender-E-Mail</Label><Input id="setup-smtp-from-address" type="email" value={data.profile.smtpFromAddress} onChange={(event) => setProfile("smtpFromAddress", event.target.value)} /></div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={data.profile.smtpSecure} onChange={(event) => setProfile("smtpSecure", event.target.checked)} /> Direkte TLS-Verbindung, typischerweise Port 465; sonst wird STARTTLS verlangt.</label>
          </div>}
          <div className="space-y-2"><Label htmlFor="setup-invite-validity">Standardgültigkeit für Einladungen Mobiler Reserven</Label><Input id="setup-invite-validity" type="number" min={1} max={90} value={data.profile.teacherInviteValidityDays} onChange={(event) => setProfile("teacherInviteValidityDays", Number(event.target.value))} /><p className="text-xs text-muted-foreground">Einladungen können später jederzeit erneut ausgestellt werden.</p></div>
        </div>}

        {step === 4 && <div className="space-y-4">
          <div className="rounded-xl border p-4"><h3 className="font-semibold">{data.name}</h3><p className="text-sm text-muted-foreground">{data.email} · {data.schools.length} Schule(n) · Mail: {data.profile.mailProvider === "SMTP" ? "SMTP" : "später"}</p></div>
          {data.schools.some((school) => school.latitude == null) && <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Mindestens ein Schulstandort ist noch offen. Die Einrichtung kann abgeschlossen werden; die App zeigt den Status an und versucht die Geokodierung später erneut.</p>}
          <Button type="button" variant="outline" onClick={preview} disabled={previewing}>{previewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}PDF-Vorschau öffnen</Button>
        </div>}
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button type="button" variant="outline" disabled={step === 0 || saving} onClick={() => { setError(""); setStep((current) => current - 1); }}><ArrowLeft className="mr-1 h-4 w-4" /> Zurück</Button>
        {step < steps.length - 1
          ? <Button type="button" onClick={goForward}>Weiter <ArrowRight className="ml-1 h-4 w-4" /></Button>
          : <Button type="button" disabled={saving} onClick={submit}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Einrichtung abschließen</Button>}
      </CardFooter>
    </Card>
  );
}
