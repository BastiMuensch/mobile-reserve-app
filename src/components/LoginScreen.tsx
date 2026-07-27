"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { useAuth } from "./AuthProvider";
import { Card, CardContent, CardHeader, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Lock, Info } from "lucide-react";

import { LoginForm } from "./auth/LoginForm";
import { ResetPasswordDialog } from "./auth/ResetPasswordDialog";
import { ImpressumDialog } from "./auth/ImpressumDialog";

export function LoginScreen() {
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Ein Konto-Paar für alle Rollen: Die Rolle steht am Benutzerkonto, nicht an der
  // Anmeldemaske.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [needsSetup, setNeedsSetup] = useState(false);
  const [isCheckingSetup, setIsCheckingSetup] = useState(true);

  // Logo des Schulamts (systemweit, vom Admin hinterlegt – siehe Admin-Panel).
  const [schulamtLogo, setSchulamtLogo] = useState<{ url: string; alt: string } | null>(null);

  // Setup form state
  const [setupName, setSetupName] = useState("");
  const [setupEmail, setSetupEmail] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupLoading, setSetupLoading] = useState(false);

  useEffect(() => {
    const checkSetupStatus = async () => {
      try {
        const res = await fetch("/api/setup/status");
        if (res.ok) {
          const data = await res.json();
          setNeedsSetup(data.needsSetup);
        }
      } catch (err) {
        console.error("Failed to check setup status", err);
      } finally {
        setIsCheckingSetup(false);
      }
    };
    checkSetupStatus();
  }, []);

  useEffect(() => {
    const loadPublicSettings = async () => {
      try {
        const res = await fetch("/api/public/settings");
        if (!res.ok) return;
        const data = await res.json();
        if (data.loginLogoUrl) {
          setSchulamtLogo({
            url: data.loginLogoUrl,
            alt: data.loginLogoAlt || "Logo des Schulamts",
          });
        }
      } catch (err) {
        // Ohne Logo ist die Seite voll funktionsfähig – nur still protokollieren.
        console.error("Failed to load public settings", err);
      }
    };
    loadPublicSettings();
  }, []);

  const handleLogin = async (email: string, password: string) => {
    setLoading(true);
    setError("");
    try {
      const success = await login({ email, password });
      if (!success) setError("Ungültige Zugangsdaten.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const [isResetOpen, setIsResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  const handlePasswordReset = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setResetLoading(true);
    setResetMessage("");
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail })
      });
      const data = await res.json();
      setResetMessage(data.message || data.error || "Ein Fehler ist aufgetreten.");
    } catch (err) {
      setResetMessage("Ein Fehler ist aufgetreten.");
    } finally {
      setResetLoading(false);
    }
  };

  const [isImpressumOpen, setIsImpressumOpen] = useState(false);

  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSetupLoading(true);
    setError("");
    try {
      const res = await fetch("/api/setup/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: setupName, email: setupEmail, password: setupPassword })
      });
      if (res.ok) {
        await handleLogin(setupEmail, setupPassword);
      } else {
        const data = await res.json();
        setError(data.error || "Fehler bei der Einrichtung.");
      }
    } catch (err) {
      setError("Netzwerkfehler.");
    } finally {
      setSetupLoading(false);
    }
  };

  if (isCheckingSetup) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center bg-background p-4 animate-in fade-in duration-1000 overflow-hidden">
      {/* Immersive Glowing Orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 dark:bg-primary/10 rounded-full blur-[120px] animate-float-orb pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-chart-2/20 dark:bg-chart-2/10 rounded-full blur-[140px] animate-float-orb-delayed pointer-events-none" />

      <div className="w-full max-w-md z-10 relative">
        <div className="text-center mb-8 flex flex-col items-center">
          {/* Logo-Paar: Ist ein Schulamts-Logo hinterlegt, rückt das Logo der Mobilen
              Reserve beim Laden nach links und das Schulamts-Logo fährt daneben ein.
              Ohne hinterlegtes Logo bleibt das Logo mittig und ohne Bewegung. */}
          <div className="mb-4 flex items-center justify-center gap-6">
            <Image
              src="/logo_transparent.png"
              alt="Logo von MobileReserve.digital"
              width={160}
              height={160}
              className={`w-32 h-32 sm:w-40 sm:h-40 drop-shadow-2xl hover:scale-105 transition-transform duration-500 ${schulamtLogo ? 'animate-logo-primary' : ''}`}
              priority
            />
            {schulamtLogo && (
              <>
                <span aria-hidden="true" className="h-16 sm:h-20 w-px bg-border/70 shrink-0 animate-logo-secondary" />
                {/* Feste Höhe, freie Breite: Schulamts-Logos sind meist breite Banner und
                    würden in einem quadratischen Rahmen zu einem schmalen Streifen
                    zusammenfallen. max-w begrenzt sehr breite Motive. */}
                <Image
                  src={schulamtLogo.url}
                  alt={schulamtLogo.alt}
                  width={320}
                  height={160}
                  className="h-20 sm:h-28 w-auto max-w-[9rem] sm:max-w-[12rem] object-contain drop-shadow-xl animate-logo-secondary"
                  priority
                  unoptimized
                />
              </>
            )}
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-foreground drop-shadow-sm">
            MobileReserve.digital
          </h1>
          <p className="text-muted-foreground mt-2 font-medium tracking-wide text-sm uppercase">Digitales Vertretungsmanagement</p>
        </div>

        {needsSetup ? (
          <Card className="shadow-2xl border-white/40 dark:border-white/5 glass-panel rounded-2xl overflow-hidden">
            <CardHeader className="bg-primary/5 pb-6">
              <h2 className="text-2xl font-bold text-foreground text-center">Willkommen! 👋</h2>
              <p className="text-sm text-muted-foreground text-center mt-2">
                Es scheint, als wäre MobileReserve.digital frisch installiert. Bitte richten Sie den initialen System-Administrator ein, um fortzufahren.
              </p>
            </CardHeader>
            <form onSubmit={handleSetupSubmit}>
              <CardContent className="space-y-4 pt-6 pb-6">
                <div className="space-y-2">
                  <Label htmlFor="setup-name" className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">Name</Label>
                  <Input 
                    id="setup-name" type="text" placeholder="Max Mustermann" className="bg-background/50 rounded-xl"
                    value={setupName} onChange={(e) => setSetupName(e.target.value)} required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="setup-email" className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">Admin E-Mail</Label>
                  <Input 
                    id="setup-email" type="email" placeholder="admin@system.de" className="bg-background/50 rounded-xl"
                    value={setupEmail} onChange={(e) => setSetupEmail(e.target.value)} required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="setup-password" className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">Sicheres Passwort</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                    <Input
                      id="setup-password" type="password" placeholder="Mindestens 8 Zeichen" className="pl-10 bg-background/50 rounded-xl"
                      value={setupPassword} onChange={(e) => setSetupPassword(e.target.value)} required minLength={8}
                    />
                  </div>
                </div>
                {error && <p className="text-sm text-red-500 font-medium">{error}</p>}
              </CardContent>
              <CardFooter className="pt-4 pb-6">
                <Button type="submit" className="w-full bg-primary hover:bg-primary/95 text-white shadow-md hover:scale-[1.01] transition-all duration-300 rounded-xl" disabled={setupLoading}>
                  {setupLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "System-Administrator erstellen"}
                </Button>
              </CardFooter>
            </form>
          </Card>
        ) : (
          <Card className="shadow-2xl border-white/40 dark:border-white/5 glass-panel rounded-2xl overflow-hidden">
            <LoginForm
              email={email} setEmail={setEmail}
              password={password} setPassword={setPassword}
              loading={loading} error={error}
              handleLogin={(e) => { e.preventDefault(); handleLogin(email, password); }}
            />
          </Card>
        )}

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4 text-sm text-muted-foreground">
          {!needsSetup && (
            <button 
              onClick={() => setIsResetOpen(true)}
              className="hover:text-primary transition-colors flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-md px-2 py-1"
            >
              Passwort vergessen?
            </button>
          )}
          {!needsSetup && <span className="hidden sm:inline opacity-30">•</span>}
          <button 
            onClick={() => setIsImpressumOpen(true)}
            className="hover:text-primary transition-colors flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-md px-2 py-1"
          >
            <Info className="w-4 h-4" />
            Impressum & Datenschutz
          </button>
        </div>
      </div>

      <ResetPasswordDialog 
        isOpen={isResetOpen} setIsOpen={setIsResetOpen}
        email={resetEmail} setEmail={setResetEmail}
        message={resetMessage} setMessage={setResetMessage}
        loading={resetLoading} handleReset={handlePasswordReset}
      />

      <ImpressumDialog isOpen={isImpressumOpen} setIsOpen={setIsImpressumOpen} />
    </div>
  );
}
