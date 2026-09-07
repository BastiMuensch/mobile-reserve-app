import assert from "node:assert/strict";
import test from "node:test";
import {
  clampLeaveToTargetSchoolYear,
  existingIdentityKeysForTargetYear,
  identityKeys,
  MAX_TEACHERS_PER_COPY_BATCH,
  schoolYearDayBounds,
} from "../src/lib/teacherCopy";

test("copy batches remain bounded to a short transaction", () => {
  assert.equal(MAX_TEACHERS_PER_COPY_BATCH, 500);
});

test("duplicate matching only considers identities in the selected target year", () => {
  const keys = existingIdentityKeysForTargetYear([
    {
      userId: "former-user",
      email: "former@example.test",
      name: "Frühere Lehrkraft",
      stammschuleId: "school-a",
      schoolYear: "2025/2026",
    },
    {
      userId: "target-user",
      email: "target@example.test",
      name: "Ziel-Lehrkraft",
      stammschuleId: "school-a",
      schoolYear: "2026/2027",
    },
  ], "2026/2027");

  assert.equal(keys.has("user:former-user"), false);
  assert.equal(keys.has("user:target-user"), true);
  assert.equal(keys.has("email:target@example.test"), true);
});

test("identity fallback is only used without login and email", () => {
  assert.deepEqual(identityKeys({
    userId: "user-1",
    email: "Same.Name@example.test",
    name: "Same Name",
    stammschuleId: "school-a",
  }), ["user:user-1", "email:same.name@example.test"]);
  assert.deepEqual(identityKeys({
    userId: null,
    email: null,
    name: "  Same   Name ",
    stammschuleId: "school-a",
  }), ["name-school:same name:school-a"]);
});

test("an ongoing leave from the source year is available for the target year", () => {
  const result = clampLeaveToTargetSchoolYear({
    startDate: new Date("2026-04-15T00:00:00.000Z"),
    endDate: null,
    reportedBy: "SCHULAMT",
  }, "2026/2027");

  assert.ok(result);
  assert.equal(result.startDate.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(result.endDate, null);
  assert.equal(result.reportedBy, "SCHULAMT");
});

test("a bounded leave is clipped exactly to strict target-year calendar days", () => {
  const result = clampLeaveToTargetSchoolYear({
    startDate: new Date("2026-08-31T00:00:00.000Z"),
    endDate: new Date("2027-09-04T00:00:00.000Z"),
    reportedBy: "TEACHER",
  }, "2026/2027");

  assert.ok(result);
  assert.equal(result.startDate.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(result.endDate?.toISOString(), "2027-08-31T00:00:00.000Z");
});

test("leaves outside the target year are not copied and invalid school years fail", () => {
  assert.equal(clampLeaveToTargetSchoolYear({
    startDate: new Date("2025-01-01T00:00:00.000Z"),
    endDate: new Date("2025-08-31T00:00:00.000Z"),
    reportedBy: "SCHULAMT",
  }, "2026/2027"), null);
  assert.throws(() => schoolYearDayBounds("2026/2028"), /Ungültiges Schuljahr/);
});
