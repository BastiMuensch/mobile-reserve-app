"use client";

import { useAuth } from "./AuthProvider";
import Image from "next/image";
import { LogOut, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePathname } from "next/navigation";

export function Navbar() {
  const { user, logout } = useAuth();
  const pathname = usePathname();

  if (!user || pathname.startsWith('/schulamt')) return null;

  let roleColorClass = "text-primary";
  if (user.role === "TEACHER") {
    roleColorClass = "text-orange-500";
  } else if (user.role === "SCHOOL") {
    roleColorClass = "text-blue-600 dark:text-blue-500";
  }

  return (
    <nav aria-label="Konto" className="w-full mx-auto sticky top-0 z-50 border-b border-border bg-card px-4 sm:px-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between h-16 items-center">
          <div className={`flex items-center gap-2 font-bold text-xl tracking-tight ${roleColorClass}`}>
            <Image src="/logo_transparent.png" alt="MobileReserve.digital Logo" width={32} height={32} className="h-8 w-auto drop-shadow-md transition-all duration-300" priority />
            <span>MobileReserve<span className="text-foreground">.digital</span></span>
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
                  aria-label="Dunkelmodus umschalten"
                  title="Dunkelmodus umschalten"
                >
                  <Sun className="h-5 w-5 hidden dark:block text-muted-foreground hover:text-amber-400" />
                  <Moon className="h-5 w-5 block dark:hidden text-muted-foreground hover:text-primary" />
                </Button>
                <div className="hidden lg:flex flex-col text-right gap-0.5">
                  <span className="text-sm font-semibold text-foreground">
                    {user.role === "SCHULAMT" ? (user.name || "Schulamt") : user.school?.name}
                  </span>
                  <span className="text-xs text-muted-foreground font-medium">
                    {user.email || 'Angemeldet'}
                  </span>
                </div>
                <Button variant="ghost" size="icon" onClick={() => logout()} aria-label="Abmelden" title="Abmelden" className="hover:bg-red-500/10 hover:text-red-500 rounded-xl transition-all duration-300">
                  <LogOut className="h-5 w-5 text-muted-foreground hover:text-red-500 transition-colors" />
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </nav>
  );
}
