import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, like } from "drizzle-orm";
import {
  db, pool, portalAttempts, portalAttendance, portalAuditLog, portalClasses, portalExams, portalPrincipals, portalReportReleases,
  portalReportWorkflow, portalScores, portalStudents, portalSubjects, portalTeachers, portalTerms,
} from "@workspace/db";
import portalRouter from "../routes/portal";
import { setApprovedIdentitiesForTest } from "./approved-identities";
import { hashPassword } from "./portal-auth";
import { examTerm, lagosToday } from "./principal";

const SIGNATURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// Database checks for the principals' oversight: the week's overview, the exams teachers set, and signing results.
test("principal oversight: overview, exams by term, and signing results", async () => {
  const marker = `QA-PRO-${randomUUID().slice(0, 8)}`.toUpperCase();
  const lower = marker.toLowerCase();
  const principal = `principal-${lower}@example.test`, primaryHead = `primary-${lower}@example.test`;
  const saved = { admins: process.env.SCHOOL_ADMIN_EMAILS, principals: process.env.SCHOOL_PRINCIPAL_EMAILS, primary: process.env.SCHOOL_PRIMARY_PRINCIPAL_EMAILS, supers: process.env.SCHOOL_SUPER_ADMIN_EMAILS };
  const boss = `boss-${lower}@example.test`;
  // The principals are not administrators: their own portal is all they get.
  process.env.SCHOOL_ADMIN_EMAILS = boss;
  process.env.SCHOOL_SUPER_ADMIN_EMAILS = boss;
  process.env.SCHOOL_PRINCIPAL_EMAILS = principal;
  process.env.SCHOOL_PRIMARY_PRINCIPAL_EMAILS = primaryHead;
  setApprovedIdentitiesForTest([[`id-${principal}`, { email: principal, mfa: true }], [`id-${primaryHead}`, { email: primaryHead, mfa: true }], [`id-${boss}`, { email: boss, mfa: true }]]);
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((req, _res, next) => {
    req.log = { error() {}, warn() {}, info() {} } as unknown as typeof req.log;
    const who = req.headers["x-test-user"];
    if (typeof who === "string") {
      req.dbUser = { id: `id-${who}` } as NonNullable<typeof req.dbUser>;
      req.identity = { email: who, emailVerified: true, mfa: true };
    }
    next();
  });
  app.use("/api/portal", portalRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/portal`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (path: string, who: string | null, body?: unknown): Promise<{ status: number; data: any }> => {
    const r = await fetch(root + path, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...(who ? { "X-Test-User": who } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  const classIds: number[] = [];
  let termId = 0;
  const savedPrincipals = await db.select().from(portalPrincipals);
  try {
    const [jss1] = await db.insert(portalClasses).values({ name: `${marker} JSS 1` }).returning();
    const [year2] = await db.insert(portalClasses).values({ name: `${marker} Year 2` }).returning();
    classIds.push(jss1.id, year2.id);
    const [musa] = await db.insert(portalTeachers).values({ email: `musa-${lower}@example.test`, name: `${marker} Mr Musa`, classIds: [jss1.id], active: true }).returning();
    await db.insert(portalTeachers).values({ email: `bisi-${lower}@example.test`, name: `${marker} Miss Bisi`, classIds: [year2.id], active: true });
    const [maths] = await db.insert(portalSubjects).values({ classId: jss1.id, name: "Mathematics", teacherId: musa.id }).returning();
    const pw = await hashPassword("Principal-Test-1");
    const [ada] = await db.insert(portalStudents).values({ studentId: `${marker}-1`, name: "Ada Obi", classId: jss1.id, passwordHash: pw }).returning();
    await db.insert(portalStudents).values({ studentId: `${marker}-2`, name: "Tunde Bello", classId: jss1.id, passwordHash: pw });
    const now = Date.now();
    const questions = [{ id: "q1", type: "mcq" as const, text: "2 + 2?", options: ["3", "4"], correctAnswer: 1, marks: 2 }, { id: "q2", type: "written" as const, text: "Explain.", options: [], marks: 8 }];
    // An older exam saved before "set by" was recorded (its subject teacher is shown), and one from a past term.
    const [current] = await db.insert(portalExams).values({ title: "Mid-term test", subject: "mathematics ", classId: jss1.id, durationMinutes: 40, startsAt: new Date(now - 3_600_000), endsAt: new Date(now + 3_600_000), mode: "questions", questions, published: true }).returning();
    await db.insert(portalExams).values({ title: "Old test", subject: "Mathematics", classId: jss1.id, durationMinutes: 30, startsAt: new Date("2025-03-10T09:00:00Z"), endsAt: new Date("2025-03-10T10:00:00Z"), mode: "questions", questions, published: true, createdBy: musa.email });
    await db.insert(portalExams).values({ title: "Spelling", subject: "English", classId: year2.id, durationMinutes: 20, startsAt: new Date(now - 3_600_000), endsAt: new Date(now + 3_600_000), mode: "questions", questions, published: false, createdBy: `${marker} Miss Bisi` });
    await db.insert(portalAttempts).values({ examId: current.id, studentId: ada.id, questions, answers: { q1: "1", q2: "Because" }, marks: [{ questionId: "q1", score: 2, feedback: "" }, { questionId: "q2", score: 6, feedback: "" }], status: "marked", deadline: new Date(now + 3_600_000) });
    await db.insert(portalAttendance).values({ classId: jss1.id, studentId: ada.id, date: lagosToday(), status: "present" });
    await db.insert(portalAuditLog).values({ at: new Date(), actorKind: "staff", actorLabel: musa.email, action: "PUT /portal/attendance", outcome: "success" });

    // The overview: the week, the class register today, exams this term.
    assert.equal((await call("/principal/dashboard", primaryHead)).status, 403);
    const dash = await call("/principal/dashboard", principal);
    assert.equal(dash.status, 200, JSON.stringify(dash.data));
    assert.equal(dash.data.days.length, 7);
    assert.equal(dash.data.examTerm, examTerm(new Date()).label);
    const musaWeek = dash.data.teachers.find((t: { id: number }) => t.id === musa.id);
    assert.deepEqual([musaWeek.activeToday, musaWeek.activeDays[6], musaWeek.counts.register, musaWeek.examsSet], [true, true, 1, 1]);
    const jssView = dash.data.classes.find((c: { id: number }) => c.id === jss1.id);
    assert.deepEqual([jssView.registerToday, jssView.examsThisTerm, jssView.students, jssView.classTeachers], [true, 1, 2, [`${marker} Mr Musa`]]);
    assert.equal(dash.data.classes.some((c: { id: number }) => c.id === year2.id), false);
    const primaryDash = await call("/principal/dashboard?section=primary", primaryHead);
    assert.equal(primaryDash.data.classes.find((c: { id: number }) => c.id === year2.id).registerToday, false);

    // Exams by term: this term's by default, with who set it and how the class did; older terms on request.
    const exams = await call("/principal/exams", principal);
    assert.equal(exams.status, 200, JSON.stringify(exams.data));
    assert.ok(exams.data.terms.some((t: { key: string; label: string }) => t.key === "2024-2" && t.label === "Spring Term, 2024/2025"));
    const mid = exams.data.exams.find((e: { id: number }) => e.id === current.id);
    assert.deepEqual([mid.setBy, mid.status, mid.questionCount, mid.totalMarks, mid.students, mid.sat, mid.marked, mid.averagePercent], [`${marker} Mr Musa`, "open", 2, 10, 2, 1, 1, 80]);
    const old = await call("/principal/exams?term=2024-2", principal);
    assert.deepEqual(old.data.exams.filter((e: { className: string }) => e.className.startsWith(marker)).map((e: { title: string; setBy: string }) => [e.title, e.setBy]), [["Old test", `${marker} Mr Musa`]]);
    const primaryExams = await call("/principal/exams?section=primary", primaryHead);
    assert.deepEqual(primaryExams.data.exams.filter((e: { className: string }) => e.className.startsWith(marker)).map((e: { title: string; status: string }) => [e.title, e.status]), [["Spelling", "draft"]]);
    const paper = await call(`/principal/exams/${current.id}`, principal);
    assert.equal(paper.status, 200, JSON.stringify(paper.data));
    assert.deepEqual(paper.data.questions.map((q: { correctAnswer: number | null }) => q.correctAnswer), [1, null]);
    assert.equal((await call(`/principal/exams/${current.id}`, primaryHead)).status, 403);

    // Signing results: the class teacher sends them; the principal signs with their own saved signature.
    const [term] = await db.insert(portalTerms).values({ session: "2091/2092", term: marker }).returning();
    termId = term.id;
    await db.insert(portalScores).values({ termId, studentId: ada.id, subjectId: maths.id, ca: 30, exam: 50 });
    await db.insert(portalReportWorkflow).values({ termId, classId: jss1.id, status: "review", teacherName: `${marker} Mr Musa`, submittedAt: new Date() });
    const results = await call(`/principal/results?termId=${termId}`, principal);
    assert.equal(results.status, 200, JSON.stringify(results.data));
    const jssResult = results.data.classes.find((c: { id: number }) => c.id === jss1.id);
    assert.deepEqual([jssResult.status, jssResult.scoresEntered, jssResult.scoresExpected, jssResult.signedByPrincipal], ["review", 1, 2, false]);
    const sign = (action: string, extra: object = {}, who = principal) => call("/principal/results", who, { action, section: "secondary", termId, classId: jss1.id, ...extra });
    assert.equal((await sign("approve")).status, 409, "a signature is needed first");
    // The super administrator can look, but cannot set or sign with the principal's signature.
    assert.equal((await call(`/principal/results?termId=${termId}`, boss)).status, 200);
    assert.equal((await call("/principal/results", boss, { action: "saveSignature", section: "secondary", name: "Boss", signature: SIGNATURE })).status, 403);
    assert.equal((await call("/principal/results", principal, { action: "saveSignature", section: "secondary", name: "Mrs Principal", signature: "data:text/html;base64,AAAA" })).status, 400);
    assert.equal((await call("/principal/results", principal, { action: "saveSignature", section: "primary", name: "X", signature: SIGNATURE })).status, 403);
    assert.equal((await call("/principal/results", principal, { action: "saveSignature", section: "secondary", name: "Mrs Principal", signature: SIGNATURE })).status, 200);
    assert.equal((await call("/principal/results", primaryHead, { action: "approve", section: "primary", termId, classId: jss1.id })).status, 403);
    assert.equal((await sign("publish")).status, 400, "only approved results are published");
    assert.equal((await sign("approve", {}, boss)).status, 403);
    const approved = await sign("approve");
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    const [row] = await db.select().from(portalReportWorkflow).where(and(eq(portalReportWorkflow.termId, termId), eq(portalReportWorkflow.classId, jss1.id)));
    assert.deepEqual([row.status, row.approvedBy, row.principalName, row.principalSignature], ["approved", "Mrs Principal", "Mrs Principal", SIGNATURE]);
    // The report cards print the principal who signed them; the principal previews them in their own portal only.
    assert.equal((await call(`/principal/report-cards?section=primary&termId=${termId}&classId=${jss1.id}`, primaryHead)).status, 403);
    // A principal is not a staff portal administrator: refused (401 in production; this test has no Clerk, so the staff lookup fails closed).
    assert.notEqual((await call(`/reports/manage?termId=${termId}&classId=${jss1.id}`, principal)).status, 200);
    const ws = await call(`/principal/report-cards?termId=${termId}&classId=${jss1.id}`, principal);
    assert.equal(ws.status, 200, JSON.stringify(ws.data));
    assert.deepEqual([ws.data.canAdmin, ws.data.students.length, ws.data.teachers], [false, 2, []]);
    assert.deepEqual([ws.data.cardPrincipalName, ws.data.cardPrincipalSignature], ["Mrs Principal", SIGNATURE]);
    assert.equal((await sign("publish")).status, 200);
    assert.equal((await call(`/principal/results?termId=${termId}`, principal)).data.classes.find((c: { id: number }) => c.id === jss1.id).status, "published");
    assert.equal((await sign("unpublish")).status, 200);
    const returned = await sign("return", { note: "Check Ada's exam score" });
    assert.equal(returned.status, 200);
    const after = (await call(`/principal/results?termId=${termId}`, principal)).data.classes.find((c: { id: number }) => c.id === jss1.id);
    assert.deepEqual([after.status, after.returnNote, after.signedByPrincipal], ["draft", "Check Ada's exam score", false]);
  } finally {
    server.close();
    const exams = classIds.length ? await db.select({ id: portalExams.id }).from(portalExams).where(inArray(portalExams.classId, classIds)) : [];
    if (exams.length) await db.delete(portalAttempts).where(inArray(portalAttempts.examId, exams.map((e) => e.id)));
    if (classIds.length) {
      await db.delete(portalExams).where(inArray(portalExams.classId, classIds));
      await db.delete(portalAttendance).where(inArray(portalAttendance.classId, classIds));
      await db.delete(portalReportWorkflow).where(inArray(portalReportWorkflow.classId, classIds));
      await db.delete(portalReportReleases).where(inArray(portalReportReleases.classId, classIds));
    }
    if (termId) { await db.delete(portalScores).where(eq(portalScores.termId, termId)); await db.delete(portalTerms).where(eq(portalTerms.id, termId)); }
    await db.delete(portalAuditLog).where(like(portalAuditLog.actorLabel, `%${lower}%`));
    await db.delete(portalStudents).where(like(portalStudents.studentId, `${marker}%`));
    if (classIds.length) await db.delete(portalSubjects).where(inArray(portalSubjects.classId, classIds));
    await db.delete(portalTeachers).where(like(portalTeachers.name, `${marker}%`));
    if (classIds.length) await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    // Put back whatever principal signatures the database had before.
    await db.delete(portalPrincipals);
    if (savedPrincipals.length) await db.insert(portalPrincipals).values(savedPrincipals);
    for (const [k, v] of [["SCHOOL_ADMIN_EMAILS", saved.admins], ["SCHOOL_PRINCIPAL_EMAILS", saved.principals], ["SCHOOL_PRIMARY_PRINCIPAL_EMAILS", saved.primary], ["SCHOOL_SUPER_ADMIN_EMAILS", saved.supers]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    await pool.end();
  }
});
