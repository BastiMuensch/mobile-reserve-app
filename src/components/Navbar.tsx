"use client";

import { useAuth } from "./AuthProvider";
import { LogOut, User as UserIcon, MapPin, School, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Navbar() {
  const { user, logout } = useAuth();

  return (
    <nav className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <div className="flex items-center gap-2 font-bold text-xl tracking-tight text-blue-600 dark:text-blue-400">
            <GraduationCap className="h-6 w-6" />
            <span>Mobile<span className="text-slate-900 dark:text-white">Reserven</span></span>
          </div>
          
          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-4">
                <div className="hidden sm:flex flex-col text-right">
                  <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {user.role === "SCHULAMT" ? "Schulamt Unterallgäu" : user.school?.name}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {user.email || 'Angemeldet'}
                  </span>
                </div>
                <Button variant="ghost" size="icon" onClick={() => logout()} title="Abmelden">
                  <LogOut className="h-5 w-5 text-slate-500 hover:text-red-500" />
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </nav>
  );
}
