"use client";
import React, { createContext, useContext, useState, useEffect } from "react";
import { AssignmentData } from "@/types/models";
import { handleUnauthorized } from "@/lib/authClient";

export type AuthUser = {
  id: string;
  email: string;
  name?: string;
  role: string;
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchUser = async () => {
    try {
      const res = await fetch(`/api/auth/me?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 401) {
          setUser(null);
          handleUnauthorized();
          return;
        }
        throw new Error("Not logged in");
      }
      const data = await res.json();
      if (data.user) setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Check if user is logged in on mount.
    // Notice: We intentionally do NOT listen to 'app-refresh' here, preventing periodic /api/auth/me queries.
    fetchUser();
  }, []);

  const login = async (credentials: { email?: string; password: string }) => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      });

      if (res.ok) {
        const data = await res.json();
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
    // On a shared device (e.g. a school tablet) a lingering PushSubscription would keep sending
    // the logged-out teacher's assignment pushes - including the school name - to whoever uses
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
          await fetchWithin('/api/push/unsubscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          }, 2_000);
          await settleWithin(subscription.unsubscribe(), 2_000);
        }
      }
    } catch (err) {
      console.error('Push cleanup on logout failed:', err);
    }

    try {
      await fetchWithin("/api/auth/logout", { method: "POST" }, 5_000);
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setUser(null);
      if (typeof window !== 'undefined') {
        window.location.replace('/');
      }
    }
  };

  return (
    <AuthContext.Provider value={{ user, setUser, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
