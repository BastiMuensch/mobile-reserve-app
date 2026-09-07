"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { Mail, RefreshCw, AlertCircle, CheckCircle2, Clock } from "lucide-react";

interface OutboxItem {
  id: string;
  to: string | null;
  subject: string | null;
  status: "PENDING" | "SENDING" | "SENT" | "FAILED";
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  nextAttemptAt: string;
  sentAt: string | null;
  createdAt: string;
  retryAvailable: boolean;
}

export function EmailOutboxPanel() {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchOutbox = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/schulamt/email-outbox");
      if (!res.ok) throw new Error("Fehler beim Laden der Outbox");
      const data = await res.json();
      setItems(data);
      setHasLoaded(true);
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Der E-Mail-Ausgang konnte nicht geladen werden. Bitte erneut aktualisieren.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOutbox();
  }, []);

  const handleRetry = async (id: string) => {
    setRetryingId(id);
    try {
      const res = await fetch("/api/schulamt/email-outbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry", id }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Wiederholung fehlgeschlagen");
      }
      toast({ variant: "success", title: "E-Mail zur Wiederholung eingeplant." });
      await fetchOutbox();
    } catch (err) {
      toast({
        variant: "error",
        title: "Fehler",
        description: err instanceof Error ? err.message : "Wiederholung fehlgeschlagen",
      });
    } finally {
      setRetryingId(null);
    }
  };

  const getStatusBadge = (status: OutboxItem["status"]) => {
    switch (status) {
      case "SENT":
        return (
          <Badge variant="outline" className="text-green-600 border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/40">
            <CheckCircle2 className="h-3 w-3 mr-1" /> Gesendet
          </Badge>
        );
      case "SENDING":
        return (
          <Badge variant="outline" className="text-blue-600 border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 animate-pulse">
            <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Wird gesendet
          </Badge>
        );
      case "PENDING":
        return (
          <Badge variant="outline" className="text-amber-600 border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40">
            <Clock className="h-3 w-3 mr-1" /> Ausstehend
          </Badge>
        );
      case "FAILED":
        return (
          <Badge variant="outline" className="text-destructive border-destructive/30 bg-destructive/10">
            <AlertCircle className="h-3 w-3 mr-1" /> Fehlgeschlagen
          </Badge>
        );
    }
  };

  return (
    <Card id="email-outbox" className="scroll-mt-6 border-border/70 bg-white py-5 dark:bg-card">
      <CardHeader className="flex flex-col gap-4 px-5 pb-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" /> E-Mail-Ausgang (Outbox)
          </CardTitle>
          <CardDescription>
            Automatisch verwaltete Warteschlange für den zuverlässigen Mailversand mit automatischen Wiederholungsversuchen.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchOutbox}
          disabled={loading}
          className="h-8"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Aktualisieren
        </Button>
      </CardHeader>
      <CardContent className="px-5 sm:px-6">
        {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
        {!hasLoaded ? <p role="status" className="text-muted-foreground py-4">{loading ? 'E-Mail-Ausgang wird geladen …' : 'Noch keine Versanddaten geladen.'}</p> : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Keine E-Mails in der Ausgangswarteschlange vorhanden.
          </p>
        ) : (
          <div className="divide-y divide-border rounded-md border text-sm">
            {items.map((item) => (
              <div key={item.id} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-foreground break-words">{item.subject ?? (item.status === 'SENT' ? 'Inhalt nach Versand gelöscht' : 'Kein erneut versendbarer Inhalt vorhanden')}</span>
                    {getStatusBadge(item.status)}
                    <span className="text-xs text-muted-foreground">
                      ({item.attempts}/{item.maxAttempts} Versuche)
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-3">
                    <span>Empfänger: {item.to ?? (item.status === 'SENT' ? 'nach Versand gelöscht' : 'nicht mehr verfügbar')}</span>
                    <span>Erstellt: {new Date(item.createdAt).toLocaleString("de-DE")}</span>
                  </div>
                  {item.lastError && item.status === "FAILED" && (
                    <p className="text-xs text-destructive mt-1 font-mono break-words">
                      Fehler: {item.lastError}
                    </p>
                  )}
                </div>
                {item.status === "FAILED" && item.retryAvailable && (
                  <div className="shrink-0 pt-2 sm:pt-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRetry(item.id)}
                      disabled={retryingId === item.id}
                      className="h-7 text-xs"
                    >
                      {retryingId === item.id ? "Wird eingeplant …" : "Erneut versuchen"}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
