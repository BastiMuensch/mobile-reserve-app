"use client";

import { useEffect, useState } from "react";
import { Copy, Link2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

type Invitation = {
  id: string;
  recipientEmail: string;
  expiresAt: string;
  createdAt: string;
  status: "ACTIVE" | "EXPIRED" | "REVOKED" | "COMPLETED";
};

const DURATION_OPTIONS = [
  { value: "1", label: "1 Tag" },
  { value: "3", label: "3 Tage" },
  { value: "7", label: "7 Tage" },
  { value: "14", label: "14 Tage" },
  { value: "30", label: "30 Tage" },
  { value: "60", label: "60 Tage" },
  { value: "90", label: "90 Tage" },
];

function formatDate(date: string) {
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(date));
}

interface TeacherInvitationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TeacherInvitationDialog({ open, onOpenChange }: TeacherInvitationDialogProps) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [duration, setDuration] = useState("14");
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [registrationLink, setRegistrationLink] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [renewingId, setRenewingId] = useState<string | null>(null);

  const loadInvitations = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/teacher-invitations", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setInvitations(data.invitations || []);
      setDuration(String(data.defaultValidityDays || 14));
    } catch {
      toast({ variant: "error", title: "Einladungen konnten nicht geladen werden." });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (open) void loadInvitations();
    // loadInvitations uses the current toast instance and is intentionally only
    // invoked when the dialog is opened, not after every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const copyLink = async (link = registrationLink) => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast({ variant: "success", title: "Einladungslink wurde kopiert." });
    } catch {
      toast({ variant: "error", title: "Link konnte nicht automatisch kopiert werden. Bitte markieren und kopieren Sie ihn manuell." });
    }
  };

  const createInvitation = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsCreating(true);
    try {
      const response = await fetch("/api/teacher-invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientEmail: email, validityDays: Number(duration) }),
      });
      const data = await response.json();
      if (!response.ok) {
        toast({ variant: "error", title: data.error || "Einladung konnte nicht erstellt werden." });
        return;
      }
      setRegistrationLink(data.registrationLink);
      setEmail("");
      toast({
        variant: "success",
        title: data.mailSent ? "Einladung erstellt und per E-Mail versendet." : "Einladung erstellt. Bitte kopieren Sie den Link für die Lehrkraft.",
      });
      await loadInvitations();
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler beim Erstellen der Einladung." });
    } finally {
      setIsCreating(false);
    }
  };

  const renewInvitation = async (id: string) => {
    setRenewingId(id);
    try {
      const response = await fetch(`/api/teacher-invitations/${id}/renew`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ validityDays: Number(duration) }),
      });
      const data = await response.json();
      if (!response.ok) {
        toast({ variant: "error", title: data.error || "Einladung konnte nicht erneuert werden." });
        return;
      }
      setRegistrationLink(data.registrationLink);
      toast({ variant: "success", title: data.mailSent ? "Einladung erneuert und per E-Mail versendet." : "Einladung erneuert. Bitte kopieren Sie den neuen Link." });
      await loadInvitations();
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler beim Erneuern der Einladung." });
    } finally {
      setRenewingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mobile Reserve einladen</DialogTitle>
          <DialogDescription>
            Jede Einladung ist an eine dienstliche E-Mail-Adresse gebunden, zeitlich begrenzt und nur einmal einlösbar.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={createInvitation} className="grid gap-4 border-y border-border py-4">
          <div className="grid gap-2">
            <Label htmlFor="invitation-email">Dienstliche E-Mail-Adresse</Label>
            <Input id="invitation-email" type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="max.mustermann@schule.bayern.de" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="invitation-duration">Gültigkeit</Label>
            <Select value={duration} onValueChange={value => value && setDuration(value)}>
              <SelectTrigger id="invitation-duration"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DURATION_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={isCreating}>
            <Link2 /> {isCreating ? "Einladung wird erstellt..." : "Einladungslink erstellen"}
          </Button>
        </form>

        {registrationLink && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
            <p className="text-sm font-medium">Neuer Einladungslink</p>
            <div className="flex gap-2">
              <Input aria-label="Einladungslink" value={registrationLink} readOnly className="text-xs" />
              <Button type="button" variant="outline" size="icon" aria-label="Einladungslink kopieren" onClick={() => void copyLink()}><Copy /></Button>
            </div>
            <p className="text-xs text-muted-foreground">Der Link enthält ein Geheimnis. Bitte nur über einen sicheren Kanal weitergeben.</p>
          </div>
        )}

        <div className="space-y-2">
          <h3 className="font-medium">Letzte Einladungen</h3>
          {isLoading ? <p className="text-sm text-muted-foreground">Wird geladen...</p> : invitations.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch keine Einladungen vorhanden.</p>
          ) : (
            <div className="space-y-2">
              {invitations.map(invitation => (
                <div key={invitation.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">{invitation.recipientEmail}</p>
                    <p className="text-xs text-muted-foreground">
                      {invitation.status === "ACTIVE" ? `Gültig bis ${formatDate(invitation.expiresAt)}` :
                        invitation.status === "COMPLETED" ? "Eingelöst" :
                        invitation.status === "EXPIRED" ? "Abgelaufen" : "Ersetzt"}
                    </p>
                  </div>
                  {invitation.status !== "COMPLETED" && (
                    <Button type="button" variant="outline" size="sm" disabled={renewingId === invitation.id} onClick={() => void renewInvitation(invitation.id)}>
                      <RefreshCw /> {renewingId === invitation.id ? "Erneuert..." : "Erneuern"}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
