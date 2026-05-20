"use client";

import { useAuth } from "./AuthProvider";
import { LogOut, User as UserIcon, MapPin, School, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Navbar() {
  const { user, logout } = useAuth();

  if (!user) return null;

  return (
    <nav className="w-full max-w-7xl mx-auto mt-4 mb-6 sm:mb-10 sticky top-4 z-50 px-2 sm:px-4 lg:px-6">
      <div className="glass-panel rounded-2xl shadow-xl px-4 sm:px-6">
        <div className="flex justify-between h-16 items-center">
          <div className="flex items-center gap-2 font-bold text-xl tracking-tight text-primary">
            <GraduationCap className="h-6 w-6 text-primary animate-pulse" />
            <span>Mobile<span className="text-foreground">Reserven</span></span>
          </div>
          
          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-4">
                <div className="hidden lg:flex flex-col text-right gap-0.5">
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {user.role === "SCHULAMT" ? (user.name || "Schulamt") : user.school?.name}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">
                    {user.email || 'Angemeldet'}
                  </span>
                </div>
                <Button variant="ghost" size="icon" onClick={() => logout()} aria-label="Abmelden" title="Abmelden" className="hover:bg-red-500/10 hover:text-red-500 rounded-xl transition-all duration-300">
                  <LogOut className="h-5 w-5 text-slate-500 hover:text-red-500 transition-colors" />
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </nav>
  );
}
