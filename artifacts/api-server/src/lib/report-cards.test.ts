import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClassReport, gradeFor, rank, validScorePart, nextStatus, scaleProblem, signatureProblem } from "./report-cards";

test("grades follow the school scale at every boundary", () => {
  const cases: [number, string, string][] = [
    [100, "A", "Excellent"], [70, "A", "Excellent"], [69.9, "B", "Very good"], [60, "B", "Very good"],
    [59.5, "C", "Good"], [50, "C", "Good"], [49, "D", "Fair"], [45, "D", "Fair"], [44.5, "E", "Pass"],
    [40, "E", "Pass"], [39.9, "F", "Fail"], [0, "F", "Fail"],
  ];
  for (const [percent, grade, remark] of cases) assert.deepEqual(gradeFor(percent), { grade, remark }, String(percent));
});

test("ties share a position and the next position is skipped", () => {
  const people = [{ n: "a", v: 80 }, { n: "b", v: 95 }, { n: "c", v: 80 }, { n: "d", v: 60 }];
  const positions = rank(people, (p) => p.v);
  assert.deepEqual(people.map((p) => positions.get(p)), [2, 1, 2, 4]);
});

test("class report computes totals, grades, subject positions, averages and class positions", () => {
  // Students 1-4, subjects 10 (Maths) and 20 (English); CA out of 40, exam out of 60.
  const report = buildClassReport([1, 2, 3, 4], [10, 20], [
    { studentId: 1, subjectId: 10, ca: 35, exam: 50 },   // 85
    { studentId: 1, subjectId: 20, ca: 30, exam: 40 },   // 70
    { studentId: 2, subjectId: 10, ca: 20, exam: 30.5 }, // 50.5
    { studentId: 2, subjectId: 20, ca: 38, exam: 57 },   // 95
    { studentId: 3, subjectId: 10, ca: 35, exam: 50 },   // 85 (ties student 1 in Maths)
    { studentId: 3, subjectId: 20, ca: null, exam: null }, // not entered: ignored
    { studentId: 99, subjectId: 10, ca: 40, exam: 60 },  // not in class: ignored
  ], { caMax: 40, examMax: 60 });
  const s = (id: number) => report.students.find((r) => r.studentId === id)!;
  assert.deepEqual(s(1).subjects.map((r) => [r.subjectId, r.total, r.grade, r.position]), [[10, 85, "A", 1], [20, 70, "A", 2]]);
  assert.deepEqual(s(2).subjects.map((r) => [r.subjectId, r.total, r.grade, r.position]), [[10, 50.5, "C", 3], [20, 95, "A", 1]]);
  // Student 3 took one subject: averaged over subjects taken, so 85% ranks first.
  assert.deepEqual([s(3).subjectsTaken, s(3).average, s(3).position], [1, 85, 1]);
  assert.deepEqual([s(1).total, s(1).average, s(1).grade, s(1).position], [155, 77.5, "A", 2]);
  assert.deepEqual([s(2).total, s(2).average, s(2).position], [145.5, 72.8, 3]);
  assert.equal(s(4).position, null);
  assert.equal(s(4).average, null);
  assert.equal(report.ranked, 3);
  assert.deepEqual(report.subjectStats, [
    { subjectId: 10, average: 73.5, highest: 85, lowest: 50.5, entries: 3 },
    { subjectId: 20, average: 82.5, highest: 95, lowest: 70, entries: 2 },
  ]);
});

test("a single entered part still counts toward the subject", () => {
  const report = buildClassReport([1], [10], [{ studentId: 1, subjectId: 10, ca: 30, exam: null }], { caMax: 40, examMax: 60 });
  assert.deepEqual(report.students[0].subjects.map((r) => [r.total, r.percent, r.grade]), [[30, 30, "F"]]);
});

test("score parts must be empty or between 0 and the maximum in half marks", () => {
  for (const ok of [null, undefined, 0, 12.5, 40]) assert.equal(validScorePart(ok, 40), true, String(ok));
  for (const bad of [-1, 40.5, 12.3, Number.NaN, Infinity]) assert.equal(validScorePart(bad, 40), false, String(bad));
});

test("report cards: the office's grading scale is checked and used for grades", () => {
  const scale = [{ min: 75, grade: "A1", remark: "Excellent" }, { min: 50, grade: "C4", remark: "Credit" }, { min: 0, grade: "F9", remark: "Fail" }];
  assert.equal(scaleProblem(scale), null);
  assert.match(scaleProblem([{ min: 50, grade: "A", remark: "" }, { min: 60, grade: "B", remark: "" }, { min: 0, grade: "F", remark: "" }])!, /highest minimum/);
  assert.match(scaleProblem([{ min: 50, grade: "A", remark: "" }, { min: 10, grade: "B", remark: "" }])!, /start at 0/);
  assert.match(scaleProblem([{ min: 50, grade: "A", remark: "" }, { min: 0, grade: "a", remark: "" }])!, /once/);
  assert.deepEqual(gradeFor(80, scale), { grade: "A1", remark: "Excellent" });
  const report = buildClassReport([1], [10], [{ studentId: 1, subjectId: 10, ca: 30, exam: 30 }], { caMax: 40, examMax: 60 }, scale);
  assert.equal(report.students[0].subjects[0].grade, "C4");
  assert.equal(report.students[0].grade, "C4");
});

test("report cards: typed totals and grades replace the calculated ones (manual results)", () => {
  const report = buildClassReport([1, 2], [10], [
    { studentId: 1, subjectId: 10, ca: null, exam: null, total: 72, grade: null },
    { studentId: 2, subjectId: 10, ca: 10, exam: 20, total: null, grade: "A" },
  ], { caMax: 40, examMax: 60 });
  const [a, b] = report.students;
  assert.deepEqual([a.subjects[0].total, a.subjects[0].grade, a.subjects[0].position], [72, "A", 1]);
  assert.deepEqual([b.subjects[0].total, b.subjects[0].grade, b.subjects[0].remark, b.subjects[0].position], [30, "A", "Excellent", 2]);
});

test("report cards: results move draft, teacher review, approval, published, and only the office approves", () => {
  assert.deepEqual(nextStatus("draft", "submit", "teacher"), { status: "review" });
  assert.deepEqual(nextStatus("review", "withdraw", "teacher"), { status: "draft" });
  assert.match((nextStatus("review", "approve", "teacher") as { problem: string }).problem, /principal or school office/);
  assert.deepEqual(nextStatus("review", "approve", "admin"), { status: "approved" });
  assert.match((nextStatus("draft", "publish", "admin") as { problem: string }).problem, /Approve/);
  assert.deepEqual(nextStatus("approved", "publish", "admin"), { status: "published" });
  assert.deepEqual(nextStatus("published", "unpublish", "admin"), { status: "approved" });
  assert.deepEqual(nextStatus("approved", "return", "admin"), { status: "draft" });
  assert.match((nextStatus("draft", "approve", "admin") as { problem: string }).problem, /review and sign/);
});

test("report cards: signatures are small image data URLs", () => {
  assert.equal(signatureProblem(null), null);
  assert.equal(signatureProblem("data:image/png;base64,iVBORw0KGgo="), null);
  assert.match(signatureProblem("data:text/html;base64,PHNjcmlwdD4=")!, /PNG, JPEG or WebP/);
  assert.match(signatureProblem("javascript:alert(1)")!, /PNG/);
  assert.match(signatureProblem("data:image/png;base64," + "A".repeat(200_001))!, /too large/);
});
