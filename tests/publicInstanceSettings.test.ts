import assert from "node:assert/strict";
import test from "node:test";
import { publicInstanceSettingsSchema, settingsFromRecords } from "../src/lib/publicInstanceSettings";

test("public instance settings accept local uploaded login logos", () => {
  const result = publicInstanceSettingsSchema.safeParse({
    publicInstanceName: "Staatliches Schulamt Beispielstadt",
    publicSupportContact: "service@example.de",
    impressum: "Impressum",
    privacyPolicy: "Datenschutz",
    loginLogoUrl: "/uploads/a0a0a0a0-0000-4000-8000-000000000000.png",
    loginLogoAlt: "Logo des Schulamts",
  });
  assert.equal(result.success, true);
});

test("public instance settings reject remote and data login logos", () => {
  for (const loginLogoUrl of ["https://example.test/logo.png", "data:image/png;base64,abc"]) {
    const result = publicInstanceSettingsSchema.safeParse({ publicInstanceName: "Schulamt", loginLogoUrl });
    assert.equal(result.success, false);
  }
});

test("public records only expose supported public defaults", () => {
  assert.deepEqual(settingsFromRecords([{ id: "smtpPass", value: "secret" }, { id: "publicInstanceName", value: "Schulamt" }]), {
    publicInstanceName: "Schulamt", publicSupportContact: "", impressum: "", privacyPolicy: "", loginLogoUrl: "", loginLogoAlt: "",
  });
});
