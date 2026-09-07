import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CardContent, CardFooter } from "@/components/ui/card";
import { Eye, EyeOff, Loader2, Lock } from "lucide-react";
import React, { useState } from "react";

/**
 * Ein Anmeldeformular für alle Rollen.
 *
 * Die Rolle (Schule, Lehrkraft oder Schulamt) ergibt sich aus dem Benutzerkonto in
 * der Datenbank – die Anmelde-Route unterscheidet sie nicht. Eine Vorauswahl der Rolle
 * wäre daher wirkungslos und würde nur zu Fehlversuchen führen, wenn jemand die
 * "falsche" wählt.
 */
export function LoginForm({
  email,
  setEmail,
  password,
  setPassword,
  loading,
  error,
  handleLogin,
}: {
  email: string;
  setEmail: (val: string) => void;
  password: string;
  setPassword: (val: string) => void;
  loading: boolean;
  error: string;
  handleLogin: (e: React.FormEvent) => void;
}) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  return (
    <form onSubmit={handleLogin}>
      <CardContent className="space-y-4 pt-6 pb-6">
        <div className="space-y-2">
          <Label htmlFor="login-email" className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
            E-Mail-Adresse
          </Label>
          <Input
            id="login-email"
            type="email"
            autoComplete="username"
            placeholder="name@beispiel.de"
            className="rounded-lg border-emerald-950/15 bg-white shadow-none focus-visible:ring-emerald-700"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="login-password" className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
            Passwort
          </Label>
          <div className="relative">
            <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <Input
              id="login-password"
              type={passwordVisible ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              className="pl-10 pr-11 rounded-lg border-emerald-950/15 bg-white shadow-none focus-visible:ring-emerald-700"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button type="button" onClick={() => setPasswordVisible((visible) => !visible)} className="absolute right-2 top-1.5 rounded-md p-1.5 text-muted-foreground hover:text-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700" aria-label={passwordVisible ? "Passwort verbergen" : "Passwort anzeigen"} aria-pressed={passwordVisible}>
              {passwordVisible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive font-medium">
            {error}
          </p>
        )}
      </CardContent>
      <CardFooter className="pt-2 pb-6">
        <Button
          type="submit"
          className="w-full rounded-lg bg-emerald-800 text-white shadow-sm transition-colors hover:bg-emerald-900"
          disabled={loading}
        >
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Anmelden"}
        </Button>
      </CardFooter>
    </form>
  );
}
