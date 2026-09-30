"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { isAppleMobileDevice, isPushRegistered, readyPushRegistration, registerDevicePush } from "@/lib/pushClient";

export function SchoolPushSettings({ userId }: { userId: string }) {
  const { toast } = useToast();
  const [mounted, setMounted] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);

  useEffect(() => setMounted(true), []);
  const isIOS = mounted && isAppleMobileDevice(navigator.userAgent, navigator.maxTouchPoints);
  const standalone = mounted && (window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);
  const supported = mounted && window.isSecureContext && 'serviceWorker' in navigator &&
    'PushManager' in window && 'Notification' in window && (!isIOS || standalone);

  useEffect(() => {
    if (!supported) return;
    let disposed = false;
    let inFlight = false;
    async function check() {
      if (inFlight || busy.current || document.visibilityState === 'hidden') return;
      inFlight = true;
      setChecking(true);
      setEnabled(false);
      setError("");
      try {
        const registration = await readyPushRegistration(navigator.serviceWorker);
        const subscription = await registration.pushManager.getSubscription();
        const registered = Notification.permission === 'granted' && await isPushRegistered(subscription);
        if (!disposed) setEnabled(registered);
      } catch {
        if (!disposed) setError('Push-Status konnte nicht bestätigt werden. Bitte prüfen Sie Ihre Verbindung und aktivieren Sie Push erneut.');
      } finally {
        inFlight = false;
        if (!disposed) setChecking(false);
      }
    }
    void check();
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      disposed = true;
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [supported, userId]);

  async function subscribe() {
    if (!supported || busy.current || checking) return;
    busy.current = true;
    setLoading(true);
    setEnabled(false);
    setError("");
    try {
      // Permission must be requested directly from the button's user gesture.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setError(permission === 'denied'
          ? 'Mitteilungen sind blockiert. Bitte erlauben Sie diese in den Geräte- oder Browser-Einstellungen und tippen Sie danach erneut auf „Push aktivieren“.'
          : 'Mitteilungen wurden nicht erlaubt. Sie können Push jederzeit erneut aktivieren.');
        return;
      }
      const registration = await readyPushRegistration(navigator.serviceWorker);
      const { warning } = await registerDevicePush(registration);
      setEnabled(true);
      toast({
        variant: warning ? "info" : "success",
        title: warning ? "Push-Abo gespeichert – Testnachricht fehlgeschlagen" : "Push-Benachrichtigungen aktiviert",
        description: warning || "Ihre Schule wird auf diesem Gerät über neue Zuweisungen informiert.",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Push konnte nicht aktiviert werden. Bitte versuchen Sie es erneut.');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }

  return (
    <section aria-label="Push-Benachrichtigungen" className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><Bell className="h-4 w-4 text-primary" /> Neue Zuweisungen direkt erfahren</h2>
          <p className="mt-1 text-sm text-muted-foreground">Erhalten Sie eine Push-Nachricht, sobald Ihrer Schule eine Lehrkraft zugewiesen wird. Details sehen Sie in der App.</p>
        </div>
        {supported && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {enabled && <span role="status" className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400"><BellRing className="h-4 w-4" /> Push aktiv</span>}
            <Button variant="outline" onClick={subscribe} disabled={loading || checking}>
              {loading ? 'Wird aktiviert…' : checking ? 'Push wird geprüft…' : enabled ? 'Testnachricht senden' : 'Push aktivieren'}
            </Button>
          </div>
        )}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-amber-700 dark:text-amber-400">{error}</p>}
      {isIOS && !standalone && <p className="mt-3 text-sm text-muted-foreground">Öffnen Sie diese Seite in Safari und wählen Sie „Teilen“ → „Zum Home-Bildschirm“. Starten Sie die installierte App, melden Sie sich an und tippen Sie auf „Push aktivieren“. Dafür benötigen Sie mindestens iOS/iPadOS 16.4.</p>}
      {mounted && !supported && (!isIOS || standalone) && <p role="status" className="mt-3 text-sm text-muted-foreground">Push ist in diesem Browser nicht verfügbar. Verwenden Sie einen Browser mit Push-Unterstützung und eine sichere HTTPS-Verbindung. Auf iPhone und iPad benötigen Sie die installierte App und mindestens iOS/iPadOS 16.4.</p>}
    </section>
  );
}
