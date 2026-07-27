/**
 * Erzeugt die Screenshots für die Werbeseite aus der laufenden Anwendung.
 *
 * Voraussetzung: Die App läuft mit Musterdaten (prisma/seed-musterstadt.ts) unter
 * der URL aus APP_URL. Aufruf:
 *
 *   APP_URL=http://localhost:3100 npm run screenshots
 *
 * Die Bilder landen in ./img und werden von index.html eingebunden.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const APP = process.env.APP_URL || 'http://localhost:3100';
const OUT = new URL('./img/', import.meta.url).pathname;

// Zugänge aus prisma/seed-musterstadt.ts. Den Lehrkraft-Zugang legt der Seed nicht an;
// er wird für die Aufnahmen ergänzt (siehe README in diesem Ordner).
const KONTEN = {
  schulamt: { email: 'admin@schulamt-musterstadt.de', pass: 'musterstadt123' },
  schule: { email: 'marktplatz@musterstadt.de', pass: 'schule123' },
  lehrkraft: { email: 'lehrkraft@musterstadt.de', pass: 'lehrkraft123' },
};

async function anmelden(page, konto) {
  await page.goto(APP, { waitUntil: 'networkidle' });
  // Abmelden, falls noch eine Sitzung aktiv ist
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }).catch(() => {}));
  const ok = await page.evaluate(async (k) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: k.email, password: k.pass }),
    });
    return r.ok;
  }, konto);
  if (!ok) throw new Error(`Anmeldung fehlgeschlagen für ${konto.email}`);
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
}

async function abmelden(page) {
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }).catch(() => {}));
}

(async () => {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();

  // Desktop-Aufnahmen
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'de-DE' });
  const page = await ctx.newPage();

  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}login.png` });
  console.log('✓ login.png');

  for (const [name, konto] of Object.entries(KONTEN)) {
    await anmelden(page, konto);
    await page.screenshot({ path: `${OUT}${name}.png` });
    console.log(`✓ ${name}.png`);
    await abmelden(page);
  }

  await ctx.close();

  // Mobile Aufnahme der Lehrkraft-Ansicht
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'de-DE' });
  const mpage = await mob.newPage();
  await anmelden(mpage, KONTEN.lehrkraft);
  await mpage.screenshot({ path: `${OUT}lehrkraft-mobil.png` });
  console.log('✓ lehrkraft-mobil.png');
  await mob.close();

  await browser.close();
  console.log('\nAlle Screenshots liegen in landing/img/');
})();
