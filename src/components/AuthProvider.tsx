"use client";
import React, { createContext, useContext, useState, useEffect } from "react";
import { AssignmentData } from "@/types/models";

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchUser = async () => {
    try {
      const res = await fetch(`/api/auth/me?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Not logged in");
      const data = await res.json();
      if (data.user) setUser(data.user);
    } catch (err) {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Check if user is logged in
    fetchUser();

    const handleRefresh = () => fetchUser();
    window.addEventListener('app-refresh', handleRefresh);
    return () => window.removeEventListener('app-refresh', handleRefresh);
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
        const subscription = registration ? await registration.pushManager.getSubscription() : null;
        if (subscription) {
          await fetch('/api/push/unsubscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          }).catch(err => console.error('Failed to unsubscribe push on logout:', err));
          await subscription.unsubscribe().catch(err => console.error('Failed to unsubscribe local push subscription:', err));
        }
      }
    } catch (err) {
      console.error('Push cleanup on logout failed:', err);
    }

    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setUser(null);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <AuthContext.Provider value={{ user, setUser, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
