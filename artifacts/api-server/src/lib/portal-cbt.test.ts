import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool, portalAttempts, portalClasses, portalExams, portalFiles, portalSessions, portalStudents, type PortalQuestionData } from "@workspace/db";
import portalRouter from "../routes/portal";
import { hashPassword } from "./portal-auth";
import { PRACTICE_TITLE } from "./practice-exam";

// Database checks for computer-based test options: question banks, shuffling and lockdown exits.
test("cbt: each student gets their own drawn, shuffled paper that marks correctly; lockdown exits are counted", async () => {
  const saved = process.env.SCHOOL_ADMIN_EMAILS;
  const marker = `QA-CBT-${randomUUID().slice(0, 8)}`.toUpperCase();
  process.env.SCHOOL_ADMIN_EMAILS = `admin-${marker}@example.test`.toLowerCase();
  const classIds: number[] = [];
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use((req, _res, next) => {
    req.log = { error() {}, warn() {}, info() {} } as unknown as typeof req.log;
    if (req.headers["x-test-admin"] === marker) {
      req.dbUser = { id: `synthetic-${marker}` } as NonNullable<typeof req.dbUser>;
      req.identity = { email: `admin-${marker}@example.test`.toLowerCase(), emailVerified: true, mfa: true };
    }
    next();
  });
  app.use("/api/portal", portalRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/portal`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function call(path: string, method = "GET", body?: unknown, opts: { cookie?: string; admin?: boolean } = {}): Promise<{ status: number; data: any }> {
    const r = await fetch(root + path, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(opts.cookie ? { Cookie: opts.cookie } : {}), ...(opts.admin ? { "X-Test-Admin": marker } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: r.status === 204 ? null : await r.json() };
  }
  const command = (body: unknown) => call("/manage", "POST", body, { admin: true });
  try {
    const [cls] = await db.insert(portalClasses).values({ name: marker }).returning();
    classIds.push(cls.id);
    const pw = await hashPassword("Cbt-Pass-12345");
    const [ada, bayo] = await db.insert(portalStudents).values([
      { studentId: marker + "-1", name: "Ada Obi", classId: cls.id, passwordHash: pw, mustChangePassword: false },
      { studentId: marker + "-2", name: "Bayo Ade", classId: cls.id, passwordHash: pw, mustChangePassword: false },
    ]).returning();
    const login = async (id: string) => ({ cookie: (await fetch(root + "/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: id, password: "Cbt-Pass-12345" }) })).headers.get("set-cookie")!.split(";")[0] });
    const adaS = await login(ada.studentId), bayoS = await login(bayo.studentId);

    const bank: PortalQuestionData[] = Array.from({ length: 12 }, (_, i) => ({ id: `q${i + 1}`, type: "mcq", text: `Question ${i + 1}`, options: ["A", "B", "C", "D"].map((o) => `${o}-${i + 1}`), correctAnswer: i % 4, marks: 2 }));
    const exam = {
      title: marker, subject: "Mathematics", classId: cls.id, durationMinutes: 20,
      startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 20 * 60_000).toISOString(),
      mode: "interactive", fileId: null, instructions: "", questions: bank, published: true, resultsReleased: false,
      shuffleQuestions: true, shuffleOptions: true, drawCount: 5, lockdown: true,
    };
    // Settings that cannot work are refused.
    assert.equal((await command({ action: "saveExam", exam: { ...exam, drawCount: 13 } })).status, 400);
    assert.equal((await command({ action: "saveExam", exam: { ...exam, questions: [...bank.slice(1), { ...bank[0], marks: 3 }] } })).status, 400, "draws need equal marks");
    const saved1 = await command({ action: "saveExam", exam });
    assert.equal(saved1.status, 200, JSON.stringify(saved1.data));
    const [row] = await db.select().from(portalExams).where(eq(portalExams.title, marker));
    assert.deepEqual([row.shuffleQuestions, row.shuffleOptions, row.drawCount, row.lockdown], [true, true, 5, true]);

    // The dashboard shows each student's paper size, not the whole bank.
    const dash = (await call("/student", "GET", undefined, adaS)).data.exams.find((e: { id: number }) => e.id === row.id);
    assert.deepEqual([dash.questionCount, dash.totalMarks, dash.lockdown], [5, 10, true]);

    // Each student gets five distinct questions from the bank; the answer key follows the shuffled options.
    const a = await call(`/exams/${row.id}/start`, "POST", undefined, adaS);
    assert.equal(a.status, 200);
    assert.equal(a.data.questions.length, 5);
    assert.equal(a.data.lockdown, true);
    assert.equal(a.data.questions.some((q: { correctAnswer?: unknown }) => "correctAnswer" in q), false, "students never see the key");
    const [stored] = await db.select().from(portalAttempts).where(eq(portalAttempts.id, a.data.id));
    for (const q of stored.questions) {
      const original = bank.find((b) => b.id === q.id)!;
      assert.equal(q.options[q.correctAnswer!], original.options[original.correctAnswer!]);
    }
    // Ada answers by option text, the way a student reads the screen.
    const answers = Object.fromEntries(a.data.questions.map((q: { id: string; options: string[] }) => {
      const original = bank.find((b) => b.id === q.id)!;
      return [q.id, String(q.options.indexOf(original.options[original.correctAnswer!]))];
    }));

    // Leaving the exam screen is counted, only on your own attempt, and only while it is in progress.
    assert.equal((await call(`/attempts/${a.data.id}/focus-loss`, "POST", undefined, bayoS)).status, 404);
    assert.equal((await call(`/attempts/${a.data.id}/focus-loss`, "POST", undefined, adaS)).data.focusLosses, 1);
    assert.equal((await call(`/attempts/${a.data.id}/focus-loss`, "POST", undefined, adaS)).data.focusLosses, 2);
    const submitted = await call(`/attempts/${a.data.id}/submit`, "POST", { answers }, { cookie: adaS.cookie });
    assert.equal(submitted.data.status, "marked");
    // After submitting, the right answers show at once; the score waits for the teacher to release it.
    assert.deepEqual([submitted.data.resultsReleased, "score" in submitted.data], [false, false]);
    assert.equal(submitted.data.review.length, 5);
    for (const r of submitted.data.review as { questionId: string; correctAnswer: number; correct: boolean }[]) {
      const q = submitted.data.questions.find((x: { id: string }) => x.id === r.questionId);
      const original = bank.find((b) => b.id === r.questionId)!;
      assert.equal(q.options[r.correctAnswer], original.options[original.correctAnswer!], "the right answer is in the student's own option order");
      assert.equal(r.correct, true);
    }
    assert.equal((await call(`/attempts/${a.data.id}`, "GET", undefined, bayoS)).status, 404, "no one else sees Ada's answers");
    assert.equal((await call(`/attempts/${a.data.id}/focus-loss`, "POST", undefined, adaS)).status, 404);
    const staff = (await call("/manage", "GET", undefined, { admin: true })).data.attempts.find((x: { id: number }) => x.id === a.data.id);
    assert.deepEqual([staff.score, staff.focusLosses], [10, 2]);

    // A second student almost always gets a different paper (12 choose 5 with shuffling).
    const b = await call(`/exams/${row.id}/start`, "POST", undefined, bayoS);
    assert.equal(b.data.questions.length, 5);
    assert.notDeepEqual(b.data.questions.map((q: { id: string; options: string[] }) => [q.id, q.options]), a.data.questions.map((q: { id: string; options: string[] }) => [q.id, q.options]));

    // The office can add a practice CBT to every class in one go; repeating it adds nothing; students cannot.
    assert.equal((await call("/manage", "POST", { action: "addPracticeExams" }, adaS)).status, 403);
    const added = await command({ action: "addPracticeExams" });
    assert.equal(added.status, 200, JSON.stringify(added.data));
    assert.match(added.data.message, /Practice CBT added/);
    assert.match((await command({ action: "addPracticeExams" })).data.message, /already/);
    const [practice] = await db.select().from(portalExams).where(and(eq(portalExams.classId, cls.id), eq(portalExams.title, PRACTICE_TITLE)));
    assert.deepEqual([practice.published, practice.drawCount, practice.lockdown, practice.questions.length], [true, 10, true, 12]);
    const practiceDash = (await call("/student", "GET", undefined, bayoS)).data.exams.find((e: { id: number }) => e.id === practice.id);
    assert.deepEqual([practiceDash.questionCount, practiceDash.totalMarks], [10, 10]);

    // Shuffling is refused for a PDF paper.
    assert.equal((await command({ action: "saveExam", exam: { ...exam, title: marker + "-PDF", mode: "pdf", drawCount: 0 } })).status, 400);

    // Imported passages and diagrams travel with each question; a diagram must be a picture of this class.
    const [other] = await db.insert(portalClasses).values({ name: marker + "-OTHER" }).returning();
    classIds.push(other.id);
    const paperId = randomUUID(), diagramId = randomUUID(), foreignId = randomUUID();
    await db.insert(portalFiles).values([
      { id: paperId, classId: cls.id, objectName: paperId },
      { id: diagramId, classId: cls.id, objectName: `diagram-${diagramId}.png` },
      { id: foreignId, classId: other.id, objectName: `diagram-${foreignId}.png` },
    ]);
    const passage = "Read the passage and answer Questions 1 to 2.\n\nAda read every morning.";
    const withExtras = (diagramFileId: string) => ({
      ...exam, title: marker + "-READING", shuffleQuestions: false, shuffleOptions: false, drawCount: 0, lockdown: false, instantResults: false,
      questions: bank.slice(0, 2).map((q, i) => ({ ...q, passage, diagramFileId: i === 1 ? diagramFileId : null })),
    });
    assert.equal((await command({ action: "saveExam", exam: withExtras(foreignId) })).status, 400, "another class's picture");
    assert.equal((await command({ action: "saveExam", exam: withExtras(paperId) })).status, 400, "a PDF is not a diagram");
    assert.equal((await command({ action: "saveExam", exam: { ...withExtras(diagramId), fileId: diagramId } })).status, 400, "a diagram is not a paper");
    assert.equal((await command({ action: "saveExam", exam: withExtras(diagramId) })).status, 200);
    const [reading] = await db.select().from(portalExams).where(eq(portalExams.title, marker + "-READING"));
    // Before Bayo starts the paper its diagram is hidden from him, and a diagram is never served as a paper.
    assert.equal((await call(`/diagrams/${diagramId}`, "GET", undefined, bayoS)).status, 404);
    assert.equal((await call(`/files/${diagramId}`, "GET", undefined, { admin: true })).status, 404);
    const started = await call(`/exams/${reading.id}/start`, "POST", undefined, bayoS);
    assert.equal(started.status, 200);
    assert.deepEqual(started.data.questions.map((q: { passage?: string; diagramFileId?: string | null }) => [q.passage, q.diagramFileId]), [[passage, null], [passage, diagramId]]);
    assert.equal((await call(`/diagrams/${foreignId}`, "GET", undefined, bayoS)).status, 404, "another class's diagram");
    // With answer review off, nothing about the answers is shown after submitting.
    const held = await call(`/attempts/${started.data.id}/submit`, "POST", { answers: {} }, bayoS);
    assert.deepEqual([held.data.status, held.data.resultsReleased, "score" in held.data, "review" in held.data], ["marked", false, false, false]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    // Practice tests went to every class in this disposable database; remove the ones nobody sat.
    const sat = new Set((await db.select({ examId: portalAttempts.examId }).from(portalAttempts)).map((a) => a.examId));
    const practice = (await db.select({ id: portalExams.id }).from(portalExams).where(eq(portalExams.title, PRACTICE_TITLE))).filter((e) => !sat.has(e.id));
    if (practice.length) await db.delete(portalExams).where(inArray(portalExams.id, practice.map((e) => e.id)));
    if (classIds.length) {
      const ids = (await db.select({ id: portalStudents.id }).from(portalStudents).where(inArray(portalStudents.classId, classIds))).map((s) => s.id);
      if (ids.length) {
        await db.delete(portalSessions).where(inArray(portalSessions.studentId, ids));
        await db.delete(portalAttempts).where(inArray(portalAttempts.studentId, ids));
      }
      await db.delete(portalExams).where(inArray(portalExams.classId, classIds));
      await db.delete(portalFiles).where(inArray(portalFiles.classId, classIds));
      await db.delete(portalStudents).where(inArray(portalStudents.classId, classIds));
      await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    }
    if (saved === undefined) delete process.env.SCHOOL_ADMIN_EMAILS; else process.env.SCHOOL_ADMIN_EMAILS = saved;
    await pool.end();
  }
});
