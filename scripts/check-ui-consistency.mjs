// Read-only UI checks against synthetic local accounts; no business form is submitted.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:3118';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = path.resolve('output/ui-consistency');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const errors = [];
let checks = 0;

async function checkPage(page, name) {
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(() => {
    if (document.documentElement.scrollWidth <= innerWidth + 1) return [];
    return [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1 && !el.closest('.leaflet-container')).slice(0, 8).map(el => ({ tag: el.tagName, text: el.textContent?.slice(0, 80), class: el.className }));
  });
  assert.deepEqual(overflow, [], `${name}: horizontal overflow`);
  const clipped = await page.locator('[data-slot="button"]:visible').evaluateAll(buttons => buttons.filter(el => el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2).map(el => el.textContent));
  assert.deepEqual(clipped, [], `${name}: clipped button content`);
  const extraIconMargins = await page.locator('[data-slot="button"]:visible svg').evaluateAll(icons => icons.filter(el => {
    const style = getComputedStyle(el); return style.marginLeft !== '0px' || style.marginRight !== '0px';
  }).map(el => el.parentElement?.textContent));
  assert.deepEqual(extraIconMargins, [], `${name}: icon spacing must come from the shared button gap`);
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true, animations: 'disabled' });
  checks++;
}

async function visit(page, route) {
  await page.goto(`${base}${route}`);
  await page.locator('main').waitFor();
  if (route.startsWith('/schulamt')) {
    await page.getByRole('heading', { level: 1 }).waitFor();
    await page.getByText('Daten für das ausgewählte Schuljahr werden geladen …', { exact: true }).waitFor({ state: 'hidden' });
  } else if (route === '/schule/profil') {
    await page.getByRole('button', { name: 'Profil speichern' }).waitFor();
  } else if (route === '/lehrkraft/profil') {
    await page.getByLabel('Telefon (optional)').waitFor();
  } else {
    await page.getByRole('heading', { level: 1 }).waitFor();
  }
}

try {
  for (const role of ['schulamt', 'schule1', 'reserve1']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE', colorScheme: 'light' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    // Exercise the overdue-backup case without changing stored profile data.
    if (role === 'schulamt') await page.route('**/api/schulamt/profile?**', async route => {
      const response = await route.fetch();
      const profile = await response.json();
      await route.fulfill({ response, json: { ...profile, lastBackupDate: null } });
    });
    await page.goto(base);
    if (role === 'schulamt') {
      for (const width of [1440, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.getByRole('button', { name: 'Anmelden', exact: true }).waitFor();
        await checkPage(page, `login-${width}`);
      }
    }
    await page.getByLabel('E-Mail-Adresse', { exact: true }).fill(`${role}@ui-test.local`);
    await page.getByLabel('Passwort', { exact: true }).fill('Ui-Test-Reserve-2026!');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await page.getByRole('button', { name: 'Abmelden', exact: true }).filter({ visible: true }).waitFor();
    const routes = role === 'schulamt'
      ? ['/schulamt', ...['reserven', 'schulen', 'idealbesetzung', 'statistiken', 'dokumentation', 'einstellungen'].map(p => `/schulamt/${p}`)]
      : role === 'schule1' ? ['/', '/schule/profil'] : ['/', '/lehrkraft/profil'];
    for (const width of [1920, 1440, 820, 390, 320]) {
      await page.setViewportSize({ width, height: width < 640 ? 800 : 1000 });
      for (const route of routes) {
        await visit(page, route);
        const name = `${role}-${route.split('/').filter(Boolean).join('-') || 'dashboard'}-${width}`;
        if (route === '/schulamt/reserven') {
          const actions = page.getByRole('group', { name: 'Reserven verwalten' });
          const metrics = await actions.locator('a, button').evaluateAll(elements => elements.map(el => {
            const r = el.getBoundingClientRect(), s = getComputedStyle(el), icon = el.querySelector('svg');
            return { height: r.height, width: r.width, radius: s.borderRadius, font: s.fontSize, border: s.borderTopColor, icon: icon?.getBoundingClientRect().width };
          }));
          assert.equal(metrics.length, 3);
          assert.ok(metrics.every(m => m.height === 40 && m.radius === metrics[0].radius && m.font === metrics[0].font && m.icon === 16), `Action geometry: ${JSON.stringify(metrics)}`);
          assert.ok(metrics.every(m => m.border !== 'rgba(0, 0, 0, 0)'), 'All action outlines are visible');
          if (width < 640) assert.ok(metrics.every(m => m.width === metrics[0].width), 'Mobile actions have equal width');
        }
        if (route === '/schulamt/dokumentation') {
          assert.equal(await page.getByText('Datensicherung', { exact: true }).count(), 1, 'No duplicate backup banner');
          const grid = page.getByTestId('documentation-exports');
          const cards = await grid.locator(':scope > [data-slot="card"]').evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
          assert.equal(cards.length, 2);
          assert.ok(Math.abs(cards[0].width - cards[1].width) <= 1, 'Export cards have equal width');
          if (width >= 1280) assert.equal(cards[0].y, cards[1].y, 'Desktop cards side by side');
          else assert.ok(cards[1].y > cards[0].y, 'Narrow cards stacked');
          const danger = page.locator('details').filter({ has: page.getByText('Daten endgültig löschen', { exact: true }) });
          assert.equal(await danger.getAttribute('open'), null);
          await danger.locator('summary').focus();
          await page.keyboard.press('Enter');
          await page.getByRole('button', { name: 'Endgültige Löschung vorbereiten' }).click();
          const dialog = page.getByRole('dialog');
          await dialog.waitFor();
          await assert.doesNotReject(() => page.getByLabel('Bestätigen Sie mit Ihrem Schulamt-Passwort:').waitFor());
          await checkPage(page, `${name}-reset-dialog`);
          await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
          await danger.locator('summary').click();
          assert.equal(await danger.getAttribute('open'), null);
        }
        await checkPage(page, name);
      }
    }
    if (role === 'schulamt') {
      for (const width of [1440, 320]) {
        await page.setViewportSize({ width, height: width < 640 ? 800 : 1000 });
        for (const [query, name] of [['openInvite=1', 'einladen'], ['openAdd=1', 'hinzufuegen']]) {
          await visit(page, `/schulamt/reserven?${query}`);
          await page.getByRole('dialog').waitFor();
          await checkPage(page, `dialog-${name}-${width}`);
          await page.keyboard.press('Escape');
        }
        await visit(page, '/schulamt/reserven');
        await page.getByRole('button', { name: 'Aus Vorjahr übernehmen' }).click();
        await page.getByRole('dialog').waitFor();
        await checkPage(page, `dialog-uebernahme-${width}`);
        await page.keyboard.press('Escape');
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => { localStorage.theme = 'dark'; });
    for (const route of role === 'schulamt' ? ['/schulamt/reserven', '/schulamt/dokumentation', '/schulamt/einstellungen'] : routes) {
      await visit(page, route);
      await checkPage(page, `${role}-${route.split('/').filter(Boolean).join('-') || 'dashboard'}-dark`);
    }
    await context.close();
  }
  // Public entry points: mock setup/invitation availability, never complete setup
  // or send a registration. Only local draft fields are filled for navigation.
  const publicContext = await browser.newContext({ locale: 'de-DE', colorScheme: 'light' });
  const publicPage = await publicContext.newPage();
  publicPage.on('pageerror', error => errors.push(error.message));
  // Layout-only isolation of an independently reproduced existing bug:
  // AuthProvider redirects anonymous /register/teacher and /reset visits to /.
  // This mock is NOT an authentication or invitation workflow test.
  await publicPage.route('**/api/auth/me?**', route => route.fulfill({ json: { user: null } }));
  await publicPage.route('**/api/setup/register-teacher?**', route => route.fulfill({ json: { schools: [{ id: 'ui-school', name: 'Grundschule Beispielort' }], recipientEmail: '' } }));
  for (const width of [1440, 320]) {
    await publicPage.setViewportSize({ width, height: 900 });
    await publicPage.goto(`${base}/register/teacher?token=synthetic-layout-check`);
    await publicPage.getByLabel('Vor- und Nachname').waitFor();
    await checkPage(publicPage, `registrierung-${width}`);
    await publicPage.goto(`${base}/reset?token=synthetic-layout-check`);
    await publicPage.locator('#new-password').waitFor();
    await checkPage(publicPage, `passwort-reset-${width}`);
  }
  await publicPage.route('**/api/setup/status', route => route.fulfill({ json: { needsSetup: true, setupTokenRequired: true, setupBlocked: false } }));
  for (const width of [1440, 320]) {
    await publicPage.setViewportSize({ width, height: 900 });
    await publicPage.goto(base);
    await publicPage.locator('#setup-token').waitFor();
    await checkPage(publicPage, `einrichtung-zugang-${width}`);
    for (const [id, value] of [
      ['setup-token', 'synthetic-layout-only'], ['setup-office-name', 'Schulamt Beispielort'],
      ['setup-office-email', 'schulamt@ui-test.local'], ['setup-office-password', 'Ui-Test-Reserve-2026!'],
      ['setup-office-city', 'Beispielort'],
    ]) await publicPage.locator(`#${id}`).fill(value);
    await publicPage.getByRole('button', { name: 'Weiter', exact: true }).click();
    await publicPage.locator('#setup-header-text').waitFor();
    await checkPage(publicPage, `einrichtung-dokumente-${width}`);
    for (const [id, value] of [
      ['setup-header-text', 'Schulamt Beispielort'], ['setup-return-address', 'Testweg 1 · 80331 Beispielort'],
      ['setup-contact-address', 'Testweg 1 · 80331 Beispielort'], ['setup-contact-person', 'Erika Beispiel'],
      ['setup-director-name', 'Erika Beispiel'], ['setup-director-title', 'Schulamtsdirektorin'],
      ['setup-document-subject', 'Mobile Reserve'], ['setup-document-intro', 'Test-Einleitung'], ['setup-document-closing', 'Mit freundlichen Grüßen'],
    ]) await publicPage.locator(`#${id}`).fill(value);
    await publicPage.getByRole('button', { name: 'Weiter', exact: true }).click();
    await publicPage.locator('#setup-school-0-name').waitFor();
    await checkPage(publicPage, `einrichtung-schulen-${width}`);
    for (const [id, value] of [
      ['setup-school-0-name', 'Grundschule Beispielort'], ['setup-school-0-address', 'Schulweg 1 · 80331 Beispielort'],
      ['setup-school-0-email', 'schule@ui-test.local'], ['setup-school-0-password', 'Ui-Test-Reserve-2026!'],
    ]) await publicPage.locator(`#${id}`).fill(value);
    await publicPage.getByRole('button', { name: 'Weiter', exact: true }).click();
    await publicPage.getByText('Mail-Anbindung', { exact: true }).waitFor();
    await checkPage(publicPage, `einrichtung-mail-${width}`);
    await publicPage.getByText('SMTP jetzt einrichten', { exact: true }).click();
    await publicPage.locator('#setup-smtp-host').waitFor();
    await checkPage(publicPage, `einrichtung-smtp-${width}`);
    await publicPage.getByText('Später einrichten', { exact: true }).click();
    await publicPage.getByRole('button', { name: 'Weiter', exact: true }).click();
    await publicPage.getByRole('button', { name: 'Einrichtung abschließen' }).waitFor();
    await checkPage(publicPage, `einrichtung-pruefen-${width}`);
  }
  await publicContext.close();
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log(`${checks} UI consistency checks passed; public-entry auth was mocked for layout isolation (known redirect bug). Screenshots: ${output}`);
} finally {
  await browser.close();
}
