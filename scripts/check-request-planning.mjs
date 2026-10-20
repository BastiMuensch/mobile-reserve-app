// Start: node scripts/preview-ui-regressions.mjs --request-planning
// Run: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/check-request-planning.mjs
// All actions use the fixture's in-memory fetch. Network mutations are blocked.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('Set PLAYWRIGHT_MODULE to the installed Playwright index.mjs.');
const { chromium } = await import(pathToFileURL(modulePath).href);
const base = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:3145';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Only local synthetic fixtures are allowed.');
const output = path.resolve('output/request-planning');
await mkdir(output, { recursive: true });
const widths = (process.env.UI_TEST_WIDTHS || '1440,390,320').split(',').map(Number);
assert.ok(widths.every(width => Number.isInteger(width) && width >= 280), 'UI_TEST_WIDTHS must contain viewport widths of at least 280px.');
const browser = await chromium.launch({ headless: true,
  args: ['--lang=de-DE'],
  env: { ...process.env, LANG: 'de_DE.UTF-8', LC_ALL: 'de_DE.UTF-8' },
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});

try {
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 1050 : 844 }, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
    const page = await context.newPage();
    const errors = [];
    const unexpectedRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const request = route.request();
      if (request.method() !== 'GET' || new URL(request.url()).origin !== new URL(base).origin) {
        unexpectedRequests.push(`${request.method()} ${request.url()}`);
        return route.abort();
      }
      return route.continue();
    });
    const state = async () => JSON.parse(await page.getByTestId('fixture-state').textContent());
    const calls = async pathPart => (await state()).calls.filter(call => call.path.includes(pathPart));
    const previewOption = async name => {
      const options = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Prüfoptionen$/ }) });
      if (!await options.evaluate(element => element.open)) await options.locator('summary').click();
      await options.getByRole('button', { name, exact: true }).click();
      if (await options.evaluate(element => element.open)) await options.locator('summary').click();
    };
    const noOverflow = async label => {
      const overflowing = await page.evaluate(() => ({
        viewport: innerWidth,
        width: document.documentElement.scrollWidth,
        elements: [...document.querySelectorAll('body *')].filter(element => {
          const box = element.getBoundingClientRect();
          return box.width && (box.right > innerWidth + 1 || box.left < -1) && getComputedStyle(element).position !== 'fixed';
        }).map(element => `${element.tagName}.${String(element.className)}: ${element.textContent?.slice(0, 100)}`).slice(-10),
      }));
      assert.ok(overflowing.width <= overflowing.viewport + 1, `${label} overflow at ${width}px: ${JSON.stringify(overflowing)}`);
    };
    const dismissMessages = async () => {
      const close = page.getByRole('button', { name: 'Meldung schließen', exact: true });
      while (await close.count()) await close.first().click();
    };
    const screenshot = async name => {
      if (name !== 'failure') await dismissMessages();
      return page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true, animations: 'disabled' });
    };
    const confirmRefusal = async () => {
      await page.getByRole('button', { name: 'Absage prüfen', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Verbindlich absagen', exact: true }).click();
    };
    try {
      await page.goto(base);
      await page.getByRole('heading', { name: 'Passende Lehrkräfte', exact: true }).waitFor();
      const firstNeed = page.locator('#matching-engine [role="button"][aria-expanded]').filter({ hasText: 'Anja Beispiel' });
      assert.ok(await firstNeed.getByText('Ungeplanter Ausfall', { exact: true }).isVisible());
      assert.ok(await page.locator('#matching-engine [role="button"][aria-expanded]').filter({ hasText: 'Abdullah Beispiel' }).getByText('Fortbildung', { exact: true }).isVisible());
      assert.match(await firstNeed.innerText(), /Woche .*offen \/ angefragt/);
      for (const [name, openHours, requiredHours] of [['Montag', 2, 5], ['Dienstag', 5, 5], ['Mittwoch', 3, 3], ['Donnerstag', 4, 4], ['Freitag', 6, 6]]) {
        assert.ok(await firstNeed.locator(`[aria-label^="${name},"][aria-label$=": ${openHours} von ${requiredHours} Stunden offen"]`).isVisible());
      }
      const summary = page.locator('summary:visible').filter({ hasText: /Weitere Bedarfsdetails|Zusatzdetails|Bedarfsdetails/ });
      const candidates = page.getByRole('heading', { name: 'Passende Lehrkräfte', exact: true });
      const refusalAction = page.getByRole('button', { name: 'Tag absagen', exact: true });
      await refusalAction.waitFor();
      const selectedContext = page.locator(':text-is("Ausgewählter Bedarf"):visible');
      assert.ok((await selectedContext.boundingBox()).y < (await refusalAction.boundingBox()).y, 'Selected request context precedes its visible action.');
      assert.ok((await refusalAction.boundingBox()).y < (await summary.boundingBox()).y, 'Rejection stays visible above additional details.');
      assert.ok((await summary.boundingBox()).y < (await candidates.boundingBox()).y, 'Additional details precede candidates.');
      assert.equal(await summary.evaluate(element => element.parentElement.open), false, 'Extra details start collapsed.');
      await summary.click();
      await noOverflow('Overview with details expanded');
      await summary.click();
      await noOverflow('Overview');
      await screenshot('overview');

      await page.getByRole('button', { name: 'Besetzungsvorschläge prüfen', exact: true }).click();
      await page.getByRole('button', { name: 'Vorschlag berechnen', exact: true }).click();
      const selected = page.getByRole('checkbox', { name: /Anforderung für Anja Beispiel/ });
      const optional = page.getByRole('checkbox', { name: /Anforderung für Abdullah Beispiel/ });
      await selected.waitFor();
      assert.ok(await selected.isChecked());
      assert.ok(await optional.isChecked());
      const unfillable = page.getByRole('heading', { name: /Zu vertreten: Gerda Nichtbesetzbar/ }).locator('xpath=../..');
      assert.ok(await unfillable.getByText('9 offene Std. im Vorschlagszeitraum', { exact: true }).isVisible());
      assert.ok(await unfillable.getByText(/Dienstbefreiung \/ Freistellung vom Dienst/).isVisible());
      assert.match(await unfillable.getByRole('heading').innerText(), /Klasse: 4c/);
      const coverage = page.locator('[aria-label="Gesamtabdeckung der Schule"]');
      assert.match(await coverage.innerText(), /33 Std\. Bedarf.*24 Std\. ausgewählt.*9 Std\. offen/s);
      assert.ok(await page.getByText('Für Freigabe ausgewählt: 2 von 2 Vorschlägen · 2 Lehrkräfte', { exact: true }).isVisible());
      await noOverflow('Computed proposals');
      await screenshot('proposals');
      if (width === 320) {
        await previewOption('Darstellung wechseln');
        await screenshot('proposals-dark');
        await previewOption('Darstellung wechseln');
      }
      const optionalRow = optional.locator('xpath=../..');
      assert.equal(await optionalRow.getByRole('button', { name: 'Bedarf absagen', exact: true }).count(), 0, 'Selected requirement cannot be rejected.');
      await optional.uncheck();
      assert.ok(await optionalRow.getByText('Nicht zur Freigabe ausgewählt', { exact: true }).isVisible(), 'Deselected proposal has an explicit state label.');
      assert.match(await coverage.innerText(), /33 Std\. Bedarf.*12 Std\. ausgewählt.*21 Std\. offen/s, 'School totals include unselected and unfillable hours.');
      assert.ok(await page.getByText('Für Freigabe ausgewählt: 1 von 2 Vorschlägen · 1 Lehrkraft', { exact: true }).isVisible());
      assert.equal(await optionalRow.locator('details').filter({ hasText: 'Bisherigen Vorschlag ansehen' }).evaluate(element => element.open), false);
      assert.equal((await calls('/unfilled')).length, 0, 'Deselecting alone causes no cancellation.');
      await optionalRow.getByRole('button', { name: 'Bedarf absagen', exact: true }).click();
      const scope = page.getByLabel('Tage für die Absage', { exact: true });
      const reason = page.getByLabel('Begründung für die Schule (optional)', { exact: true });
      assert.equal(await scope.inputValue(), 'all');
      const { days } = await state();
      assert.deepEqual(await scope.locator('option').evaluateAll(options => options.map(option => option.value)), ['all', ...days.slice(1, 4)], 'Only plan-scoped open dates are offered.');
      await reason.fill('Andere Anforderung wird vorrangig besetzt.');
      await noOverflow('Expanded manual rejection');
      const formBounds = await reason.locator('xpath=..').boundingBox();
      for (const name of ['Abbrechen', 'Absage prüfen']) {
        const buttonBounds = await page.getByRole('button', { name, exact: true }).boundingBox();
        assert.ok(buttonBounds.x >= formBounds.x && buttonBounds.x + buttonBounds.width <= formBounds.x + formBounds.width + 1, `Manual rejection button ${name} stays inside its form at ${width}px.`);
      }
      await screenshot('manual-rejection');
      await page.getByRole('button', { name: 'Absage prüfen', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('heading', { name: 'Bedarf für Abdullah Beispiel absagen?', exact: true }).waitFor();
      assert.match(await dialog.innerText(), /3 Tag\(e\).*12/);
      await noOverflow('Rejection confirmation');
      await screenshot('confirmation');
      await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
      assert.equal((await calls('/unfilled')).length, 0, 'Cancelling confirmation sends no request.');
      assert.ok(await selected.isChecked(), 'Other selected requirement remains selected.');

      await optional.check();
      assert.equal(await scope.count(), 0, 'Selecting the requirement closes its rejection form.');
      await optional.uncheck();
      await optionalRow.getByRole('button', { name: 'Bedarf absagen', exact: true }).click();
      await reason.fill('Vorrang für Anja Beispiel.');
      await previewOption('Nächste Absage fehlschlagen lassen');
      await confirmRefusal();
      await page.getByText('Testfehler: Absage konnte nicht gespeichert werden.', { exact: true }).waitFor();
      assert.ok(await optional.isVisible(), 'Server error retains rejected proposal for retry.');
      assert.equal(await optional.isChecked(), false);
      assert.ok(await selected.isChecked(), 'Server error preserves the other selected proposal.');
      assert.equal((await calls('/unfilled')).length, 1);
      assert.equal((await state()).requests.find(request => request.id === 'request-abdullah').unfilledDays, undefined);

      // Retry one date: remaining dates and the current selection must survive.
      await scope.selectOption(days[2]);
      await confirmRefusal();
      await page.getByText(/1 Tag\(e\) abgesagt · Vorschläge neu berechnen/).waitFor();
      assert.ok(await optional.isVisible());
      assert.equal(await optional.isChecked(), false);
      assert.ok(await selected.isChecked());
      const successfulSingle = (await calls('/unfilled')).filter(call => !call.failed);
      assert.equal(successfulSingle.length, 1);
      assert.deepEqual(successfulSingle[0].body, { dates: [days[2]], reason: 'Vorrang für Anja Beispiel.' });
      assert.equal(await optionalRow.getByText(/Mi /).count(), 0, 'Refused date is removed from the proposal segment.');

      // Cancel all remaining days in the plan, not Monday/Friday of the request.
      await optionalRow.getByRole('button', { name: 'Bedarf absagen', exact: true }).click();
      assert.deepEqual(await scope.locator('option').evaluateAll(options => options.map(option => option.value)), ['all', days[1], days[3]]);
      await confirmRefusal();
      await optional.waitFor({ state: 'detached' });
      assert.ok(await selected.isChecked());
      const successfulRejections = (await calls('/unfilled')).filter(call => !call.failed);
      assert.deepEqual(successfulRejections[1].body.dates, [days[1], days[3]]);
      assert.ok(!successfulRejections.flatMap(call => call.body.dates).includes(days[0]));
      assert.ok(!successfulRejections.flatMap(call => call.body.dates).includes(days[4]));

      // Freigeben submits only the retained, checked requirement.
      await page.getByRole('button', { name: 'Freigeben', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Freigeben', exact: true }).click();
      await page.getByText('Freigegeben: 1 Anforderung(en), 3 Einsätze', { exact: true }).waitFor();
      const approvals = await calls('/approve');
      assert.equal(approvals.length, 1);
      assert.deepEqual(approvals[0].body.items.map(item => item.requestId), ['request-anja']);
      assert.deepEqual(approvals[0].body.items[0].segments[0].entries.map(entry => ({ date: entry.date, hours: entry.hours })), [
        { date: days[1], hours: 5 }, { date: days[2], hours: 3 }, { date: days[3], hours: 4 },
      ]);

      // Unfillable requirements remain actionable after another requirement at
      // their school was approved, and include every scoped open day.
      await unfillable.getByRole('button', { name: 'Bedarf absagen', exact: true }).click();
      await confirmRefusal();
      await unfillable.waitFor({ state: 'detached' });
      const lastRefusal = (await calls('/unfilled')).at(-1);
      assert.equal(lastRefusal.path, '/api/requests/request-gerda/unfilled');
      assert.deepEqual(lastRefusal.body.dates, [days[1], days[3]]);
      await noOverflow('After rejection and approval');

      // Recalculation keeps the current selected/swap choices and releases a
      // deselected teacher so the previously unfillable requirement can use her.
      await previewOption('Beispiele zurücksetzen');
      await page.getByRole('button', { name: 'Vorschlag berechnen', exact: true }).click();
      await selected.waitFor();
      const selectedRow = selected.locator('xpath=../..');
      await selectedRow.getByRole('combobox').click();
      await page.getByRole('option', { name: /Theresa Alternative/ }).click();
      await optional.uncheck();
      await previewOption('Nächste Neuberechnung fehlschlagen lassen');
      const keepAndCompute = page.getByRole('button', { name: 'Auswahl behalten & neu berechnen', exact: true });
      await keepAndCompute.click();
      await page.getByText('Testfehler: Neuberechnung konnte nicht durchgeführt werden.', { exact: true }).waitFor();
      assert.ok(await selected.isChecked(), 'Failed recalculation retains selected requirement.');
      assert.equal(await optional.isChecked(), false, 'Failed recalculation retains deselected requirement.');
      assert.match(await selectedRow.getByRole('combobox').innerText(), /Theresa Alternative/, 'Failed recalculation retains effective teacher swap.');
      const failedPreview = (await calls('/preview')).at(-1);
      assert.equal(failedPreview.failed, true);
      assert.deepEqual(failedPreview.body.excludedRequestIds, ['request-abdullah']);
      assert.deepEqual(failedPreview.body.retainedItems.map(item => item.requestId), ['request-anja']);
      assert.equal(failedPreview.body.retainedItems[0].segments[0].teacherId, 'reserve-alternative-0');
      assert.deepEqual(failedPreview.body.retainedItems[0].segments[0].entries.map(entry => entry.date), days.slice(1, 4));

      await previewOption('Nächste Neuberechnung mit Konflikt ablehnen');
      await keepAndCompute.click();
      await page.getByText('Testkonflikt: Beibehaltene Auswahl muss geprüft werden.', { exact: true }).waitFor();
      assert.ok(await selected.isChecked(), 'A stale-choice conflict also retains the visible selected requirement.');
      assert.equal(await optional.isChecked(), false);
      assert.match(await selectedRow.getByRole('combobox').innerText(), /Theresa Alternative/);
      await keepAndCompute.click();
      const newFilled = page.getByRole('checkbox', { name: /Anforderung für Gerda Nichtbesetzbar/ });
      await newFilled.waitFor();
      assert.ok(await newFilled.isChecked(), 'Freshly fillable need is selected.');
      assert.ok(await selected.isChecked());
      assert.ok(await selectedRow.getByText('Theresa Alternative', { exact: true }).isVisible(), 'Successful recalculation normalizes the retained effective teacher.');
      assert.ok(await newFilled.locator('xpath=../..').getByText('Anna-Veronica Beispiel', { exact: true }).isVisible(), 'Freed teacher moves to previously unfillable need.');
      assert.equal(await optional.count(), 0, 'Excluded request no longer consumes a proposed segment.');
      await page.getByRole('heading', { name: /Zurückgestellt/ }).waitFor();
      assert.match(await coverage.innerText(), /33 Std\. Bedarf.*21 Std\. ausgewählt.*12 Std\. offen/s);
      await noOverflow('Preserved recalculation');
      await screenshot('recalculated');
      const previewCall = (await calls('/preview')).at(-1);
      assert.deepEqual(previewCall.body.excludedRequestIds, ['request-abdullah']);
      assert.equal(previewCall.body.retainedItems[0].segments[0].teacherId, 'reserve-alternative-0');

      // A second pass also retains the newly proposed need and prior exclusion.
      await keepAndCompute.click();
      await newFilled.waitFor();
      const secondRecalculation = (await calls('/preview')).at(-1);
      assert.deepEqual(secondRecalculation.body.retainedItems.map(item => item.requestId).sort(), ['request-anja', 'request-gerda']);
      assert.deepEqual(secondRecalculation.body.excludedRequestIds, ['request-abdullah']);
      assert.ok(await selected.isChecked());
      assert.ok(await newFilled.isChecked());

      // Reconsider a deferred requirement without displacing retained teachers.
      await page.getByRole('button', { name: 'Wieder berücksichtigen', exact: true }).click();
      await page.getByRole('heading', { name: /Nicht besetzbar/ }).waitFor();
      assert.equal(await page.getByRole('heading', { name: /Zurückgestellt/ }).count(), 0);
      const reconsidered = (await calls('/preview')).at(-1);
      assert.deepEqual(reconsidered.body.excludedRequestIds, []);
      assert.deepEqual(reconsidered.body.retainedItems.map(item => item.requestId).sort(), ['request-anja', 'request-gerda']);
      assert.ok(await selected.isChecked());
      assert.ok(await newFilled.isChecked());

      // Full replanning is a separate, explicit choice; it restores availability
      // of the excluded requirement and removes the local swap.
      await page.getByRole('button', { name: 'Alles neu planen', exact: true }).click();
      await optional.waitFor();
      assert.ok(await optional.isChecked());
      assert.ok(await selected.isChecked());
      assert.match(await selectedRow.getByRole('combobox').innerText(), /Noah Beispiel/);
      const resetPreview = (await calls('/preview')).at(-1);
      assert.equal(resetPreview.body.retainedItems?.length ?? 0, 0);
      assert.equal(resetPreview.body.excludedRequestIds?.length ?? 0, 0);

      // A 409 during approval invalidates the draft but must release its lock,
      // allowing a fresh preview and a successful subsequent approval.
      await previewOption('Nächste Freigabe mit Konflikt ablehnen');
      await page.getByRole('button', { name: 'Freigeben', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Freigeben', exact: true }).click();
      await page.getByText('Testkonflikt: Freigabe benötigt einen aktuellen Vorschlag.', { exact: true }).waitFor();
      const freshCompute = page.getByRole('button', { name: 'Vorschlag berechnen', exact: true });
      await freshCompute.waitFor();
      assert.equal(await freshCompute.isEnabled(), true, 'Approval conflict releases the processing lock.');
      await freshCompute.click();
      await selected.waitFor();
      await page.getByRole('button', { name: 'Freigeben', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Freigeben', exact: true }).click();
      await page.getByText('Freigegeben: 2 Anforderung(en), 6 Einsätze', { exact: true }).waitFor();
      assert.equal((await calls('/approve')).at(-2).failed, true);
      assert.equal((await calls('/approve')).at(-1).failed, undefined);

      // Twelve requests across three schools exercise long lists and the
      // desktop action panel while leaving the main screenshots uncluttered.
      await previewOption('Zwölf Bedarfe anzeigen');
      await page.getByRole('button', { name: 'Vorschlag berechnen', exact: true }).click();
      await page.getByRole('checkbox', { name: /Anforderung für Mara Wolf/ }).waitFor();
      assert.equal(await page.getByRole('checkbox').count(), 11);
      await noOverflow('Twelve proposed requests');
      await page.getByRole('button', { name: 'Bedarfsübersicht', exact: true }).click();
      assert.equal(await page.locator('#matching-engine [role="button"][aria-expanded]').count(), 12);
      const declinedNeed = page.locator('#matching-engine [role="button"][aria-expanded]').filter({ hasText: 'Lena Sommer' });
      assert.ok(await declinedNeed.locator('[aria-label^="Dienstag,"][aria-label$="0 von 5 Stunden offen, 5 abgesagt"]').isVisible(), 'Weekday summary distinguishes an explicitly refused day.');
      if (width === 1440) {
        const aside = page.locator('aside:visible');
        assert.equal(await aside.evaluate(element => getComputedStyle(element).position), 'sticky');
        await page.evaluate(() => window.scrollTo(0, 700));
        const asidePosition = await aside.boundingBox();
        assert.ok(asidePosition.y >= 0 && asidePosition.y < 60, 'Selected request/actions remain visible while scrolling a long list.');
        await aside.locator('summary').filter({ hasText: 'Bedarfsdetails & weitere Aktionen' }).click();
        await aside.evaluate(element => { element.scrollTop = element.scrollHeight; });
        await page.locator('#matching-engine [role="button"][aria-expanded]').filter({ hasText: 'Abdullah Beispiel' }).click();
        await aside.getByRole('heading', { name: 'Abdullah Beispiel · Klasse 1b', exact: true }).waitFor();
        assert.equal(await aside.evaluate(element => element.scrollTop), 0, 'Selecting another need resets the side panel to its visible action.');
        assert.ok(await aside.getByRole('button', { name: 'Tag absagen', exact: true }).isVisible());
      }
      await noOverflow('Twelve overview requests');
      await dismissMessages();
      await page.screenshot({ path: path.join(output, `dense-overview-${width}.png`), fullPage: false, animations: 'disabled' });
      await previewOption('Drei Bedarfe anzeigen');
      assert.deepEqual(errors, [], 'No browser runtime errors.');
      assert.deepEqual(unexpectedRequests, [], 'No network mutations or external requests.');
      console.log(`PASS ${width}px: explicit week/open-hours; selected context and visible action hierarchy; rejection cancel/error/single/multi-day; retained swap and unchecked capacity on recalculation; 503/409 preserve choices; reconsider/full reset; approval409 recovery; twelve-request layout; no overflow or browser errors.`);
    } catch (error) {
      await screenshot('failure').catch(() => undefined);
      console.error(`UI diagnostic ${width}px:`, JSON.stringify({ errors, unexpectedRequests, state: await state(), body: (await page.locator('body').innerText()).slice(0, 10000) }));
      throw error;
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
