import assert from "node:assert/strict";
import test from "node:test";
import { schulamtOnboardingSchema } from "../src/lib/onboarding";

const base = {
  name: "Schulamt QA", email: "schulamt@example.test", password: "ein-sicheres-passwort", setupToken: "test",
  profile: { headerText: "Schulamt QA", returnAddress: "QA-Weg 1", contactAddress: "QA-Weg 1", contactPerson: "QA Team", city: "QA", amtsleitungName: "Erika QA", amtsleitungTitle: "Leitung", documentSubject: "Betreff", documentIntro: "Einleitung", documentClosing: "Gruß", mailProvider: "NONE" },
  schools: [{ name: "QA Schule", address: "Schulweg 1", type: "GRUNDSCHULE", email: "schule@example.test", password: "ein-sicheres-passwort" }],
};

test("onboarding accepts omitted public settings for older setup clients", () => {
  assert.equal(schulamtOnboardingSchema.safeParse(base).success, true);
});

test("onboarding accepts combined schools and rejects unsupported school types", () => {
  for (const type of ["GRUNDSCHULE", "MITTELSCHULE", "GS_MS"]) {
    const result = schulamtOnboardingSchema.safeParse({ ...base, schools: [{ ...base.schools[0], type }] });
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.schools[0].type, type);
  }
  assert.equal(schulamtOnboardingSchema.safeParse({ ...base, schools: [{ ...base.schools[0], type: "BOTH" }] }).success, false);
});

test("onboarding preserves optional public legal and contact texts", () => {
  const result = schulamtOnboardingSchema.safeParse({ ...base, publicSettings: { supportContact: "QA-Hilfe", impressum: "Betreiber QA", privacyPolicy: "Datenschutz QA" } });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.publicSettings?.impressum, "Betreiber QA");
});
