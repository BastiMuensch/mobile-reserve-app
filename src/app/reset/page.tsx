"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Lock, CheckCircle2 } from "lucide-react";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!token) {
      setError("Kein gültiger Link. Bitte fordern Sie einen neuen Link an.");
      return;
    }
    if (password.length < 8) {
      setError("Passwort muss mindestens 8 Zeichen lang sein.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Die Passwörter stimmen nicht überein.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess(true);
      } else {
        setError(data.error || "Ein Fehler ist aufgetreten.");
      }
    } catch (err) {
      setError("Netzwerkfehler. Bitte versuchen Sie es erneut.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md z-10 relative">
      <div className="text-center mb-8 flex flex-col items-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground drop-shadow-sm">
          Neues Passwort vergeben
        </h1>
        <p className="text-muted-foreground mt-2 font-medium tracking-wide text-sm">
          MobileReserve.digital
        </p>
      </div>

      <Card className="shadow-2xl border-white/40 dark:border-white/5 glass-panel rounded-2xl overflow-hidden">
        {success ? (
          <CardContent className="py-10 flex flex-col items-center text-center gap-3">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
            <p className="text-foreground font-medium">
              Ihr Passwort wurde erfolgreich geändert.
            </p>
            <Link href="/" className="mt-2">
              <Button className="rounded-xl shadow-md">Zur Anmeldung</Button>
            </Link>
          </CardContent>
        ) : !token ? (
          <CardContent className="py-10 flex flex-col items-center text-center gap-3">
            <p className="text-sm font-medium p-3 rounded-lg bg-red-50 text-red-600 dark:bg-red-950/30">
              Kein gültiger Link. Bitte fordern Sie über &quot;Passwort vergessen?&quot; einen neuen Link an.
            </p>
            <Link href="/" className="mt-2">
              <Button variant="outline" className="rounded-xl">Zur Anmeldung</Button>
            </Link>
          </CardContent>
        ) : (
          <form onSubmit={handleSubmit}>
            <CardHeader className="pb-2">
              <p className="text-sm text-muted-foreground">
                Bitte geben Sie Ihr neues Passwort ein.
              </p>
            </CardHeader>
            <CardContent className="space-y-4 pt-4 pb-6">
              <div className="space-y-2">
                <Label htmlFor="new-password" className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
                  Neues Passwort
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="Mindestens 8 Zeichen"
                    className="pl-10 bg-background/50 rounded-xl"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password" className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
                  Passwort bestätigen
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="Passwort wiederholen"
                    className="pl-10 bg-background/50 rounded-xl"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                </div>
              </div>
              {error && (
                <p className="text-sm font-medium p-3 rounded-lg bg-red-50 text-red-600 dark:bg-red-950/30">
                  {error}
                </p>
              )}
            </CardContent>
            <CardFooter className="pt-4 pb-6">
              <Button type="submit" className="w-full rounded-xl shadow-md" disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Passwort speichern"}
              </Button>
            </CardFooter>
          </form>
        )}
      </Card>

      <div className="mt-8 flex items-center justify-center text-sm text-muted-foreground">
        <Link href="/" className="hover:text-primary transition-colors">
          Zurück zur Anmeldung
        </Link>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen relative flex items-center justify-center bg-background p-4 overflow-hidden">
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 dark:bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-chart-2/20 dark:bg-chart-2/10 rounded-full blur-[140px] pointer-events-none" />
      <Suspense
        fallback={
          <div className="flex justify-center items-center h-[50vh]">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
