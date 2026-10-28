import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool, portalClasses, portalStudents, portalSessions, portalTerms, portalSubjects, portalScores, portalReportCards, portalReportReleases, portalReportSettings, portalReportWorkflow,
} from "@workspace/db";
import portalRouter from "../routes/portal";
import { hashPassword } from "./portal-auth";

// Database-only report card checks (no object storage). Run against a disposable database.
test("report cards: setup, validation, scoring, remarks, release and student visibility", async () => {
  const previous = process.env.SCHOOL_ADMIN_EMAILS;
  process.env.SCHOOL_ADMIN_EMAILS = "portal-reports-admin@example.test";
  const marker = `QA-RPT-${randomUUID().slice(0, 8)}`.toUpperCase();
  const classIds: number[] = [];
  const termIds: number[] = [];
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use((req, _res, next) => {
    req.log = { error() {}, warn() {}, info() {} } as unknown as typeof req.log;
    if (req.headers["x-test-admin"] === marker) {
      req.dbUser = { id: "synthetic-reports-test" } as NonNullable<typeof req.dbUser>;
      req.identity = { email: "portal-reports-admin@example.test", emailVerified: true };
    }
    next();
  });
  app.use("/api/portal", portalRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/portal`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function call(path: string, method = "GET", body?: unknown, cookie = "", admin = false): Promise<{ status: number; cookie: string; data: any }> {
    const response = await fetch(root + path, {
      method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(admin ? { "X-Test-Admin": marker } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "", data: response.status === 204 ? {} : await response.json() };
  }
  const command = (body: unknown) => call("/reports/manage", "POST", body, "", true);
  try {
    const [cls] = await db.insert(portalClasses).values({ name: marker }).returning(); classIds.push(cls.id);
    const [other] = await db.insert(portalClasses).values({ name: `${marker}-B` }).returning(); classIds.push(other.id);
    const password = "Individual-Pass-5271!";
    const hash = await hashPassword(password);
    const students = await db.insert(portalStudents).values([
      { studentId: `${marker}-1`, name: "Ada Obi", classId: cls.id, passwordHash: hash, mustChangePassword: false },
      { studentId: `${marker}-2`, name: "Bayo Ade", classId: cls.id, passwordHash: hash, mustChangePassword: false },
      { studentId: `${marker}-3`, name: "Chi Eze", classId: other.id, passwordHash: hash, mustChangePassword: false },
    ]).returning();
    const [ada, bayo, chi] = students;

    // Only staff reach the workspace; guests and students do not.
    assert.equal((await call("/reports/manage")).status, 401);
    const login = await call("/session", "POST", { studentId: ada.studentId, password });
    assert.equal(login.status, 200);
    assert.equal((await call("/reports/manage", "GET", undefined, login.cookie)).status, 403);
    assert.equal((await call("/reports/manage", "POST", { action: "releaseReports", release: { termId: 1, classId: cls.id, released: true } }, login.cookie)).status, 403);

    // Terms: session format, duplicates and creation.
    const session = `20${String(Math.floor(Math.random() * 40) + 40)}`;
    const sessionName = `${session}/${Number(session) + 1}`;
    assert.equal((await command({ action: "saveTerm", term: { session: "2026-27", term: "First Term", caMax: 40, examMax: 60 } })).status, 400);
    assert.equal((await command({ action: "saveTerm", term: { session: sessionName, term: "First Term", caMax: 40, examMax: 60, nextTermBegins: "12 January" } })).status, 200);
    assert.equal((await command({ action: "saveTerm", term: { session: sessionName, term: "First Term", caMax: 40, examMax: 60 } })).status, 409);
    const [term] = await db.select().from(portalTerms).where(eq(portalTerms.session, sessionName)); termIds.push(term.id);

    // Subjects per class, with duplicate protection.
    for (const name of ["Mathematics", "English Language"]) assert.equal((await command({ action: "saveSubject", subject: { classId: cls.id, name } })).status, 200);
    assert.equal((await command({ action: "saveSubject", subject: { classId: cls.id, name: "mathematics" } })).status, 409);
    assert.equal((await command({ action: "saveSubject", subject: { classId: other.id, name: "Mathematics" } })).status, 200);
    const subjects = await db.select().from(portalSubjects).where(inArray(portalSubjects.classId, classIds));
    const maths = subjects.find((s) => s.classId === cls.id && s.name === "Mathematics")!;
    const english = subjects.find((s) => s.classId === cls.id && s.name === "English Language")!;
    const otherMaths = subjects.find((s) => s.classId === other.id)!;

    // Score validation: maximum, half marks, and the subject must belong to the student's class.
    const scores = (entries: unknown[]) => command({ action: "saveScores", scores: { termId: term.id, entries } });
    assert.equal((await scores([{ studentId: ada.id, subjectId: maths.id, ca: 41, exam: 50 }])).status, 400);
    assert.equal((await scores([{ studentId: ada.id, subjectId: maths.id, ca: 30.3, exam: 50 }])).status, 400);
    assert.equal((await scores([{ studentId: ada.id, subjectId: otherMaths.id, ca: 30, exam: 50 }])).status, 400);
    assert.equal((await scores([
      { studentId: ada.id, subjectId: maths.id, ca: 35, exam: 50 },
      { studentId: ada.id, subjectId: english.id, ca: 30, exam: 40 },
      { studentId: bayo.id, subjectId: maths.id, ca: 20, exam: 30.5 },
      { studentId: bayo.id, subjectId: english.id, ca: 38, exam: 57 },
      { studentId: chi.id, subjectId: otherMaths.id, ca: 40, exam: 60 },
    ])).status, 200);
    // Re-saving updates in place; clearing both parts removes the entry.
    assert.equal((await scores([{ studentId: bayo.id, subjectId: english.id, ca: 38, exam: 56 }])).status, 200);
    assert.equal((await db.select().from(portalScores).where(eq(portalScores.studentId, bayo.id))).length, 2);

    // Remarks and attendance, with validation.
    const cards = (entries: unknown[]) => command({ action: "saveCards", cards: { termId: term.id, entries } });
    assert.equal((await cards([{ studentId: ada.id, teacherRemark: "x", principalRemark: "", daysPresent: 70, daysOpen: 60 }])).status, 400);
    assert.equal((await cards([{ studentId: ada.id, teacherRemark: "A focused and diligent pupil.", principalRemark: "Excellent result. Keep it up.", daysPresent: 58, daysOpen: 60 }])).status, 200);

    // Staff workspace shows computed results and statistics.
    const ws = await call(`/reports/manage?termId=${term.id}&classId=${cls.id}`, "GET", undefined, "", true);
    assert.equal(ws.status, 200);
    assert.equal(ws.data.canAdmin, true);
    assert.deepEqual(ws.data.students.map((s: { name: string }) => s.name), ["Ada Obi", "Bayo Ade"]);
    const adaResult = ws.data.results.find((r: { studentId: number }) => r.studentId === ada.id);
    assert.deepEqual([adaResult.total, adaResult.average, adaResult.grade, adaResult.position], [155, 77.5, "A", 1]);
    assert.equal(ws.data.released, false);

    // Nothing is visible to students before release.
    assert.deepEqual((await call("/reports", "GET", undefined, login.cookie)).data.reports, []);

    // Release, then the student sees exactly their own report.
    assert.equal((await command({ action: "releaseReports", release: { termId: term.id, classId: cls.id, released: true } })).status, 200);
    const mine = await call("/reports", "GET", undefined, login.cookie);
    assert.equal(mine.status, 200);
    assert.equal(mine.data.reports.length, 1);
    const report = mine.data.reports[0];
    assert.equal(report.term.session, sessionName);
    assert.equal(report.term.nextTermBegins, "12 January");
    assert.equal(report.result.studentId, ada.id);
    assert.deepEqual(report.result.subjects.map((s: { total: number; grade: string; position: number }) => [s.total, s.grade, s.position]), [[85, "A", 1], [70, "A", 2]]);
    assert.equal(report.classSize, 2);
    assert.deepEqual(report.card, { studentId: ada.id, teacherRemark: "A focused and diligent pupil.", principalRemark: "Excellent result. Keep it up.", daysPresent: 58, daysOpen: 60 });
    assert.equal(JSON.stringify(mine.data).includes(bayo.name), false, "another student's identity must not leak");

    // Released results are locked; structure with scores cannot be deleted.
    assert.equal((await scores([{ studentId: ada.id, subjectId: maths.id, ca: 40, exam: 60 }])).status, 409);
    assert.equal((await cards([{ studentId: ada.id, teacherRemark: "changed", principalRemark: "", daysPresent: 1, daysOpen: 60 }])).status, 409);
    assert.equal((await command({ action: "deleteSubject", target: { id: maths.id } })).status, 409);
    assert.equal((await command({ action: "deleteTerm", target: { id: term.id } })).status, 409);
    assert.equal((await command({ action: "saveTerm", term: { id: term.id, session: sessionName, term: "First Term", caMax: 30, examMax: 70 } })).status, 409);

    // A student in another class never sees this class's report.
    const chiLogin = await call("/session", "POST", { studentId: chi.studentId, password });
    assert.deepEqual((await call("/reports", "GET", undefined, chiLogin.cookie)).data.reports, []);

    // Withholding hides it again and unlocks edits.
    assert.equal((await command({ action: "releaseReports", release: { termId: term.id, classId: cls.id, released: false } })).status, 200);
    assert.deepEqual((await call("/reports", "GET", undefined, login.cookie)).data.reports, []);
    assert.equal((await scores([{ studentId: ada.id, subjectId: maths.id, ca: null, exam: null }])).status, 200);
    assert.equal((await db.select().from(portalScores).where(eq(portalScores.studentId, ada.id))).length, 1);

    // The office sets the grading scale and the principal's signature.
    const scale = [{ min: 75, grade: "A1", remark: "Excellent" }, { min: 50, grade: "C4", remark: "Credit" }, { min: 0, grade: "F9", remark: "Fail" }];
    const signature = "data:image/png;base64,iVBORw0KGgo=";
    assert.equal((await command({ action: "saveSettings", settings: { gradingScale: [{ min: 50, grade: "A", remark: "" }, { min: 60, grade: "B", remark: "" }], principalName: "", principalSignature: null } })).status, 400);
    assert.equal((await command({ action: "saveSettings", settings: { gradingScale: scale, principalName: "Mrs P. Principal", principalSignature: "data:text/html;base64,PHA+" } })).status, 400);
    assert.equal((await command({ action: "saveSettings", settings: { gradingScale: scale, principalName: "Mrs P. Principal", principalSignature: signature } })).status, 200);
    assert.equal((await call("/reports/manage", "POST", { action: "saveSettings", settings: { gradingScale: scale, principalName: "", principalSignature: null } }, login.cookie)).status, 403);

    // Manual results: in manual mode a typed total and grade count; in automatic mode they are ignored.
    assert.equal((await scores([{ studentId: ada.id, subjectId: maths.id, ca: null, exam: null, total: 72, grade: null }])).status, 200);
    assert.equal((await db.select().from(portalScores).where(eq(portalScores.studentId, ada.id))).length, 1, "a typed total alone is not saved in automatic mode");
    assert.equal((await command({ action: "setMode", mode: { termId: term.id, classId: cls.id, mode: "manual" } })).status, 200);
    assert.equal((await scores([{ studentId: ada.id, subjectId: maths.id, ca: null, exam: null, total: 101, grade: null }])).status, 400);
    assert.equal((await scores([{ studentId: ada.id, subjectId: maths.id, ca: null, exam: null, total: 72, grade: "Z" }])).status, 400, "grades come from the scale");
    assert.equal((await scores([{ studentId: ada.id, subjectId: maths.id, ca: null, exam: null, total: 72, grade: null }])).status, 200);
    const manual = await call(`/reports/manage?termId=${term.id}&classId=${cls.id}`, "GET", undefined, "", true);
    const adaManual = manual.data.results.find((r: { studentId: number }) => r.studentId === ada.id);
    assert.deepEqual(adaManual.subjects.map((s: { total: number; grade: string }) => [s.total, s.grade]), [[72, "C4"], [70, "C4"]]);
    assert.deepEqual([manual.data.workflow.status, manual.data.workflow.mode, manual.data.principalName], ["draft", "manual", "Mrs P. Principal"]);

    // Workflow: review, then approval, then publishing; edits are locked once approved.
    const flow = (action: string, note?: string) => command({ action: "workflow", workflow: { termId: term.id, classId: cls.id, action, ...(note ? { note } : {}) } });
    assert.equal((await flow("approve")).status, 400, "the class teacher reviews first");
    assert.equal((await flow("publish")).status, 400, "approve before publishing");
    assert.equal((await flow("submit")).status, 200);
    assert.equal((await call("/reports/manage", "POST", { action: "workflow", workflow: { termId: term.id, classId: cls.id, action: "approve" } }, login.cookie)).status, 403);
    assert.equal((await flow("approve")).status, 200);
    assert.equal((await scores([{ studentId: ada.id, subjectId: maths.id, ca: 40, exam: 60 }])).status, 409);
    assert.equal((await command({ action: "setMode", mode: { termId: term.id, classId: cls.id, mode: "automatic" } })).status, 409);
    assert.deepEqual((await call("/reports", "GET", undefined, login.cookie)).data.reports, [], "approved is not yet published");
    assert.equal((await flow("publish")).status, 200);
    const published = (await call("/reports", "GET", undefined, login.cookie)).data.reports[0];
    assert.deepEqual([published.className, published.principalName, published.principalSignature, published.gradingScale[0].grade], [cls.name, "Mrs P. Principal", signature, "A1"]);
    assert.equal(published.result.subjects[0].total, 72);
    assert.equal((await flow("unpublish")).status, 200);
    assert.deepEqual((await call("/reports", "GET", undefined, login.cookie)).data.reports, []);
    assert.equal((await flow("return", "Check the Mathematics totals.")).status, 200);
    const returned = await call(`/reports/manage?termId=${term.id}&classId=${cls.id}`, "GET", undefined, "", true);
    assert.deepEqual([returned.data.workflow.status, returned.data.workflow.returnNote], ["draft", "Check the Mathematics totals."]);
    assert.equal((await scores([{ studentId: ada.id, subjectId: maths.id, ca: 35, exam: 50, total: null, grade: null }])).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (termIds.length) {
      await db.delete(portalReportReleases).where(inArray(portalReportReleases.termId, termIds));
      await db.delete(portalReportWorkflow).where(inArray(portalReportWorkflow.termId, termIds));
      await db.delete(portalScores).where(inArray(portalScores.termId, termIds));
      await db.delete(portalReportCards).where(inArray(portalReportCards.termId, termIds));
      await db.delete(portalTerms).where(inArray(portalTerms.id, termIds));
    }
    if (classIds.length) {
      const ids = (await db.select({ id: portalStudents.id }).from(portalStudents).where(inArray(portalStudents.classId, classIds))).map((s) => s.id);
      if (ids.length) await db.delete(portalSessions).where(inArray(portalSessions.studentId, ids));
      await db.delete(portalSubjects).where(inArray(portalSubjects.classId, classIds));
      await db.delete(portalStudents).where(inArray(portalStudents.classId, classIds));
      await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    }
    await db.delete(portalReportSettings).where(eq(portalReportSettings.id, 1));
    if (previous === undefined) delete process.env.SCHOOL_ADMIN_EMAILS;
    else process.env.SCHOOL_ADMIN_EMAILS = previous;
    await pool.end();
  }
});
