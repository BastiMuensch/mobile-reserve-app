"use client";

import { usePathname } from "next/navigation";
import { ReactNode } from "react";

/** The authority owns its sidebar; other roles retain their compact top navigation. */
export function AppFrame({ children }: { children: ReactNode }) {
  const isAuthority = usePathname().startsWith('/schulamt');
  return <main id="main-content" className={isAuthority
    ? 'flex-1 w-full'
    : 'flex-1 w-full mx-auto max-w-7xl p-4 sm:p-6 lg:p-8 flex flex-col'}>{children}</main>;
}
