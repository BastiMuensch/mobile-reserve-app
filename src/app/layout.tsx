import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { Navbar } from "@/components/Navbar";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const outfit = Outfit({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mobile.Digital",
  description: "Bavarian Substitute Teacher Management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="de"
      className={`${outfit.className} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-50">
        <AuthProvider>
          <AutoRefresh />
          <Navbar />
          <main className="flex-1 w-full mx-auto max-w-7xl p-4 sm:p-6 lg:p-8 flex flex-col">
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
          </main>
          <footer className="w-full py-6 text-center text-xs text-slate-400 dark:text-slate-500">
            &copy; {new Date().getFullYear()} Sebastian Münsch. Lizenziert unter <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-600 dark:hover:text-slate-300 transition-colors">AGPL-3.0</a>.
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
