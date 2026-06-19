import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import React from "react";

export function ResetPasswordDialog({
  isOpen,
  setIsOpen,
  email,
  setEmail,
  message,
  setMessage,
  loading,
  handleReset,
}: {
  isOpen: boolean;
  setIsOpen: (val: boolean) => void;
  email: string;
  setEmail: (val: string) => void;
  message: string;
  setMessage: (val: string) => void;
  loading: boolean;
  handleReset: () => void;
}) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) {
          setMessage("");
          setEmail("");
        }
      }}
    >
      <DialogContent className="sm:max-w-[425px] rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-white/20 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Passwort vergessen?</DialogTitle>
          <DialogDescription>
            Geben Sie Ihre E-Mail-Adresse ein. Wenn ein Konto existiert, erhalten Sie einen Link zum Zurücksetzen.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Label htmlFor="reset-email" className="text-xs font-semibold tracking-wider uppercase text-slate-500">
            Ihre E-Mail-Adresse
          </Label>
          <Input
            id="reset-email"
            type="email"
            placeholder="mail@beispiel.de"
            className="mt-2 bg-slate-50 dark:bg-slate-950/50 rounded-xl"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {message && (
            <p
              className={`mt-3 text-sm font-medium p-3 rounded-lg ${
                message.includes("Fehler")
                  ? "bg-red-50 text-red-600 dark:bg-red-950/30"
                  : "bg-green-50 text-green-600 dark:bg-green-950/30"
              }`}
            >
              {message}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setIsOpen(false)}
            className="rounded-xl border-slate-200 hover:bg-slate-100 dark:border-slate-800 dark:hover:bg-slate-800"
          >
            Abbrechen
          </Button>
          <Button onClick={handleReset} disabled={loading || !email} className="rounded-xl shadow-md">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Link anfordern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
