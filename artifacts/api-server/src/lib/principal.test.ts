import test from "node:test";
import assert from "node:assert/strict";
import { classSection, describeActivity, examTerm, lagosDay, lagosToday, lastDays } from "./principal";

test("audit entries read as plain teaching work; reading and student actions are left out", () => {
  assert.deepEqual(describeActivity("PUT /portal/attendance"), { kind: "register", label: "Took the class register" });
  assert.deepEqual(describeActivity("portal.saveScores"), { kind: "scores", label: "Entered report card scores and comments" });
  assert.deepEqual(describeActivity("portal.grade"), { kind: "marking", label: "Marked an exam script" });
  assert.deepEqual(describeActivity("POST /portal/submissions/12/mark"), { kind: "marking", label: "Marked a homework submission" });
  assert.deepEqual(describeActivity("POST /portal/message-threads/4/student"), { kind: "messages", label: "Replied to a student's message" });
  assert.deepEqual(describeActivity("portal.workflow"), { kind: "scores", label: "Sent or took back results for approval" });
  assert.equal(describeActivity("portal.somethingNew")?.label, "Worked in the portal");
  assert.equal(describeActivity("POST /portal/my-messages/read"), null);
  assert.equal(describeActivity("POST /portal/my-assignments/3/submit"), null);
});

test("a school day runs midnight to midnight in Lagos (UTC+1)", () => {
  const d = lagosDay("2026-11-04")!;
  assert.equal(d.start.toISOString(), "2026-11-03T23:00:00.000Z");
  assert.equal(d.end.toISOString(), "2026-11-04T23:00:00.000Z");
  assert.equal(lagosDay("2026-02-31"), null);
  assert.equal(lagosDay("04/11/2026"), null);
  // 23:30 UTC is already the next day in Lagos.
  assert.equal(lagosToday(new Date("2026-11-04T23:30:00Z")), "2026-11-05");
  assert.equal(lagosToday(new Date("2026-11-04T22:30:00Z")), "2026-11-04");
});

test("classes belong to the primary principal (Year 1-6) or the secondary principal (Year 7 / JSS 1 to SS 3)", () => {
  for (const n of ["Year 1", "year6", "Primary 4", "Primary 3B", "Basic 2", "Grade 5", "Pry 1"]) assert.equal(classSection(n), "primary", n);
  for (const n of ["JSS 1", "jss3", "JSS 2A", "SS 1", "SSS 3", "SS 2 Science", "Year 7", "Year 12", "Basic 8"]) assert.equal(classSection(n), "secondary", n);
  for (const n of ["Nursery 1", "Creche", "KG 2", "Reception", "Primary 7", "Year 13", "Class of 2026", "Grade 0"]) assert.equal(classSection(n), null, n);
});

test("exams fall in a school term by their date in Lagos", () => {
  assert.deepEqual(examTerm(new Date("2026-11-04T09:00:00Z")), { key: "2026-1", label: "First Term, 2026/2027" });
  assert.deepEqual(examTerm(new Date("2027-02-10T09:00:00Z")), { key: "2026-2", label: "Second Term, 2026/2027" });
  assert.deepEqual(examTerm(new Date("2027-06-01T09:00:00Z")), { key: "2026-3", label: "Third Term, 2026/2027" });
  // 23:30 UTC on 31 August is already 1 September in Lagos.
  assert.equal(examTerm(new Date("2026-08-31T23:30:00Z")).key, "2026-1");
  assert.deepEqual(lastDays("2026-11-02", 3), ["2026-10-31", "2026-11-01", "2026-11-02"]);
});
