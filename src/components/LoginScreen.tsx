"use client";

import { useState } from "react";
import { useAuth } from "./AuthProvider";
import { Card, CardContent, CardHeader, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Lock, School, ShieldCheck, User, KeyRound, Mail } from "lucide-react";

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

  const handleLogin = async (email: string, password: string) => {
    setLoading(true);
    setError("");
    try {
      const success = await login({ email, password });
      if (!success) setError("Ungültige Zugangsdaten.");
    } catch (err) {
      setError("Ein Fehler ist aufgetreten.");
    } finally {
      setLoading(false);
    }
  };

  const [isResetOpen, setIsResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4 animate-in fade-in duration-700">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400">
            Mobile Reserve
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">Personalmanagement-System</p>
        </div>

        <Card className="shadow-2xl border-slate-200/60 dark:border-slate-800/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl">
          <Tabs defaultValue="school" className="w-full">
            <CardHeader className="pb-4">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="school" className="gap-1 text-xs"><School className="w-3.5 h-3.5" /> Schule</TabsTrigger>
                <TabsTrigger value="teacher" className="gap-1 text-xs"><User className="w-3.5 h-3.5" /> Lehrkraft</TabsTrigger>
                <TabsTrigger value="schulamt" className="gap-1 text-xs"><ShieldCheck className="w-3.5 h-3.5" /> Schulamt</TabsTrigger>
                <TabsTrigger value="admin" className="gap-1 text-xs"><KeyRound className="w-3.5 h-3.5" /> Admin</TabsTrigger>
              </TabsList>
            </CardHeader>

            {/* SCHOOL TAB */}
            <TabsContent value="school" className="m-0">
              <form onSubmit={(e) => { e.preventDefault(); handleLogin(schoolEmail, schoolPassword); }}>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="school-email">Schul-E-Mail</Label>
                    <Input 
                      id="school-email" type="email" placeholder="schule@schule.de" 
                      value={schoolEmail} onChange={(e) => setSchoolEmail(e.target.value)} required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="school-password">Passwort</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
                      <Input 
                        id="school-password" type="password" placeholder="••••••••" className="pl-10"
                        value={schoolPassword} onChange={(e) => setSchoolPassword(e.target.value)} required
                      />
                    </div>
                  </div>
                  {error && <p className="text-sm text-red-500">{error}</p>}
                </CardContent>
                <CardFooter>
                  <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white shadow-md" disabled={loading}>
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Anmelden"}
                  </Button>
                </CardFooter>
              </form>
            </TabsContent>

            {/* TEACHER TAB */}
            <TabsContent value="teacher" className="m-0">
              <form onSubmit={(e) => { e.preventDefault(); handleLogin(teacherEmail, teacherPassword); }}>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="teacher-email">E-Mail</Label>
                    <Input 
                      id="teacher-email" type="email" placeholder="lehrer@schule.de" 
                      value={teacherEmail} onChange={(e) => setTeacherEmail(e.target.value)} required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="teacher-password">Passwort</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
                      <Input 
                        id="teacher-password" type="password" placeholder="••••••••" className="pl-10"
                        value={teacherPassword} onChange={(e) => setTeacherPassword(e.target.value)} required
                      />
                    </div>
                  </div>
                  {error && <p className="text-sm text-red-500">{error}</p>}
                </CardContent>
                <CardFooter>
                  <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-md" disabled={loading}>
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Als Lehrkraft anmelden"}
                  </Button>
                </CardFooter>
              </form>
            </TabsContent>

            {/* SCHULAMT TAB */}
            <TabsContent value="schulamt" className="m-0">
              <form onSubmit={(e) => { e.preventDefault(); handleLogin(schulamtEmail, schulamtPassword); }}>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="schulamt-email">E-Mail</Label>
                    <Input 
                      id="schulamt-email" type="email" placeholder="admin@schulamt.de" 
                      value={schulamtEmail} onChange={(e) => setSchulamtEmail(e.target.value)} required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="schulamt-password">Passwort</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
                      <Input 
                        id="schulamt-password" type="password" placeholder="••••••••" className="pl-10"
                        value={schulamtPassword} onChange={(e) => setSchulamtPassword(e.target.value)} required
                      />
                    </div>
                  </div>
                  {error && <p className="text-sm text-red-500">{error}</p>}
                </CardContent>
                <CardFooter>
                  <Button type="submit" className="w-full bg-slate-900 hover:bg-slate-800 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-slate-200 shadow-md" disabled={loading}>
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Als Schulamt anmelden"}
                  </Button>
                </CardFooter>
              </form>
            </TabsContent>

            {/* ADMIN TAB */}
            <TabsContent value="admin" className="m-0">
              <form onSubmit={(e) => { e.preventDefault(); handleLogin(adminEmail, adminPassword); }}>
                <CardContent className="space-y-4">
                  <p className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-800 p-3 rounded-lg">
                    🔒 System-Administrator: Verwaltung von Schulamts-Accounts und Systemkonfiguration.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="admin-email">Admin E-Mail</Label>
                    <Input 
                      id="admin-email" type="email" placeholder="admin@system.de" 
                      value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="admin-password">Admin Passwort</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
                      <Input 
                        id="admin-password" type="password" placeholder="••••••••" className="pl-10"
                        value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} required
                      />
                    </div>
                  </div>
                  {error && <p className="text-sm text-red-500">{error}</p>}
                </CardContent>
                <CardFooter>
                  <Button type="submit" className="w-full bg-rose-600 hover:bg-rose-700 text-white shadow-md" disabled={loading}>
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Als Admin anmelden"}
                  </Button>
                </CardFooter>
              </form>
            </TabsContent>
          </Tabs>
        </Card>
        
        <div className="text-center mt-6">
          <Button variant="link" className="text-slate-500" onClick={() => setIsResetOpen(true)}>
            Passwort vergessen?
          </Button>
        </div>

        <Dialog open={isResetOpen} onOpenChange={(open) => { setIsResetOpen(open); if(!open) { setResetMessage(""); setResetEmail(""); } }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Passwort zurücksetzen</DialogTitle>
              <DialogDescription>
                Geben Sie Ihre E-Mail-Adresse ein. Wir senden Ihnen ein neues temporäres Passwort zu.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleResetPassword} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="reset-email">Ihre E-Mail-Adresse</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
                  <Input 
                    id="reset-email" type="email" placeholder="email@beispiel.de" className="pl-10"
                    value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} required
                  />
                </div>
              </div>
              {resetMessage && (
                <div className="p-3 bg-blue-50 text-blue-800 text-sm rounded-lg border border-blue-200">
                  {resetMessage}
                </div>
              )}
              <DialogFooter>
                <Button type="submit" disabled={resetLoading} className="w-full">
                  {resetLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Passwort zurücksetzen"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

      </div>
    </div>
  );
}
