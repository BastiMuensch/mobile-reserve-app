import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CardContent, CardFooter } from "@/components/ui/card";
import { Loader2, Lock } from "lucide-react";
import React from "react";

/**
 * Ein Anmeldeformular für alle Rollen.
 *
 * Die Rolle (Schule, Lehrkraft, Schulamt, Admin) ergibt sich aus dem Benutzerkonto in
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
            className="bg-background/50 rounded-xl"
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
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              className="pl-10 bg-background/50 rounded-xl"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
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
          className="w-full bg-primary hover:bg-primary/95 text-primary-foreground shadow-md hover:shadow-primary/25 hover:scale-[1.01] transition-all duration-300 rounded-xl"
          disabled={loading}
        >
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Anmelden"}
        </Button>
      </CardFooter>
    </form>
  );
}
