import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CardContent, CardFooter } from "@/components/ui/card";
import { Loader2, Lock } from "lucide-react";
import React from "react";

export function SchulamtLoginForm({
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
      <CardContent className="space-y-4 pb-6">
        <div className="space-y-2">
          <Label htmlFor="schulamt-email" className="text-xs font-semibold tracking-wider uppercase text-slate-500">
            Schulamt E-Mail
          </Label>
          <Input
            id="schulamt-email"
            type="email"
            placeholder="info@schulamt.de"
            className="bg-white/50 dark:bg-slate-950/30 rounded-xl focus-visible:border-primary focus-visible:ring-primary/50"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="schulamt-password" className="text-xs font-semibold tracking-wider uppercase text-slate-500">
            Passwort
          </Label>
          <div className="relative">
            <Lock className="absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
            <Input
              id="schulamt-password"
              type="password"
              placeholder="••••••••"
              className="pl-10 bg-white/50 dark:bg-slate-950/30 rounded-xl focus-visible:border-primary focus-visible:ring-primary/50"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
        </div>
        {error && <p className="text-sm text-red-500 font-medium">{error}</p>}
      </CardContent>
      <CardFooter className="pt-4">
        <Button
          type="submit"
          className="w-full bg-primary hover:bg-primary/95 text-white shadow-md hover:shadow-primary/25 hover:scale-[1.01] transition-all duration-300 rounded-xl"
          disabled={loading}
        >
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Anmelden"}
        </Button>
      </CardFooter>
    </form>
  );
}
