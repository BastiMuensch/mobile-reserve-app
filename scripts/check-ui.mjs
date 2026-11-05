// Browser smoke checks against the synthetic fixture server only.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('Set PLAYWRIGHT_MODULE to the installed Playwright index.mjs.');
const engines = await import(pathToFileURL(modulePath).href);
const engine = process.env.UI_TEST_BROWSER || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engine));
const base = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:3101';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'UI tests require a loopback origin');
const output = path.resolve(process.env.UI_TEST_OUTPUT_DIR || 'output/ui-audit');
await mkdir(output, { recursive: true });
const browser = await engines[engine].launch({ headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
});
const context = await browser.newContext({ viewport: { width: 1536, height: 1040 }, colorScheme: 'light', locale: 'de-DE',
  ignoreHTTPSErrors: process.env.UI_TEST_ALLOW_LOCAL_CERTIFICATE === 'true',
  serviceWorkers: 'allow',
});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));


async function login(email) {
  await page.goto(base);
  await page.getByLabel('E-Mail-Adresse', { exact: true }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill('Ui-Test-Reserve-2026!');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await dismissReleaseNotice();
}
// After an update every role first sees "Neu in Version …" once. The modal hides
// the dashboard from the accessibility tree, so confirm it before checking pages.
async function dismissReleaseNotice() {
  const confirm = page.getByRole('dialog').getByRole('button', { name: 'Verstanden', exact: true });
  await confirm.waitFor({ timeout: 5000 }).then(() => confirm.click(), () => {});
  await confirm.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
}
async function screenshot(name) {
  await page.getByText(/^Karte wird geladen\s*(?:…|\.\.\.)$/).waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  if (await page.locator('.leaflet-tile').count()) {
    await page.waitForFunction(() => [...document.querySelectorAll('.leaflet-tile')].every(image => image.complete && image.naturalWidth > 0), null, { timeout: 15000 }).catch(() => {});
  }
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: horizontal overflow`);
  const dialog = page.getByRole('dialog');
  const hasDialog = await dialog.count() > 0;
  if (hasDialog) await dialog.last().evaluate(node => { node.scrollTop = 0; });
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: !hasDialog, animations: 'disabled' });
  if (name === 'schulamt-desktop') {
    await page.screenshot({ path: path.join(output, 'schulamt-vorschau.png'), fullPage: false, animations: 'disabled' });
  }
}
// Requests handled by an active service worker may bypass Playwright routing,
// particularly in WebKit. Inject only the selected fetch failure at the page
// boundary so the real worker stays enabled for all normal traffic.
async function withApiFailure(pathPattern, check) {
  await page.evaluate(pattern => {
    const original = window.fetch;
    const matcher = new RegExp(pattern);
    const state = { original, hits: 0 };
    window.__dashboardApiFailure = state;
    window.fetch = function (input, init) {
      const url = new URL(input instanceof Request ? input.url : input, location.href);
      if (url.origin === location.origin && matcher.test(url.pathname)) {
        state.hits += 1;
        return Promise.resolve(new Response(JSON.stringify({ error: 'Synthetic UI test outage' }), {
          status: 503, headers: { 'Content-Type': 'application/json' },
        }));
      }
      return original.call(this, input, init);
    };
  }, pathPattern);
  try {
    await check();
    const hits = await page.evaluate(() => window.__dashboardApiFailure.hits);
    assert.ok(hits > 0, `The failure for ${pathPattern} was exercised`);
    console.log(`${engine}: simulated API failure exercised (${pathPattern}, ${hits} request(s))`);
  } finally {
    await page.evaluate(() => {
      const state = window.__dashboardApiFailure;
      if (state) window.fetch = state.original;
      delete window.__dashboardApiFailure;
    });
  }
}

async function checkTeacherInteractions() {
  await withApiFailure('^/api/teachers/[^/]+/assignments$', async () => {
    await page.getByRole('button', { name: 'Einsätze aktualisieren', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Ihre Einsätze konnten gerade nicht geladen werden.' }).waitFor();
    assert.ok(await page.getByText('Grundschule am Park', { exact: false }).first().isVisible(), 'A refresh outage preserves the current assignment');
    await page.getByRole('status').filter({ hasText: 'Die Nachweisliste konnte nicht aktualisiert werden.' }).waitFor();
  });
  await page.getByRole('button', { name: 'Erneut laden', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Ihre Einsätze konnten gerade nicht geladen werden.' }).waitFor({ state: 'hidden' });

  const absenceButton = page.getByRole('button', { name: 'Ungeplanten Ausfall melden', exact: true }).filter({ visible: true });
  await absenceButton.click();
  const absence = page.getByRole('dialog', { name: 'Ungeplanten Ausfall melden', exact: true });
  await absence.getByLabel('Datum des Ausfalls', { exact: true }).waitFor();
  const reason = absence.getByLabel('Begründung ohne Gesundheitsangaben', { exact: true });
  assert.equal(await reason.getAttribute('aria-describedby'), 'absence-privacy-notice');
  await reason.fill('Synthetischer UI-Prüfentwurf');
  await screenshot('lehrkraft-ausfall-dialog-mobile');
  await absence.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await absence.waitFor({ state: 'hidden' });

  await page.getByRole('button', { name: 'Längere Abwesenheit melden', exact: true }).filter({ visible: true }).click();
  const leave = page.getByRole('dialog', { name: 'Längere Abwesenheit melden', exact: true });
  await leave.getByLabel('Beginn', { exact: true }).waitFor();
  const openEnded = leave.getByRole('checkbox', { name: 'Ende noch offen (bis auf Weiteres)', exact: true });
  await openEnded.check();
  assert.equal(await leave.getByLabel('Ende', { exact: true }).isDisabled(), true);
  await openEnded.uncheck();
  assert.equal(await leave.getByLabel('Ende', { exact: true }).isDisabled(), false);
  await screenshot('lehrkraft-abwesenheit-dialog-mobile');
  await page.keyboard.press('Escape');
  await leave.waitFor({ state: 'hidden' });

  await page.getByRole('tab', { name: 'Pro Monat', exact: true }).click();
  const month = page.getByLabel('Monat für die Abrechnung', { exact: true });
  const selectedMonth = await month.inputValue();
  await month.fill('');
  assert.equal(await page.getByRole('button', { name: 'Monatsübersicht herunterladen', exact: true }).isDisabled(), true);
  await month.fill(selectedMonth);
  assert.equal(await page.getByRole('button', { name: 'Monatsübersicht herunterladen', exact: true }).isDisabled(), false);
  await page.getByRole('tab', { name: 'Pro Einsatz', exact: true }).click();
}

async function checkSchoolInteractions() {
  await page.getByRole('heading', { name: 'Unsere Bedarfe', exact: true }).waitFor();
  const sorting = page.getByRole('group', { name: 'Anfragen sortieren', exact: true });
  await sorting.getByRole('button', { name: 'Datum', exact: true }).click();
  assert.equal(await sorting.getByRole('button', { name: 'Datum', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.reload();
  await page.getByRole('heading', { name: 'Unsere Bedarfe', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="Anfragen sortieren"] button[aria-pressed="true"]')?.textContent?.trim() === 'Datum');
  await sorting.getByRole('button', { name: 'Prio', exact: true }).click();
  assert.equal(await sorting.getByRole('button', { name: 'Prio', exact: true }).getAttribute('aria-pressed'), 'true');
  const filters = page.getByRole('group', { name: 'Nach Status filtern', exact: true });
  await filters.waitFor();
  const statusButtons = await filters.getByRole('button').all();
  for (const button of statusButtons) {
    const label = await button.textContent();
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    if (/\(0\)/.test(label)) await page.getByText('Keine Anfragen mit dem gewählten Status.', { exact: true }).waitFor();
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'), 'false');
  }
  const archive = page.getByRole('button', { name: /^Archiv \(/ });
  if (await archive.count()) {
    assert.equal(await archive.getAttribute('aria-expanded'), 'false');
    await archive.focus();
    await page.keyboard.press('Enter');
    assert.equal(await archive.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Enter');
    assert.equal(await archive.getAttribute('aria-expanded'), 'false');
  }
  const notes = page.getByRole('button', { name: 'Hinweise ansehen', exact: true }).filter({ visible: true }).first();
  await notes.click();
  await page.getByText('UI-Test: Keine reale Vertretungsanfrage.', { exact: true }).waitFor();
  await page.keyboard.press('Escape');

  await withApiFailure('^/api/requests$', async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('app-refresh')));
    await page.getByRole('alert').filter({ hasText: 'Die Bedarfe konnten gerade nicht geladen werden.' }).waitFor();
    assert.ok(await page.getByRole('button', { name: 'Bedarf ändern / beenden', exact: true }).filter({ visible: true }).first().isVisible(), 'A refresh outage preserves the current school requests');
  });
  await page.getByRole('button', { name: 'Erneut laden', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Die Bedarfe konnten gerade nicht geladen werden.' }).waitFor({ state: 'hidden' });

  await page.getByRole('button', { name: 'Bedarf ändern / beenden', exact: true }).filter({ visible: true }).first().click();
  const lifecycle = page.getByRole('dialog', { name: 'Bedarf ändern / beenden', exact: true });
  await lifecycle.getByLabel('Letzter benötigter Einsatztag (einschließlich)', { exact: true }).waitFor();
  await lifecycle.getByRole('radio', { name: /^Verbleibenden Bedarf stornieren/ }).check();
  assert.equal(await lifecycle.getByLabel('Letzter benötigter Einsatztag (einschließlich)', { exact: true }).count(), 0);
  await lifecycle.getByRole('radio', { name: /^Rückkehr melden \/ vorzeitig beenden/ }).check();
  await lifecycle.getByLabel('Letzter benötigter Einsatztag (einschließlich)', { exact: true }).waitFor();
  await screenshot('schule-bedarf-aendern-dialog-mobile');
  await lifecycle.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await lifecycle.waitFor({ state: 'hidden' });

  await page.getByRole('button', { name: 'Bedarf melden', exact: true }).click();
  const request = page.getByRole('dialog', { name: 'Bedarf melden', exact: true });
  await request.getByLabel('Datum', { exact: true }).waitFor();
  await request.getByRole('button', { name: 'Längerfristig', exact: true }).click();
  const openEnded = request.getByRole('checkbox', { name: 'Ende noch offen (bis auf Weiteres)', exact: true });
  await openEnded.check();
  assert.equal(await request.getByLabel('Enddatum', { exact: true }).isDisabled(), true);
  await openEnded.uncheck();
  assert.equal(await request.getByLabel('Enddatum', { exact: true }).isDisabled(), false);
  const lesson = request.getByRole('button', { name: 'Stunde 1, Tag 1', exact: true });
  await lesson.click();
  await request.getByRole('button', { name: 'Stunde 1, Tag 1 ausgewählt', exact: true }).waitFor();
  await screenshot('schule-bedarf-melden-dialog-mobile');
  await page.keyboard.press('Escape');
  const discard = page.getByRole('dialog', { name: 'Entwurf verwerfen?', exact: true });
  await discard.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await discard.waitFor({ state: 'hidden' });
  assert.ok(await request.getByRole('button', { name: 'Stunde 1, Tag 1 ausgewählt', exact: true }).isVisible(), 'Cancelling discard preserves the school request draft');
  await page.keyboard.press('Escape');
  await discard.getByRole('button', { name: 'Entwurf verwerfen', exact: true }).click();
  await request.waitFor({ state: 'hidden' });

  await page.getByRole('link', { name: 'Schulprofil bearbeiten', exact: true }).click();
  await page.getByRole('heading', { name: 'Schulprofil', exact: true }).waitFor();
  await page.getByLabel('Allgemeine Informationen (z.B. Anmeldung im Sekretariat)', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Zurück zum Dashboard', exact: true }).click();
  await page.getByRole('heading', { name: 'Unsere Bedarfe', exact: true }).waitFor();
  await page.locator('#main-content').getByRole('link', { name: 'Unsere Mobilen Reserven', exact: true }).click();
  await page.getByRole('heading', { name: 'Unsere Mobilen Reserven', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await page.getByRole('heading', { name: 'Anna Beispiel', exact: true }).waitFor();
  await screenshot('schule-reserven-mobile');
  await page.goto(base);
  await page.getByRole('heading', { name: 'Unsere Bedarfe', exact: true }).waitFor();
}
// Open demands are announced as "Bedarf für <Lehrkraft> an <Schule> am <Datum> …".
const DEMAND_AT_PARK = /^Bedarf für .+ an Grundschule am Park am /;
const candidatesHeading = () => page.getByRole('heading', { name: 'Lehrkräfte für diesen Bedarf' });
try {
  await login('schulamt@ui-test.local');
  await page.getByRole('heading', { name: 'Heute im Überblick' }).waitFor();
  await page.getByRole('button', { name: DEMAND_AT_PARK }).first().waitFor();
  await page.locator('.leaflet-container').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.leaflet-tile')].some(image => image.complete && image.naturalWidth > 0), null, { timeout: 15000 }).catch(() => console.warn('Background map tiles not loaded; markers remain testable.'));
  await screenshot('schulamt-desktop');

  // Future requests start collapsed, but search and direct links reveal them.
  const laterGroup = page.locator('details').filter({ has: page.getByRole('heading', { name: /^Später/ }) });
  if (await laterGroup.count()) {
    assert.equal(await laterGroup.getAttribute('open'), null);
    const laterSummary = laterGroup.locator('summary');
    await laterSummary.focus();
    await page.keyboard.press('Enter');
    assert.notEqual(await laterGroup.getAttribute('open'), null);
    await page.keyboard.press('Enter');
    assert.equal(await laterGroup.getAttribute('open'), null);
    const search = page.getByRole('textbox', { name: 'Bedarfe nach Schule oder Grund durchsuchen' });
    await search.fill('Grundschule');
    assert.notEqual(await laterGroup.getAttribute('open'), null, 'Search reveals future matches');
    await search.fill('');
    assert.equal(await laterGroup.getAttribute('open'), null);

    const requests = await page.evaluate(async () => {
      const response = await fetch('/api/requests');
      if (!response.ok) throw new Error(`Unable to load fixture demands: ${response.status}`);
      return response.json();
    });
    const future = requests.find(request => ['PENDING', 'PARTIALLY_FILLED'].includes(request.status) && new Date(request.date) > new Date(Date.now() + 7 * 86400000));
    if (future) {
      await page.goto(`${base}/schulamt?matchRequestId=${encodeURIComponent(future.id)}`);
      await candidatesHeading().waitFor();
      assert.notEqual(await laterGroup.getAttribute('open'), null, 'Direct link reveals selected future demand');
      assert.ok(await laterGroup.locator('[role="button"][aria-expanded="true"]').isVisible());
      await page.goto(`${base}/schulamt`);
      await page.getByRole('button', { name: DEMAND_AT_PARK }).first().waitFor();
    }
  }

  // Optional profile outages must not hide operational school/year data.
  await withApiFailure('^/api/schulamt/profile$', async () => {
    await page.getByRole('button', { name: 'Daten aktualisieren', exact: true }).click();
    await page.getByText('Die Schulamts-Einstellungen konnten nicht aktualisiert werden.', { exact: false }).waitFor();
    assert.ok(await page.getByRole('button', { name: DEMAND_AT_PARK }).first().isVisible());
  });

  const selectedYear = await page.getByLabel('Schuljahr', { exact: true }).inputValue();
  await page.getByLabel('Schuljahr', { exact: true }).selectOption({ index: 0 });
  await page.getByText('Keine offenen Bedarfe gefunden.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: DEMAND_AT_PARK }).first().count(), 0);
  await page.reload();
  await page.getByText('Keine offenen Bedarfe gefunden.', { exact: true }).waitFor();
  assert.notEqual(await page.getByLabel('Schuljahr', { exact: true }).inputValue(), selectedYear, 'School year survives reload');
  await page.getByLabel('Schuljahr', { exact: true }).selectOption(selectedYear);
  await page.getByRole('button', { name: DEMAND_AT_PARK }).first().waitFor();

  // A failed new-year fetch must never publish data from the preceding year.
  await withApiFailure('^/api/teachers$', async () => {
    await page.getByLabel('Schuljahr', { exact: true }).selectOption({ index: 0 });
    await page.getByText('Für dieses Schuljahr sind noch keine verlässlichen Daten geladen.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: DEMAND_AT_PARK }).first().count(), 0);
  });
  await page.getByLabel('Schuljahr', { exact: true }).selectOption(selectedYear);
  await page.getByRole('button', { name: DEMAND_AT_PARK }).first().waitFor();

  await page.getByRole('button', { name: DEMAND_AT_PARK }).first().click();
  await candidatesHeading().waitFor();
  await page.getByRole('button', { name: / zuweisen$/ }).first().waitFor();
  await screenshot('schulamt-matching');
  await page.getByRole('button', { name: 'Karte vergrößern', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');

  for (const [route, name] of [['reserven', 'Mobile Reserven'], ['schulen', 'Schulen'], ['idealbesetzung', 'Besetzungsvorschläge'], ['statistiken', 'Stunden & Statistik'], ['monatsmeldung', 'Monatsmeldung'], ['dokumentation', 'Dokumentation'], ['einstellungen', 'Einstellungen']]) {
    // Exercise the real App Router navigation. Forced document replacement can
    // report cancelled prefetches as WebKit pageerrors while tearing a page down.
    await page.getByRole('navigation', { name: 'Schulamt-Navigation', exact: true }).locator(`a[href="/schulamt/${route}"]`).click();
    await page.waitForURL(`${base}/schulamt/${route}`);
    await page.getByRole('heading', { level: 1, name, exact: true }).waitFor();
    await page.getByText('Daten für das ausgewählte Schuljahr werden geladen …', { exact: true }).waitFor({ state: 'hidden' });
    await screenshot(`schulamt-${route}`);
  }
  await page.getByRole('navigation', { name: 'Schulamt-Navigation', exact: true }).locator('a[href="/schulamt"]').click();
  await page.waitForURL(`${base}/schulamt`);
  await page.getByRole('button', { name: DEMAND_AT_PARK }).first().waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot('schulamt-mobile');
  await page.getByRole('button', { name: 'Navigation öffnen' }).click();
  await page.locator('#mobile-authority-nav').getByRole('link', { name: /Mobile Reserven/ }).click();
  await page.getByRole('heading', { level: 1, name: 'Mobile Reserven', exact: true }).waitFor();
  await screenshot('reserven-mobile');
  await page.setViewportSize({ width: 320, height: 740 });
  await screenshot('reserven-small-mobile');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Abmelden', exact: true }).filter({ visible: true }).click();
  await page.getByRole('button', { name: 'Anmelden', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Mobile Reserven', exact: true }).count(), 0);
  await login('reserve1@ui-test.local');
  await page.getByText('Grundschule am Park', { exact: false }).first().waitFor();
  await screenshot('lehrkraft-mobile');
  await checkTeacherInteractions();
  await page.getByRole('link', { name: 'Mein Profil', exact: true }).click();
  await page.getByLabel('Telefon (optional)', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Zum Einsatzplan', exact: true }).click();
  await page.getByRole('heading', { name: 'Hallo, Anna Beispiel', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await page.getByRole('button', { name: 'Anmelden', exact: true }).waitFor();
  await login('schule1@ui-test.local');
  await page.getByRole('link', { name: 'Schulprofil bearbeiten' }).waitFor();
  await screenshot('schule-mobile');
  await checkSchoolInteractions();
  assert.deepEqual(pageErrors, [], 'Browser runtime errors');
  console.log(`${engine}: full dashboard checks passed with service workers enabled. Screenshots:`, output);
} finally { await browser.close(); }
