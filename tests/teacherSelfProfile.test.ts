import assert from "node:assert/strict";
import test from "node:test";
import { teacherSelfProfileSchema } from "../src/lib/teacherSelfProfile";

test("teacher self profile accepts only complete identity and home-position data", () => {
  const result = teacherSelfProfileSchema.safeParse({ address: "Musterstraße 12, 80331 München", postalCode: "80331", homeLat: 48.137, homeLng: 11.575, phone: "089 12345" });
  assert.equal(result.success, true);
});

test("teacher self profile rejects lifecycle and assignment fields", () => {
  const result = teacherSelfProfileSchema.safeParse({ address: "Musterstraße 12", postalCode: "80331", homeLat: 48.137, homeLng: 11.575, status: "ACTIVE" });
  assert.equal(result.success, false);
});

test("teacher self profile requires actual numeric confirmed coordinates", () => {
  for (const homeLat of [null, "", " ", true]) {
    const result = teacherSelfProfileSchema.safeParse({ address: "Musterstraße 12", postalCode: "80331", homeLat, homeLng: 11.575 });
    assert.equal(result.success, false);
  }
});
