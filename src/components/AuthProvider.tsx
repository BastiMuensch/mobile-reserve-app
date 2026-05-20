"use client";
import React, { createContext, useContext, useState, useEffect } from "react";

type AuthUser = {
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
    assignments?: any[];
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
      return false;
    } catch (err) {
      return false;
    }
  };

  const logout = async () => {
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
