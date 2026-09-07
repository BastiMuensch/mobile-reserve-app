/**
 * Full browser regression for a fresh, isolated first-time setup instance.
 *
 * Required environment:
 *   PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs
 *   SETUP_QA_BASE_URL=http://127.0.0.1:3120
 *   SETUP_QA_TOKEN=<the server SETUP_TOKEN>
 *   SETUP_QA_SUFFIX=<unique test-only suffix>
 *
 * The target must be a loopback server backed by an empty, explicitly named
 * test database. This script creates its synthetic school authority and school.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = process.env.PLAYWRIGHT_MODULE;
const base = process.env.SETUP_QA_BASE_URL;
const token = process.env.SETUP_QA_TOKEN;
const suffix = process.env.SETUP_QA_SUFFIX;
if (!modulePath || !base || !token || !suffix) throw new Error("Set PLAYWRIGHT_MODULE, SETUP_QA_BASE_URL, SETUP_QA_TOKEN and SETUP_QA_SUFFIX.");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname), "Setup UI QA requires a loopback origin.");

const { chromium } = await import(pathToFileURL(modulePath).href);
const output = path.resolve("output/setup-ui");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "de-DE" });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

const authorityEmail = `schulamt+${suffix}@setup-qa.local`;
const schoolEmail = `schule+${suffix}@setup-qa.local`;
const password = "Setup-QA-Passwort-2026";

try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator("#setup-public-support").waitFor();
  for (const id of ["setup-token", "setup-office-name", "setup-office-email", "setup-office-password", "setup-office-city", "setup-public-support"]) {
    assert.equal(await page.locator(`#${id}`).count(), 1, `Missing setup field: ${id}`);
  }

  await page.locator("#setup-token").fill(token);
  await page.locator("#setup-office-name").fill(`Staatliches Schulamt Browser QA ${suffix}`);
  await page.locator("#setup-office-email").fill(authorityEmail);
  await page.locator("#setup-office-password").fill(password);
  await page.locator("#setup-office-city").fill("Browserstadt");
  await page.locator("#setup-public-support").fill(`QA Hilfe ${suffix} · qa-hilfe@setup-qa.local`);
  await page.screenshot({ path: path.join(output, "setup-wizard-access.png"), fullPage: true, animations: "disabled" });

  await page.getByRole("button", { name: "Weiter" }).click();
  await page.locator("#setup-header-text").waitFor();
  await page.locator("#setup-header-text").fill(`Staatliches Schulamt Browser QA ${suffix}`);
  await page.locator("#setup-return-address").fill("QA-Straße 1 · 80331 Browserstadt");
  await page.locator("#setup-contact-address").fill("QA-Straße 1\n80331 Browserstadt");
  await page.locator("#setup-contact-person").fill("Browser QA Team");
  await page.locator("#setup-director-name").fill("Erika Browser");
  await page.locator("#setup-director-title").fill("Schulamtsdirektorin");
  await page.locator("#setup-document-subject").fill("Mobile Reserve");
  await page.locator("#setup-document-intro").fill("Einleitung Browser QA");
  await page.locator("#setup-document-closing").fill("Mit freundlichen Grüßen");

  await page.getByRole("button", { name: "Weiter" }).click();
  await page.locator("#setup-impressum").waitFor();
  await page.locator("#setup-impressum").fill(`Impressum Browser QA ${suffix}`);
  await page.locator("#setup-privacy-policy").fill(`Datenschutz Browser QA ${suffix}`);
  await page.locator("#setup-school-0-name").fill(`Grundschule Browser QA ${suffix}`);
  await page.locator("#setup-school-0-address").fill("Schulweg 2, 80331 Browserstadt");
  await page.locator("#setup-school-0-email").fill(schoolEmail);
  await page.locator("#setup-school-0-password").fill(password);
  await page.screenshot({ path: path.join(output, "setup-wizard-public-settings.png"), fullPage: true, animations: "disabled" });

  await page.getByRole("button", { name: "Weiter" }).click();
  await page.getByText("Mail-Anbindung").waitFor();
  await page.getByText("Später einrichten").waitFor();
  await page.getByRole("button", { name: "Weiter" }).click();
  await page.getByRole("button", { name: "Einrichtung abschließen" }).click();
  await page.waitForURL(/\/schulamt/, { timeout: 20_000 });
  await page.screenshot({ path: path.join(output, "setup-wizard-complete.png"), fullPage: true, animations: "disabled" });
  assert.deepEqual(pageErrors, []);
  console.log(`Setup UI QA passed for ${authorityEmail}. Screenshots: ${output}`);
} finally {
  await browser.close();
}
