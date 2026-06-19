"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { useAuth } from "./AuthProvider";
import { Card, CardContent, CardHeader, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Lock, School, ShieldCheck, User, KeyRound, Info } from "lucide-react";

import { SchoolLoginForm } from "./auth/SchoolLoginForm";
import { TeacherLoginForm } from "./auth/TeacherLoginForm";
import { SchulamtLoginForm } from "./auth/SchulamtLoginForm";
import { AdminLoginForm } from "./auth/AdminLoginForm";
import { ResetPasswordDialog } from "./auth/ResetPasswordDialog";
import { ImpressumDialog } from "./auth/ImpressumDialog";

export function LoginScreen() {
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [schoolEmail, setSchoolEmail] = useState("");
  const [schoolPassword, setSchoolPassword] = useState("");
  
  const [teacherEmail, setTeacherEmail] = useState("");
  const [teacherPassword, setTeacherPassword] = useState("");
  
  const [schulamtEmail, setSchulamtEmail] = useState("");
  const [schulamtPassword, setSchulamtPassword] = useState("");

  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const [needsSetup, setNeedsSetup] = useState(false);
  const [isCheckingSetup, setIsCheckingSetup] = useState(true);

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
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4 animate-in fade-in duration-1000 overflow-hidden">
      {/* Immersive Glowing Orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 dark:bg-primary/10 rounded-full blur-[120px] animate-float-orb pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-chart-2/20 dark:bg-chart-2/10 rounded-full blur-[140px] animate-float-orb-delayed pointer-events-none" />

      <div className="w-full max-w-md z-10 relative">
        <div className="text-center mb-8 flex flex-col items-center">
          <div className="mb-4">
            <Image src="/logo_transparent.png" alt="MobileReserve.digital Logo" width={160} height={160} className="w-40 h-40 drop-shadow-2xl hover:scale-105 transition-transform duration-500" priority />
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white drop-shadow-sm">
            MobileReserve.digital
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2 font-medium tracking-wide text-sm uppercase">Digitales Vertretungsmanagement</p>
        </div>

        {needsSetup ? (
          <Card className="shadow-2xl border-white/40 dark:border-white/5 glass-panel rounded-2xl overflow-hidden">
            <CardHeader className="bg-primary/5 pb-6">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white text-center">Willkommen! 👋</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 text-center mt-2">
                Es scheint, als wäre MobileReserve.digital frisch installiert. Bitte richten Sie den initialen System-Administrator ein, um fortzufahren.
              </p>
            </CardHeader>
            <form onSubmit={handleSetupSubmit}>
              <CardContent className="space-y-4 pt-6 pb-6">
                <div className="space-y-2">
                  <Label htmlFor="setup-name" className="text-xs font-semibold tracking-wider uppercase text-slate-500">Name</Label>
                  <Input 
                    id="setup-name" type="text" placeholder="Max Mustermann" className="bg-white/50 dark:bg-slate-950/30 rounded-xl"
                    value={setupName} onChange={(e) => setSetupName(e.target.value)} required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="setup-email" className="text-xs font-semibold tracking-wider uppercase text-slate-500">Admin E-Mail</Label>
                  <Input 
                    id="setup-email" type="email" placeholder="admin@system.de" className="bg-white/50 dark:bg-slate-950/30 rounded-xl"
                    value={setupEmail} onChange={(e) => setSetupEmail(e.target.value)} required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="setup-password" className="text-xs font-semibold tracking-wider uppercase text-slate-500">Sicheres Passwort</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
                    <Input 
                      id="setup-password" type="password" placeholder="Mindestens 8 Zeichen" className="pl-10 bg-white/50 dark:bg-slate-950/30 rounded-xl"
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
            <Tabs defaultValue="school" className="w-full" onValueChange={() => setError('')}>
            <CardHeader className="pb-2">
              <TabsList className="grid w-full grid-cols-4 bg-slate-100/50 dark:bg-slate-950/40 p-1 rounded-xl">
                <TabsTrigger value="school" className="gap-1 text-xs rounded-lg transition-all duration-300 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-900 shadow-sm"><School className="w-3.5 h-3.5 text-blue-600 dark:text-blue-500" /> Schule</TabsTrigger>
                <TabsTrigger value="teacher" className="gap-1 text-xs rounded-lg transition-all duration-300 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-900 shadow-sm"><User className="w-3.5 h-3.5 text-orange-500" /> Lehrkraft</TabsTrigger>
                <TabsTrigger value="schulamt" className="gap-1 text-xs rounded-lg transition-all duration-300 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-900 shadow-sm"><ShieldCheck className="w-3.5 h-3.5 text-primary" /> Schulamt</TabsTrigger>
                <TabsTrigger value="admin" className="gap-1 text-xs rounded-lg transition-all duration-300 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-900 shadow-sm"><KeyRound className="w-3.5 h-3.5 text-destructive" /> Admin</TabsTrigger>
              </TabsList>
            </CardHeader>

            <TabsContent value="school" className="m-0">
              <SchoolLoginForm 
                email={schoolEmail} setEmail={setSchoolEmail}
                password={schoolPassword} setPassword={setSchoolPassword}
                loading={loading} error={error} handleLogin={(e) => { e.preventDefault(); handleLogin(schoolEmail, schoolPassword); }}
              />
            </TabsContent>

            <TabsContent value="teacher" className="m-0">
              <TeacherLoginForm 
                email={teacherEmail} setEmail={setTeacherEmail}
                password={teacherPassword} setPassword={setTeacherPassword}
                loading={loading} error={error} handleLogin={(e) => { e.preventDefault(); handleLogin(teacherEmail, teacherPassword); }}
              />
            </TabsContent>

            <TabsContent value="schulamt" className="m-0">
              <SchulamtLoginForm 
                email={schulamtEmail} setEmail={setSchulamtEmail}
                password={schulamtPassword} setPassword={setSchulamtPassword}
                loading={loading} error={error} handleLogin={(e) => { e.preventDefault(); handleLogin(schulamtEmail, schulamtPassword); }}
              />
            </TabsContent>

            <TabsContent value="admin" className="m-0">
              <AdminLoginForm 
                email={adminEmail} setEmail={setAdminEmail}
                password={adminPassword} setPassword={setAdminPassword}
                loading={loading} error={error} handleLogin={(e) => { e.preventDefault(); handleLogin(adminEmail, adminPassword); }}
              />
            </TabsContent>
          </Tabs>
        </Card>
        )}

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4 text-sm text-slate-500 dark:text-slate-400">
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
