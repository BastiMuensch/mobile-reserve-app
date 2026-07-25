import type { NextConfig } from "next";

// 'unsafe-eval' wird von React/Next.js nur im Dev-Modus benötigt (zum
// Rekonstruieren von Server-Error-Stacks im Browser). In Production
// verwenden weder React noch Next.js eval, daher hier deaktiviert.
// Siehe node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md
const isDev = process.env.NODE_ENV !== 'production';

// 'unsafe-inline' für script-src ist weiterhin nötig für das Inline-Theme-
// Script in src/app/layout.tsx (verhindert Flash-of-wrong-Theme, muss vor
// dem ersten Paint laufen). Nächster Schritt zur Härtung: Umstellung auf
// eine Nonce-basierte CSP über eine Proxy-Funktion (proxy.ts), die bei
// jedem Request einen frischen Nonce generiert und dynamisches Rendering
// erfordert. 'unsafe-inline' für style-src wird von Tailwind/inline styles
// benötigt.
const scriptSrc = `'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`;

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            // Schriften werden über next/font selbst gehostet ('self'), daher
            // keine fonts.googleapis.com / fonts.gstatic.com Einträge mehr nötig.
            value: `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com https://unpkg.com https://raw.githubusercontent.com https://cdnjs.cloudflare.com; connect-src 'self' https://nominatim.openstreetmap.org; frame-ancestors 'none'`,
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
