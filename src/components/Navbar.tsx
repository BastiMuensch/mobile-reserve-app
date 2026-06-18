"use client";

import { useAuth } from "./AuthProvider";
import Image from "next/image";
import { LogOut, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Navbar() {
  const { user, logout } = useAuth();

  if (!user) return null;

  let roleColorClass = "text-primary";
  if (user.role === "TEACHER") {
    roleColorClass = "text-orange-500";
  } else if (user.role === "SCHOOL") {
    roleColorClass = "text-blue-600 dark:text-blue-500";
  }

  return (
    <nav className="w-full max-w-7xl mx-auto mt-4 mb-6 sm:mb-10 sticky top-4 z-50 px-2 sm:px-4 lg:px-6">
      <div className="glass-panel rounded-2xl shadow-xl px-4 sm:px-6">
        <div className="flex justify-between h-16 items-center">
          <div className={`flex items-center gap-2 font-bold text-xl tracking-tight ${roleColorClass}`}>
            <Image src="/logo_transparent.png" alt="Mobile.Digital Logo" width={32} height={32} className="h-8 w-auto drop-shadow-md transition-all duration-300" priority />
            <span>Mobile<span className="text-foreground">.Digital</span></span>
          </div>
          
          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-2 sm:gap-4">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    const isDark = document.documentElement.classList.contains('dark');
                    if (isDark) {
                      document.documentElement.classList.remove('dark');
                      localStorage.theme = 'light';
                    } else {
                      document.documentElement.classList.add('dark');
                      localStorage.theme = 'dark';
                    }
                    // trigger re-render of this icon
                    window.dispatchEvent(new Event('theme-change'));
                  }}
                  className="rounded-xl transition-all duration-300"
                  title="Dunkelmodus umschalten"
                >
                  <Sun className="h-5 w-5 hidden dark:block text-slate-400 hover:text-amber-400" />
                  <Moon className="h-5 w-5 block dark:hidden text-slate-500 hover:text-indigo-500" />
                </Button>
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
