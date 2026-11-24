import { Router } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, portalStudents, portalExams, portalAttempts, portalMaterials, portalNotices, portalClasses } from "@workspace/db";
import { SavePortalAnswersBody } from "@workspace/api-zod";
import { check, portalActor, studentOnly } from "../lib/portal-auth";
import { automaticMarks, attemptView, finalizeExpired, pastGrace, validAnswers } from "../lib/portal-assessment";
import { buildPaper, MAX_FOCUS_LOSSES, paperSize } from "../lib/cbt";
import { lastSittingEnds, sittingWindow, studentMakeups } from "../lib/makeups";

export const portalStudentRouter = Router();
/** Whether a student of the exam's class writes it: everyone, unless it was set for particular students. */
export const forStudent = (exam: { onlyStudentIds: number[] | null }, studentId: number) => !exam.onlyStudentIds?.length || exam.onlyStudentIds.includes(studentId);
portalStudentRouter.get("/student", async (req, res) => {
  const student = studentOnly(await portalActor(req));
  const [schoolClass] = await db.select().from(portalClasses).where(eq(portalClasses.id, student.classId));
  // An exam set for particular students is theirs alone; the rest of the class never sees it.
  const exams = (await db.select().from(portalExams).where(eq(portalExams.classId, student.classId))).filter((e) => forStudent(e, student.id));
  const ownAttempts = await db.select().from(portalAttempts).where(eq(portalAttempts.studentId, student.id));
  // A make-up sitting gives this student their own window; answers wait for every sitting to end.
  const [makeups, closes] = await Promise.all([studentMakeups(student.id, exams.map((e) => e.id)), lastSittingEnds(exams)]);
  const attempts = await Promise.all(ownAttempts.map(async (attempt) => {
    const exam = exams.find((e) => e.id === attempt.examId);
    return exam ? attemptView(await finalizeExpired(attempt), exam, false, closes.get(exam.id)) : null;
  }));
  const materials = await db.select().from(portalMaterials).where(and(eq(portalMaterials.classId, student.classId), eq(portalMaterials.published, true)));
  const notices = await db.select().from(portalNotices).where(and(eq(portalNotices.classId, student.classId), eq(portalNotices.published, true)));
  res.json({
    serverNow: new Date().toISOString(),
    className: schoolClass?.name ?? "", exams: exams.filter((e) => e.published).map((e) => {
      const makeup = makeups.get(e.id);
      const w = sittingWindow(e, makeup);
      return {
        id: e.id, title: e.title, subject: e.subject, durationMinutes: e.durationMinutes, startsAt: w.startsAt.toISOString(),
        endsAt: w.endsAt.toISOString(), mode: e.mode, instructions: e.instructions, ...paperSize(e.questions, e.drawCount), lockdown: e.lockdown,
        ...(makeup ? { makeUp: true } : {}),
      };
    }), attempts: attempts.filter(Boolean), materials, notices,
  });
});
portalStudentRouter.post("/exams/:id/start", async (req, res) => {
  const student = studentOnly(await portalActor(req));
  const id = Number(req.params.id);
  check(Number.isSafeInteger(id) && id > 0, "Invalid exam.");
  const result = await db.transaction(async (tx) => {
    // Lock the exam to serialize starting with content edits and release actions.
    const [exam] = await tx.select().from(portalExams).where(eq(portalExams.id, id)).for("update");
    check(exam && exam.classId === student.classId && forStudent(exam, student.id), "Exam not found.", 404);
    const [existing] = await tx.select().from(portalAttempts).where(and(eq(portalAttempts.examId, exam.id), eq(portalAttempts.studentId, student.id)));
    if (existing) return { exam, attempt: existing };
    const now = new Date();
    // A student with a make-up sitting writes in their own window instead of the class's.
    const w = sittingWindow(exam, (await studentMakeups(student.id, [exam.id])).get(exam.id));
    check(exam.published && now >= w.startsAt && now < w.endsAt, "This exam is not open.", 403);
    check(!exam.resultsReleased, "This assessment is closed.", 403);
    const [attempt] = await tx.insert(portalAttempts).values({
      examId: exam.id, studentId: student.id, questions: buildPaper(exam.questions, exam),
      startedAt: now, deadline: new Date(Math.min(w.endsAt.getTime(), now.getTime() + exam.durationMinutes * 60_000)),
    }).returning();
    return { exam, attempt };
  });
  res.json(attemptView(await finalizeExpired(result.attempt), result.exam, false, (await lastSittingEnds([result.exam])).get(result.exam.id)));
});
portalStudentRouter.get("/attempts/:id", async (req, res) => {
  const student = studentOnly(await portalActor(req));
  const [attempt] = await db.select().from(portalAttempts).where(and(eq(portalAttempts.id, Number(req.params.id) || 0), eq(portalAttempts.studentId, student.id)));
  check(attempt, "Attempt not found.", 404);
  const [exam] = await db.select().from(portalExams).where(eq(portalExams.id, attempt.examId));
  check(exam, "Exam not found.", 404);
  res.json(attemptView(await finalizeExpired(attempt), exam, false, (await lastSittingEnds([exam])).get(exam.id)));
});
async function updateAttempt(req: import("express").Request, submit: boolean) {
  const student = studentOnly(await portalActor(req));
  const body = SavePortalAnswersBody.parse(req.body);
  return db.transaction(async (tx) => {
    const [attempt] = await tx.select().from(portalAttempts).where(and(eq(portalAttempts.id, Number(req.params.id) || 0), eq(portalAttempts.studentId, student.id))).for("update");
    check(attempt, "Attempt not found.", 404);
    const [exam] = await tx.select().from(portalExams).where(eq(portalExams.id, attempt.examId));
    check(exam, "Exam not found.", 404);
    const closesAt = (await lastSittingEnds([exam])).get(exam.id);
    if (attempt.status !== "in_progress") return attemptView(attempt, exam, false, closesAt);
    const now = new Date();
    // Time is up at the deadline, but answers sent within the grace (a lost connection at the end) still count.
    const expired = now.getTime() >= attempt.deadline.getTime();
    const answers = pastGrace(attempt.deadline, now.getTime()) ? attempt.answers : validAnswers(attempt.questions, body.answers);
    const closed = submit || expired;
    const [updated] = await tx.update(portalAttempts).set({
      answers, ...(expired ? {} : { savedAt: now }),
      ...(closed ? { status: attempt.questions.some((q) => q.type === "written") ? "submitted" : "marked", marks: automaticMarks(attempt.questions, answers), submittedAt: now, closedBy: submit && !expired ? "student" : "time" } : {}),
    }).where(eq(portalAttempts.id, attempt.id)).returning();
    return attemptView(updated, exam, false, closesAt);
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
