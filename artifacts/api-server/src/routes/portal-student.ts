import { Router } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, portalStudents, portalExams, portalAttempts, portalMaterials, portalNotices, portalClasses } from "@workspace/db";
import { SavePortalAnswersBody } from "@workspace/api-zod";
import { check, portalActor, studentOnly } from "../lib/portal-auth";
import { automaticMarks, attemptView, finalizeExpired, validAnswers } from "../lib/portal-assessment";
import { buildPaper, MAX_FOCUS_LOSSES, paperSize } from "../lib/cbt";

export const portalStudentRouter = Router();
portalStudentRouter.get("/student", async (req, res) => {
  const student = studentOnly(await portalActor(req));
  const [schoolClass] = await db.select().from(portalClasses).where(eq(portalClasses.id, student.classId));
  const exams = await db.select().from(portalExams).where(eq(portalExams.classId, student.classId));
  const ownAttempts = await db.select().from(portalAttempts).where(eq(portalAttempts.studentId, student.id));
  const attempts = await Promise.all(ownAttempts.map(async (attempt) => {
    const exam = exams.find((e) => e.id === attempt.examId);
    return exam ? attemptView(await finalizeExpired(attempt), exam) : null;
  }));
  const materials = await db.select().from(portalMaterials).where(and(eq(portalMaterials.classId, student.classId), eq(portalMaterials.published, true)));
  const notices = await db.select().from(portalNotices).where(and(eq(portalNotices.classId, student.classId), eq(portalNotices.published, true)));
  res.json({
    className: schoolClass?.name ?? "", exams: exams.filter((e) => e.published).map((e) => ({
      id: e.id, title: e.title, subject: e.subject, durationMinutes: e.durationMinutes, startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(), mode: e.mode, instructions: e.instructions, ...paperSize(e.questions, e.drawCount), lockdown: e.lockdown,
    })), attempts: attempts.filter(Boolean), materials, notices,
  });
});
portalStudentRouter.post("/exams/:id/start", async (req, res) => {
  const student = studentOnly(await portalActor(req));
  const id = Number(req.params.id);
  check(Number.isSafeInteger(id) && id > 0, "Invalid exam.");
  const result = await db.transaction(async (tx) => {
    // Lock the exam to serialize starting with content edits and release actions.
    const [exam] = await tx.select().from(portalExams).where(eq(portalExams.id, id)).for("update");
    check(exam && exam.classId === student.classId, "Exam not found.", 404);
    const [existing] = await tx.select().from(portalAttempts).where(and(eq(portalAttempts.examId, exam.id), eq(portalAttempts.studentId, student.id)));
    if (existing) return { exam, attempt: existing };
    const now = new Date();
    check(exam.published && now >= exam.startsAt && now < exam.endsAt, "This exam is not open.", 403);
    check(!exam.resultsReleased, "This assessment is closed.", 403);
    const [attempt] = await tx.insert(portalAttempts).values({
      examId: exam.id, studentId: student.id, questions: buildPaper(exam.questions, exam),
      startedAt: now, deadline: new Date(Math.min(exam.endsAt.getTime(), now.getTime() + exam.durationMinutes * 60_000)),
    }).returning();
    return { exam, attempt };
  });
  res.json(attemptView(await finalizeExpired(result.attempt), result.exam));
});
portalStudentRouter.get("/attempts/:id", async (req, res) => {
  const student = studentOnly(await portalActor(req));
  const [attempt] = await db.select().from(portalAttempts).where(and(eq(portalAttempts.id, Number(req.params.id) || 0), eq(portalAttempts.studentId, student.id)));
  check(attempt, "Attempt not found.", 404);
  const [exam] = await db.select().from(portalExams).where(eq(portalExams.id, attempt.examId));
  check(exam, "Exam not found.", 404);
  res.json(attemptView(await finalizeExpired(attempt), exam));
});
async function updateAttempt(req: import("express").Request, submit: boolean) {
  const student = studentOnly(await portalActor(req));
  const body = SavePortalAnswersBody.parse(req.body);
  return db.transaction(async (tx) => {
    const [attempt] = await tx.select().from(portalAttempts).where(and(eq(portalAttempts.id, Number(req.params.id) || 0), eq(portalAttempts.studentId, student.id))).for("update");
    check(attempt, "Attempt not found.", 404);
    const [exam] = await tx.select().from(portalExams).where(eq(portalExams.id, attempt.examId));
    check(exam, "Exam not found.", 404);
    if (attempt.status !== "in_progress") return attemptView(attempt, exam);
    const now = new Date();
    const expired = now.getTime() >= attempt.deadline.getTime();
    const answers = expired ? attempt.answers : validAnswers(attempt.questions, body.answers);
    const closed = submit || expired;
    const [updated] = await tx.update(portalAttempts).set({
      answers, ...(expired ? {} : { savedAt: now }),
      ...(closed ? { status: attempt.questions.some((q) => q.type === "written") ? "submitted" : "marked", marks: automaticMarks(attempt.questions, answers) } : {}),
    }).where(eq(portalAttempts.id, attempt.id)).returning();
    return attemptView(updated, exam);
  });
}
// Lockdown exams: the page reports each time the student leaves the exam screen; staff see the count.
portalStudentRouter.post("/attempts/:id/focus-loss", async (req, res) => {
  const student = studentOnly(await portalActor(req));
  const [attempt] = await db.update(portalAttempts).set({ focusLosses: sql`least(${portalAttempts.focusLosses} + 1, ${MAX_FOCUS_LOSSES})` })
    .where(and(eq(portalAttempts.id, Number(req.params.id) || 0), eq(portalAttempts.studentId, student.id), eq(portalAttempts.status, "in_progress")))
    .returning({ focusLosses: portalAttempts.focusLosses });
  check(attempt, "Attempt not found or already submitted.", 404);
  res.json(attempt);
});
portalStudentRouter.put("/attempts/:id", async (req, res) => { res.json(await updateAttempt(req, false)); });
portalStudentRouter.post("/attempts/:id/submit", async (req, res) => { res.json(await updateAttempt(req, true)); });
