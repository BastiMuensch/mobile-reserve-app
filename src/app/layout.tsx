import type { Metadata } from "next";
import { Rubik } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { Navbar } from "@/components/Navbar";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ToastProvider } from "@/components/ui/toast";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";

const rubik = Rubik({
  subsets: ["latin"],
  variable: "--font-rubik",
});

export const metadata: Metadata = {
  title: "MobileReserve.digital",
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
      className={`h-full antialiased ${rubik.variable}`}
      suppressHydrationWarning
    >
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#f5fcfb" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#010806" media="(prefers-color-scheme: dark)" />
        <link rel="apple-touch-icon" href="/logo_transparent.png" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                  document.documentElement.classList.add('dark');
                } else {
                  document.documentElement.classList.remove('dark');
                }
              } catch (_) {}

              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').then(
                    function(registration) {
                      console.log('ServiceWorker registration successful with scope: ', registration.scope);
                    },
                    function(err) {
                      console.log('ServiceWorker registration failed: ', err);
                    }
                  );
                });
              }
            `,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ToastProvider>
          <ConfirmProvider>
            <AuthProvider>
              <AutoRefresh />
              <Navbar />
              <main className="flex-1 w-full mx-auto max-w-7xl p-4 sm:p-6 lg:p-8 flex flex-col">
                <ErrorBoundary>
                  {children}
                </ErrorBoundary>
              </main>
              <footer className="w-full py-6 text-center text-xs text-muted-foreground">
                &copy; {new Date().getFullYear()} Sebastian Münsch. Lizenziert unter <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground transition-colors">AGPL-3.0</a>.
              </footer>
            </AuthProvider>
          </ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
