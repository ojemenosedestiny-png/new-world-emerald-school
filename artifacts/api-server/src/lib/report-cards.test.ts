import assert from "node:assert/strict";
import { test } from "node:test";
import { AFFECTIVE_TRAITS, GRADE_SCALE, buildClassReport, gradeFor, rank, schemeFor, schemeMaxima, schemePossible, traitsProblem, validScorePart, nextStatus, scaleProblem, signatureProblem } from "./report-cards";

test("grades follow the school scale at every boundary", () => {
  const cases: [number, string, string][] = [
    // The school's grading system: 80+ A, 65-79 B, 55-64 C, 50-54 D, 49 and below U (ungraded).
    [100, "A", "Excellent"], [80, "A", "Excellent"], [79.9, "B", "Very good"], [79, "B", "Very good"], [65, "B", "Very good"],
    [64.9, "C", "Good"], [64, "C", "Good"], [55, "C", "Good"], [54.5, "D", "Pass"], [54, "D", "Pass"], [50, "D", "Pass"],
    [49.9, "U", "Ungraded"], [49, "U", "Ungraded"], [0, "U", "Ungraded"],
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
  assert.deepEqual(s(1).subjects.map((r) => [r.subjectId, r.total, r.grade, r.position]), [[10, 85, "A", 1], [20, 70, "B", 2]]);
  assert.deepEqual(s(2).subjects.map((r) => [r.subjectId, r.total, r.grade, r.position]), [[10, 50.5, "D", 3], [20, 95, "A", 1]]);
  // Student 3 took one subject: averaged over subjects taken, so 85% ranks first.
  assert.deepEqual([s(3).subjectsTaken, s(3).average, s(3).position], [1, 85, 1]);
  assert.deepEqual([s(1).total, s(1).average, s(1).grade, s(1).position], [155, 77.5, "B", 2]);
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
  assert.deepEqual(report.students[0].subjects.map((r) => [r.total, r.percent, r.grade]), [[30, 30, "U"]]);
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
  assert.deepEqual([a.subjects[0].total, a.subjects[0].grade, a.subjects[0].position], [72, "B", 1]);
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

test("CA 1, CA 2 and exam add up, and each result carries its subject teacher's comment", () => {
  const report = buildClassReport([1, 2], [10], [
    { studentId: 1, subjectId: 10, ca: 18, ca2: 17, exam: 50, comment: "Excellent work" },
    { studentId: 2, subjectId: 10, ca: 10, ca2: null, exam: 30 },
  ], { caMax: 20, ca2Max: 20, examMax: 60 });
  const [a, b] = report.students.map((s) => s.subjects[0]);
  assert.deepEqual([a.ca, a.ca2, a.exam, a.total, a.percent, a.grade, a.comment], [18, 17, 50, 85, 85, "A", "Excellent work"]);
  assert.deepEqual([b.ca2, b.total, b.grade, b.comment], [null, 40, "U", ""]);
  assert.deepEqual([report.subjectStats[0].highest, report.subjectStats[0].lowest, report.subjectStats[0].average], [85, 40, 62.5]);
  // A CA 2 mark alone counts as taking the subject.
  assert.equal(buildClassReport([3], [10], [{ studentId: 3, subjectId: 10, ca: null, ca2: 12, exam: null }], { caMax: 20, ca2Max: 20, examMax: 60 }).students[0].subjects[0].total, 12);
});

test("behaviour ratings: the school's 16 traits, each rated 1 to 5", () => {
  assert.equal(AFFECTIVE_TRAITS.length, 16);
  assert.equal(traitsProblem({ Punctuality: 4, Honesty: 5 }), null);
  assert.equal(traitsProblem({}), null);
  assert.match(traitsProblem({ Punctuality: 6 })!, /1 to 5/);
  assert.match(traitsProblem({ Punctuality: 2.5 })!, /1 to 5/);
  assert.match(traitsProblem({ Singing: 3 })!, /Unknown/);
});

test("primary (Year 1 to 6): Mid-term and End-term out of 100, final is their average, no positions", () => {
  assert.equal(schemeFor("Year 3"), "primary");
  assert.equal(schemeFor("Primary 5B"), "primary");
  assert.equal(schemeFor("JSS 2"), "secondary");
  assert.equal(schemeFor("Nursery 1"), "secondary");
  const term = { caMax: 20, ca2Max: 20, examMax: 60 };
  assert.deepEqual(schemeMaxima(term, "primary"), { caMax: 100, ca2Max: 0, examMax: 100 });
  assert.equal(schemePossible(term, "primary"), 100);
  const report = buildClassReport([1, 2], [10, 11], [
    { studentId: 1, subjectId: 10, ca: 80, ca2: 15, exam: 90, total: null, grade: null },
    { studentId: 1, subjectId: 11, ca: 60, exam: 71, total: null, grade: null },
    { studentId: 2, subjectId: 10, ca: 90, exam: 95, total: null, grade: null },
  ], schemeMaxima(term, "primary"), GRADE_SCALE, "primary");
  const ada = report.students.find((s) => s.studentId === 1)!;
  // (80 + 90) / 2 = 85; CA 2 is ignored. (60 + 71) / 2 = 65.5.
  assert.deepEqual(ada.subjects.map((s) => [s.total, s.percent, s.grade, s.position, s.ca2]), [[85, 85, "A", 0, null], [65.5, 65.5, "B", 0, null]]);
  assert.deepEqual([ada.total, ada.average, ada.grade, ada.position], [150.5, 75.3, "B", null]);
  assert.equal(report.students.find((s) => s.studentId === 2)!.position, null);
  assert.equal(report.ranked, 2);
  assert.deepEqual(report.subjectStats.find((s) => s.subjectId === 10), { subjectId: 10, average: 88.8, highest: 92.5, lowest: 85, entries: 2 });
});
