import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, assignmentValues, isCalendarDate, isLate, schoolDate, tally } from "./learning";

test("school dates use Lagos time and real calendar days", () => {
  // 23:30 UTC on 31 Dec is already 1 Jan in Lagos (UTC+1).
  assert.equal(schoolDate(new Date("2026-12-31T23:30:00Z")), "2027-01-01");
  assert.equal(isCalendarDate("2026-02-28"), true);
  assert.equal(isCalendarDate("2026-02-30"), false);
  assert.equal(isCalendarDate("26-2-3"), false);
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("attendance totals count late as present", () => {
  assert.deepEqual(tally(["present", "late", "absent", "excused", "present", "junk"]), { present: 2, late: 1, absent: 1, excused: 1, daysPresent: 3, daysRecorded: 5 });
  assert.deepEqual(tally([]), { present: 0, late: 0, absent: 0, excused: 0, daysPresent: 0, daysRecorded: 0 });
});

test("assignments: input checks and late submissions", () => {
  const ok = assignmentValues({ subject: " Maths ", title: " Fractions ", dueAt: "2026-11-01T17:00:00Z", maxScore: 20, published: true });
  assert.ok(ok.ok);
  assert.equal(ok.values.subject, "Maths");
  assert.equal(ok.values.instructions, "");
  assert.deepEqual(assignmentValues({ subject: "", title: "x", dueAt: "2026-11-01", maxScore: 1, published: false }), { ok: false, error: "Add a subject and a title." });
  assert.equal(assignmentValues({ subject: "x", title: "x", dueAt: "soon", maxScore: 1, published: false }).ok, false);
  assert.equal(isLate(new Date("2026-11-01T17:00:01Z"), new Date("2026-11-01T17:00:00Z")), true);
  assert.equal(isLate(new Date("2026-11-01T16:59:59Z"), new Date("2026-11-01T17:00:00Z")), false);
});
