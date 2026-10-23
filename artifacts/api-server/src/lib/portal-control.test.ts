import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool, portalClasses, portalStudents, portalExams, portalAttempts,
  portalSessions, portalMaterials, portalNotices,
  type PortalQuestionData,
} from "@workspace/db";
import portalRouter from "../routes/portal";

// Database-only checks for staff exam controls. Unlike portal.test.ts this needs
// no object storage, so it runs anywhere DATABASE_URL points at a disposable database.
test("staff can extend, reset and delete while students keep a safe exam flow", async () => {
  const previous = process.env.SCHOOL_ADMIN_EMAILS;
  process.env.SCHOOL_ADMIN_EMAILS = "portal-control-admin@example.test";
  const marker = `QA-CONTROL-${randomUUID().slice(0, 8)}`.toUpperCase();
  const classIds: number[] = [];
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use((req, _res, next) => {
    req.log = { error() {}, warn() {}, info() {} } as unknown as typeof req.log;
    if (req.headers["x-test-admin"] === marker) {
      req.dbUser = { id: "synthetic-control-test" } as NonNullable<typeof req.dbUser>;
      req.identity = { email: "portal-control-admin@example.test", emailVerified: true };
    }
    next();
  });
  app.use("/api/portal", portalRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/portal`;
  async function call(path: string, method = "GET", body?: unknown, cookie = "", admin = false) {
    const response = await fetch(root + path, {
      method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(admin ? { "X-Test-Admin": marker } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = (response.status === 204 ? {} : await response.json()) as {
      id: number; status: string; deadline: string; score?: number; error?: string;
      attempts: { id: number; status: string; deadline: string }[];
    };
    return { status: response.status, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "", data };
  }
  const command = (body: unknown) => call("/manage", "POST", body, "", true);
  try {
    // Existing flow: enrol, sign in, change the temporary password.
    assert.equal((await command({ action: "saveClass", schoolClass: { name: marker } })).status, 200);
    const [c] = await db.select().from(portalClasses).where(eq(portalClasses.name, marker)); classIds.push(c.id);
    assert.equal((await command({ action: "saveStudent", student: { studentId: marker, name: "Control QA student", classId: c.id, active: true, password: "Individual-Temp-5271!" } })).status, 200);
    const login = await call("/session", "POST", { studentId: marker, password: "Individual-Temp-5271!" });
    assert.equal(login.status, 200);
    const changed = await call("/password", "PUT", { currentPassword: "Individual-Temp-5271!", newPassword: "Individual-New-6842!" }, login.cookie);
    assert.equal(changed.status, 204);
    const cookie = changed.cookie;

    const questions: PortalQuestionData[] = [
      { id: "mcq-1", type: "mcq", text: "What is 2 + 2?", options: ["3", "4"], correctAnswer: 1, marks: 2 },
      { id: "written-1", type: "written", text: "Explain how you added.", options: [], correctAnswer: null, marks: 3, rubric: "Explain addition." },
    ];
    const examData = {
      title: marker, subject: "Mathematics", classId: c.id, durationMinutes: 20,
      startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 20 * 60_000).toISOString(),
      mode: "interactive", fileId: null, instructions: "Answer both questions", questions, published: true, resultsReleased: false,
    };
    assert.equal((await command({ action: "saveExam", exam: examData })).status, 200);
    const [exam] = await db.select().from(portalExams).where(eq(portalExams.title, marker));

    // Students and guests cannot use staff controls.
    assert.equal((await call("/manage", "POST", { action: "deleteExam", target: { id: exam.id } }, cookie)).status, 403);
    assert.equal((await call("/manage", "POST", { action: "deleteExam", target: { id: exam.id } })).status, 401);

    const start = await call(`/exams/${exam.id}/start`, "POST", undefined, cookie);
    assert.equal(start.status, 200);
    const attemptId = start.data.id;
    const originalDeadline = new Date(start.data.deadline).getTime();

    // Extra time: validated, applied to this student only, visible to the student.
    assert.equal((await command({ action: "extendAttempt", attemptControl: { attemptId, minutes: 0 } })).status, 400);
    assert.equal((await command({ action: "extendAttempt", attemptControl: { attemptId, minutes: 241 } })).status, 400);
    assert.equal((await command({ action: "extendAttempt", attemptControl: { attemptId: 999999999, minutes: 5 } })).status, 404);
    assert.equal((await command({ action: "extendAttempt", attemptControl: { attemptId, minutes: 30 } })).status, 200);
    const extended = await call(`/attempts/${attemptId}`, "GET", undefined, cookie);
    assert.equal(new Date(extended.data.deadline).getTime(), originalDeadline + 30 * 60_000);
    // The extension may run past the exam window and the student can still save.
    assert.ok(new Date(extended.data.deadline).getTime() > new Date(examData.endsAt).getTime());
    assert.equal((await call(`/attempts/${attemptId}`, "PUT", { answers: { "mcq-1": "1" } }, cookie)).status, 200);

    // A started exam cannot be deleted; content stays locked as before.
    assert.equal((await command({ action: "deleteExam", target: { id: exam.id } })).status, 409);
    assert.equal((await command({ action: "saveExam", exam: { ...examData, id: exam.id } })).status, 409);

    // Reset lets the student start again with a fresh attempt.
    assert.equal((await command({ action: "resetAttempt", attemptControl: { attemptId } })).status, 200);
    assert.equal((await call(`/attempts/${attemptId}`, "GET", undefined, cookie)).status, 404);
    const restart = await call(`/exams/${exam.id}/start`, "POST", undefined, cookie);
    assert.equal(restart.status, 200);
    assert.notEqual(restart.data.id, attemptId);
    const secondId = restart.data.id;

    // Submitted work cannot be given extra time; existing marking and release still work.
    const answers = { "mcq-1": "1", "written-1": "Two and two more." };
    assert.equal((await call(`/attempts/${secondId}/submit`, "POST", { answers }, cookie)).data.status, "submitted");
    assert.equal((await command({ action: "extendAttempt", attemptControl: { attemptId: secondId, minutes: 5 } })).status, 409);
    assert.equal((await command({ action: "grade", grade: { attemptId: secondId, marks: [{ questionId: "written-1", score: 2, feedback: "Good." }] } })).status, 200);
    await db.update(portalExams).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(portalExams.id, exam.id));
    assert.equal((await command({ action: "examStatus", examStatus: { id: exam.id, published: true, resultsReleased: true } })).status, 200);
    assert.equal((await call(`/attempts/${secondId}`, "GET", undefined, cookie)).data.score, 4);
    // Released results are protected from resets until withheld.
    assert.equal((await command({ action: "resetAttempt", attemptControl: { attemptId: secondId } })).status, 409);

    // The management view still lists the attempt for staff.
    const manage = await call("/manage", "GET", undefined, "", true);
    assert.equal(manage.status, 200);
    assert.ok(manage.data.attempts.some((a) => a.id === secondId && a.status === "marked"));

    // Draft exams, revision notes and announcements can be deleted.
    assert.equal((await command({ action: "saveExam", exam: { ...examData, title: `${marker}-DRAFT`, published: false, startsAt: new Date(Date.now() + 60 * 60_000).toISOString(), endsAt: new Date(Date.now() + 120 * 60_000).toISOString() } })).status, 200);
    const [draft] = await db.select().from(portalExams).where(eq(portalExams.title, `${marker}-DRAFT`));
    assert.equal((await command({ action: "deleteExam", target: { id: draft.id } })).status, 200);
    assert.equal((await db.select().from(portalExams).where(eq(portalExams.id, draft.id))).length, 0);
    assert.equal((await command({ action: "deleteExam", target: { id: draft.id } })).status, 404);
    assert.equal((await command({ action: "saveMaterial", material: { title: marker, subject: "Maths", classId: c.id, body: "Notes", fileId: null, published: true } })).status, 200);
    const [material] = await db.select().from(portalMaterials).where(eq(portalMaterials.title, marker));
    assert.equal((await command({ action: "deleteMaterial", target: { id: material.id } })).status, 200);
    assert.equal((await db.select().from(portalMaterials).where(eq(portalMaterials.id, material.id))).length, 0);
    assert.equal((await command({ action: "saveNotice", notice: { title: marker, body: "Hello", classId: c.id, published: true } })).status, 200);
    const [notice] = await db.select().from(portalNotices).where(eq(portalNotices.title, marker));
    assert.equal((await command({ action: "deleteNotice", target: { id: notice.id } })).status, 200);
    assert.equal((await db.select().from(portalNotices).where(eq(portalNotices.id, notice.id))).length, 0);
    assert.equal((await command({ action: "deleteNotice" })).status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (classIds.length) {
      const students = await db.select({ id: portalStudents.id }).from(portalStudents).where(inArray(portalStudents.classId, classIds));
      if (students.length) {
        await db.delete(portalSessions).where(inArray(portalSessions.studentId, students.map((s) => s.id)));
        await db.delete(portalAttempts).where(inArray(portalAttempts.studentId, students.map((s) => s.id)));
      }
      await db.delete(portalExams).where(inArray(portalExams.classId, classIds));
      await db.delete(portalMaterials).where(inArray(portalMaterials.classId, classIds));
      await db.delete(portalNotices).where(inArray(portalNotices.classId, classIds));
      await db.delete(portalStudents).where(inArray(portalStudents.classId, classIds));
      await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    }
    if (previous === undefined) delete process.env.SCHOOL_ADMIN_EMAILS;
    else process.env.SCHOOL_ADMIN_EMAILS = previous;
    await pool.end();
  }
});
