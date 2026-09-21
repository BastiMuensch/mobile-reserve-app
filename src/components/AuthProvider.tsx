"use client";
import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { AssignmentData } from "@/types/models";
import { handleUnauthorized } from "@/lib/authClient";
import { revokePushSubscription } from '@/lib/pushLogout';
import { ChangePasswordForm } from '@/components/auth/ChangePasswordForm';

export type AuthUser = {
  id: string;
  email: string;
  name?: string;
  role: string;
  mustChangePassword?: boolean;
  schoolId: string | null;
  teacherId: string | null;
  school?: {
    id: string;
    name: string;
    type: string;
    latitude: number;
    longitude: number;
    generalInfo?: string | null;
    imageUrl?: string | null;
    pinLat?: number | null;
    pinLng?: number | null;
    entranceLat?: number | null;
    entranceLng?: number | null;
    parkingLat?: number | null;
    parkingLng?: number | null;
  };
  teachers?: {
    id: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    stammschuleId: string;
    maxWeeklyHours: number;
    qualifications: string;
    status: string;
    schoolYear: string;
    assignments?: AssignmentData[];
  }[];
};

type AuthContextType = {
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
  login: (credentials: { email?: string; password: string }) => Promise<boolean>;
  logout: () => Promise<void>;
  isLoading: boolean;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  setUser: () => {},
  login: async () => false,
  logout: async () => {},
  isLoading: true,
});

async function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function fetchWithin(url: string, init: RequestInit, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function readFlag(key: string) {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function writeFlag(key: string, enabled: boolean) {
  try { if (enabled) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [logoutWarning, setLogoutWarning] = useState(false);
  const [pushWarning, setPushWarning] = useState(false);
  const authGeneration = useRef(0);

  const fetchUser = async () => {
    const generation = authGeneration.current;
    try {
      setPushWarning(readFlag('reserve-push-cleanup-warning'));
      if (readFlag('reserve-logout-pending')) {
        const result = await fetchWithin('/api/auth/logout', { method: 'POST' }, 5000);
        if (!result?.ok) { setUser(null); setLogoutWarning(true); return; }
        writeFlag('reserve-logout-pending', false);
        setLogoutWarning(false);
      }
      const res = await fetch(`/api/auth/me?t=${Date.now()}`, { cache: "no-store" });
      if (generation !== authGeneration.current) return;
      if (!res.ok) {
        if (res.status === 401) {
          setUser(null);
          handleUnauthorized();
          return;
        }
        throw new Error("Not logged in");
      }
      const data = await res.json();
      if (data.user && generation === authGeneration.current) setUser(data.user);
    } catch {
      if (generation === authGeneration.current) setUser(null);
    } finally {
      if (generation === authGeneration.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    const invalidateAuth = () => {
      // Also invalidates a pending /api/auth/me response from another tab's
      // logout or any dashboard 401, so it cannot rehydrate stale UI state.
      authGeneration.current += 1;
      setUser(null);
      setIsLoading(false);
    };
    window.addEventListener('auth-invalidated', invalidateAuth);
    return () => window.removeEventListener('auth-invalidated', invalidateAuth);
  }, []);

  useEffect(() => {
    // Check if user is logged in on mount.
    // Notice: We intentionally do NOT listen to 'app-refresh' here, preventing periodic /api/auth/me queries.
    fetchUser();
  }, []);

  const login = async (credentials: { email?: string; password: string }) => {
    const generation = ++authGeneration.current;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      });

      if (res.ok) {
        const data = await res.json();
        if (generation !== authGeneration.current) return false;
        writeFlag('reserve-logout-pending', false);
        setLogoutWarning(false);
        setUser(data.user);
        return true;
      }
      const errData = await res.json();
      throw new Error(errData.error || "Ungültige Zugangsdaten");
    } catch (error) {
      throw error;
    }
  };

  const logout = async () => {
    authGeneration.current += 1;
    setUser(null);
    // On a shared device (e.g. a school tablet) a lingering PushSubscription would keep sending
    // the logged-out teacher's generic assignment notifications to whoever uses
    // the device next. So we tear down the push subscription first, while the session cookie is
    // still valid (the unsubscribe endpoint needs it to verify ownership of the subscription).
    // Any failure here (no SW, no subscription, offline, ...) must never block the actual logout.
    try {
      if ('serviceWorker' in navigator) {
        // navigator.serviceWorker.ready never rejects and only resolves once a service worker
        // is actually active - if one was never registered (e.g. push unsupported/declined) it
        // would hang forever, so race it against a short timeout rather than block logout.
        const registration = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<null>(resolve => setTimeout(() => resolve(null), 2000)),
        ]);
        const subscription = registration
          ? await settleWithin(registration.pushManager.getSubscription(), 2_000)
          : null;
        if (subscription) {
          const revoked = await revokePushSubscription({ endpoint: subscription.endpoint,
            unsubscribe: async () => Boolean(await settleWithin(subscription.unsubscribe(), 2_000)) },
          async endpoint => Boolean((await fetchWithin('/api/push/unsubscribe', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint }),
            }, 2_000))?.ok));
          writeFlag('reserve-push-cleanup-warning', !revoked);
        }
      }
    } catch (err) {
      writeFlag('reserve-push-cleanup-warning', true);
      console.error('Push cleanup on logout failed:', err);
    }

    try {
      writeFlag('reserve-logout-pending', true);
      const result = await fetchWithin("/api/auth/logout", { method: "POST" }, 5_000);
      if (result?.ok) writeFlag('reserve-logout-pending', false);
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setUser(null);
      if (typeof window !== 'undefined') {
        window.location.replace('/');
      }
    }
  };

  const retryLocalPushCleanup = async () => {
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (subscription && !await subscription.unsubscribe()) return;
      writeFlag('reserve-push-cleanup-warning', false);
      setPushWarning(false);
    } catch { /* Keep the visible warning until revocation succeeds. */ }
  };

  return (
    <AuthContext.Provider value={{ user, setUser, login, logout, isLoading }}>
      {pushWarning && <div role="alert" className="border-b border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        Die Geräte-Benachrichtigungen konnten bei der Abmeldung nicht vollständig deaktiviert werden. Auf gemeinsam genutzten Geräten bitte erneut versuchen oder die Benachrichtigungsberechtigung dieser Website im Browser entfernen.
        <button type="button" className="ml-3 underline font-semibold" onClick={() => void retryLocalPushCleanup()}>Geräte-Benachrichtigungen deaktivieren</button>
      </div>}
      {logoutWarning && <div role="alert" className="border-b border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        Die Abmeldung konnte vom Server noch nicht bestätigt werden. Auf gemeinsam genutzten Geräten bitte die Verbindung wiederherstellen und erneut versuchen.
        <button type="button" className="ml-3 underline font-semibold" onClick={() => void fetchUser()}>Abmeldung erneut versuchen</button>
      </div>}
      {user?.mustChangePassword ? <ChangePasswordForm required /> : children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
