import type { Metadata } from "next";
import { headers } from "next/headers";
import "@fontsource/rubik/latin.css";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { Navbar } from "@/components/Navbar";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ToastProvider } from "@/components/ui/toast";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { AppFrame } from "@/components/AppFrame";

export const metadata: Metadata = {
  title: "MobileReserve.digital",
  description: "Bavarian Substitute Teacher Management",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="de"
      data-scroll-behavior="smooth"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#f5fcfb" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#010806" media="(prefers-color-scheme: dark)" />
        <link rel="apple-touch-icon" href="/logo_transparent.png" />
        <script
          nonce={nonce}
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
              <AppFrame>
                <ErrorBoundary>
                  {children}
                </ErrorBoundary>
              </AppFrame>
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
