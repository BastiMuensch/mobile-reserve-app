"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { useAuth } from "./AuthProvider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ShieldCheck, UserPlus, Trash2, KeySquare, Building2, LogOut, Settings } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";

export function AdminDashboard() {
  const { logout } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [schulaemter, setSchulaemter] = useState<{ id: string; name: string; email: string; createdAt: string }[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newAccount, setNewAccount] = useState({ email: "", password: "", name: "", address: "" });
  
  const [editingPasswordId, setEditingPasswordId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const [impressum, setImpressum] = useState("");
  const [privacyPolicy, setPrivacyPolicy] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [loginLogoUrl, setLoginLogoUrl] = useState("");
  const [loginLogoAlt, setLoginLogoAlt] = useState("");
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const loadData = async () => {
    try {
      const res = await fetch("/api/admin/schulaemter");
      if (res.ok) {
        setSchulaemter(await res.json());
      }
      const settingsRes = await fetch("/api/settings");
      if (settingsRes.ok) {
        const settingsData = await settingsRes.json();
        if (settingsData.impressum) setImpressum(settingsData.impressum);
        if (settingsData.privacyPolicy) setPrivacyPolicy(settingsData.privacyPolicy);
        if (settingsData.smtpHost) setSmtpHost(settingsData.smtpHost);
        if (settingsData.smtpUser) setSmtpUser(settingsData.smtpUser);
        if (settingsData.smtpPass) setSmtpPass(settingsData.smtpPass);
        setLoginLogoUrl(settingsData.loginLogoUrl ?? "");
        setLoginLogoAlt(settingsData.loginLogoAlt ?? "");
      }
    } catch (error) {
      console.error('Failed to load admin data:', error);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAdding(true);
    try {
      const res = await fetch("/api/admin/schulaemter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newAccount),
      });
      if (res.ok) {
        setIsAddOpen(false);
        setNewAccount({ email: "", password: "", name: "", address: "" });
        loadData();
      } else {
        const err = await res.json();
        toast({ variant: "error", title: "Fehler beim Anlegen des Schulamts.", description: err.error });
      }
    } finally {
      setIsAdding(false);
    }
  };

  const handleUpdatePassword = async (userId: string) => {
    if (!newPassword) return;
    try {
      const res = await fetch("/api/admin/schulaemter", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, newPassword }),
      });
      if (res.ok) {
        setEditingPasswordId(null);
        setNewPassword("");
        toast({ variant: "success", title: "Passwort erfolgreich aktualisiert." });
      } else {
        toast({ variant: "error", title: "Fehler beim Aktualisieren." });
      }
    } catch (error) {
      console.error('Failed to update password:', error);
      toast({ variant: "error", title: "Netzwerkfehler beim Aktualisieren des Passworts." });
    }
  };

  const handleDelete = async (userId: string) => {
    const confirmed = await confirm({
      title: "Schulamts-Account löschen?",
      description: "Möchten Sie diesen Schulamts-Account wirklich löschen?",
      confirmLabel: "Löschen",
      variant: "destructive",
    });
    if (!confirmed) return;
    const res = await fetch("/api/admin/schulaemter", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) {
      loadData();
    } else {
      toast({ variant: "error", title: "Fehler beim Löschen." });
    }
  };

  const handleUploadLoginLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: "error", title: "Logo konnte nicht hochgeladen werden.", description: data.error });
        return;
      }
      setLoginLogoUrl(data.url);
      toast({ variant: "success", title: "Logo hochgeladen.", description: "Bitte noch speichern, damit es auf der Anmeldeseite erscheint." });
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler beim Hochladen." });
    } finally {
      setIsUploadingLogo(false);
      // Zurücksetzen, damit dieselbe Datei erneut gewählt werden kann
      e.target.value = "";
    }
  };

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ impressum, privacyPolicy, smtpHost, smtpUser, smtpPass, loginLogoUrl, loginLogoAlt }),
      });
      if (res.ok) {
        toast({ variant: "success", title: "Einstellungen gespeichert." });
      } else {
        toast({ variant: "error", title: "Fehler beim Speichern der Einstellungen." });
      }
    } catch (error) {
      toast({ variant: "error", title: "Netzwerkfehler beim Speichern." });
    } finally {
      setIsSavingSettings(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6 md:p-10">
      <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">

        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-card/50 p-6 rounded-2xl border border-border backdrop-blur-md shadow-sm">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-rose-600 to-pink-600 dark:from-rose-400 dark:to-pink-400">
              Admin-Panel
            </h1>
            <p className="text-muted-foreground mt-2 text-lg">
              System-Administration · Schulämter verwalten
            </p>
          </div>
          <Button variant="outline" onClick={logout} className="gap-2">
            <LogOut className="h-4 w-4" /> Abmelden
          </Button>
        </div>

        {/* Schulämter */}
        <Card className="shadow-xl bg-card/80 backdrop-blur-sm border-border">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Building2 className="h-6 w-6 text-primary" />
                Schulamts-Accounts
              </CardTitle>
              <CardDescription>
                Erstellen und verwalten Sie die Zugänge für Schulämter. Jedes Schulamt kann dann seine eigenen Schulen und Lehrkräfte anlegen.
              </CardDescription>
            </div>
            <Button onClick={() => setIsAddOpen(true)} className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-md">
              <UserPlus className="h-4 w-4" /> Schulamt anlegen
            </Button>
          </CardHeader>
          <CardContent>
            {schulaemter.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <ShieldCheck className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p className="text-lg font-medium">Noch keine Schulämter angelegt</p>
                <p className="text-sm mt-1">Erstellen Sie den ersten Schulamts-Account, um das System einzurichten.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {schulaemter.map((sa) => (
                  <div key={sa.id} className="flex items-center justify-between p-4 border border-border rounded-xl bg-muted dark:bg-muted/50 hover:shadow-md transition-shadow">
                    <div>
                      <div className="font-bold text-foreground flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-primary" />
                        {sa.name || "Schulamt"}
                      </div>
                      <div className="text-sm text-muted-foreground mt-0.5">{sa.email}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Erstellt: {new Date(sa.createdAt || Date.now()).toLocaleDateString('de-DE')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {editingPasswordId === sa.id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            type="password"
                            placeholder="Neues Passwort"
                            aria-label={`Neues Passwort für ${sa.name || "Schulamt"}`}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="w-40 h-8 text-sm"
                          />
                          <Button size="sm" onClick={() => handleUpdatePassword(sa.id)}>Speichern</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingPasswordId(null)} aria-label="Passwort-Bearbeitung abbrechen">X</Button>
                        </div>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => setEditingPasswordId(sa.id)}>
                            <KeySquare className="h-3 w-3" /> Passwort
                          </Button>
                          <Button size="sm" variant="destructive" className="gap-1" onClick={() => handleDelete(sa.id)}>
                            <Trash2 className="h-3 w-3" /> Löschen
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* System-Einstellungen (Impressum) */}
        <Card className="shadow-xl bg-card/80 backdrop-blur-sm border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Settings className="h-6 w-6 text-primary" />
              Allgemeine Einstellungen
            </CardTitle>
            <CardDescription>Logo und Impressum für die Startseite (Login-Screen) festlegen.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Logo des Schulamts für den Login-Screen. Bewusst systemweit und nicht am
                Schulamts-Profil: Vor der Anmeldung steht noch nicht fest, um welches
                Schulamt es geht. */}
            <div className="space-y-2 pb-4 border-b border-border">
              <Label htmlFor="login-logo">Logo des Schulamts (Login-Screen)</Label>
              <p className="text-xs text-muted-foreground">
                Wird auf der Anmeldeseite neben dem Logo der Mobilen Reserve angezeigt.
                Empfohlen: PNG mit transparentem Hintergrund, max. 5 MB.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                {loginLogoUrl ? (
                  <div className="relative h-16 w-32 rounded-lg border border-border bg-card overflow-hidden">
                    <Image src={loginLogoUrl} alt="Vorschau des hinterlegten Schulamts-Logos" fill className="object-contain p-1" />
                  </div>
                ) : (
                  <div className="h-16 w-32 rounded-lg border border-dashed border-border grid place-items-center text-xs text-muted-foreground">
                    Kein Logo
                  </div>
                )}
                <Input
                  id="login-logo"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  disabled={isUploadingLogo}
                  onChange={handleUploadLoginLogo}
                  className="max-w-xs"
                />
                {loginLogoUrl && (
                  <Button type="button" variant="outline" onClick={() => setLoginLogoUrl("")}>
                    Logo entfernen
                  </Button>
                )}
              </div>
              <div className="space-y-2 pt-2">
                <Label htmlFor="login-logo-alt">Bildbeschreibung des Logos</Label>
                <Input
                  id="login-logo-alt"
                  value={loginLogoAlt}
                  onChange={e => setLoginLogoAlt(e.target.value)}
                  placeholder="z.B. Logo des Staatlichen Schulamts Musterstadt"
                />
                <p className="text-xs text-muted-foreground">
                  Wird von Screenreadern vorgelesen und angezeigt, falls das Bild nicht lädt.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="impressum">Impressum</Label>
              <textarea
                id="impressum"
                className="flex min-h-[150px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Angaben gemäß § 5 TMG..."
                value={impressum}
                onChange={e => setImpressum(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="privacyPolicy">Datenschutzerklärung (Markdown unterstützt)</Label>
              <textarea
                id="privacyPolicy"
                className="flex min-h-[300px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono"
                placeholder="# Datenschutzerklärung\n\n## 1. Datenschutz auf einen Blick..."
                value={privacyPolicy}
                onChange={e => setPrivacyPolicy(e.target.value)}
              />
            </div>
            <div className="space-y-4 pt-4 border-t border-border">
              <div className="col-span-full">
                <h4 className="text-base font-bold text-foreground">Globaler Mail-Server (Fallback)</h4>
                <p className="text-xs text-muted-foreground mb-2">Dieser SMTP-Server wird genutzt, wenn ein Schulamt keine eigenen Mail-Zugangsdaten hinterlegt hat.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="smtpHost">SMTP Server Host</Label>
                  <Input 
                    id="smtpHost"
                    value={smtpHost} 
                    onChange={e => setSmtpHost(e.target.value)} 
                    placeholder="smtp.beispiel.de" 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="smtpUser">Benutzername (E-Mail)</Label>
                  <Input 
                    id="smtpUser"
                    value={smtpUser} 
                    onChange={e => setSmtpUser(e.target.value)} 
                    placeholder="admin@beispiel.de" 
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="smtpPass">Passwort</Label>
                  <Input 
                    id="smtpPass"
                    type="password"
                    value={smtpPass} 
                    onChange={e => setSmtpPass(e.target.value)} 
                    placeholder="********" 
                  />
                </div>
              </div>
            </div>
            
            <Button onClick={handleSaveSettings} disabled={isSavingSettings} className="bg-primary hover:bg-primary/90 text-primary-foreground mt-4">
              {isSavingSettings ? "Speichert..." : "Einstellungen speichern"}
            </Button>
          </CardContent>
        </Card>

        {/* Add Dialog */}
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>Neues Schulamt anlegen</DialogTitle>
              <DialogDescription>
                Erstellen Sie einen Zugang für ein Schulamt. Dieses kann dann eigenständig Schulen und Lehrkräfte verwalten.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="sa-name">Bezeichnung</Label>
                <Input
                  id="sa-name"
                  placeholder="z.B. Schulamt Musterstadt"
                  value={newAccount.name}
                  onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sa-email">E-Mail-Adresse (Login)</Label>
                <Input
                  id="sa-email"
                  type="email"
                  placeholder="schulamt@landkreis.de"
                  value={newAccount.email}
                  onChange={(e) => setNewAccount({ ...newAccount, email: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sa-password">Passwort</Label>
                <Input
                  id="sa-password"
                  type="password"
                  placeholder="Sicheres Passwort vergeben"
                  value={newAccount.password}
                  onChange={(e) => setNewAccount({ ...newAccount, password: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sa-address">Adresse (für Karte)</Label>
                <Input
                  id="sa-address"
                  type="text"
                  placeholder="z.B. Musterstr. 1, 12345 Musterstadt"
                  value={newAccount.address}
                  onChange={(e) => setNewAccount({ ...newAccount, address: e.target.value })}
                  required
                />
              </div>
              <DialogFooter className="pt-4">
                <Button type="submit" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground" disabled={isAdding}>
                  {isAdding ? "Wird angelegt..." : "Schulamt-Account erstellen"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
