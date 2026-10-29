import { and, eq, lte } from "drizzle-orm";
import { db, portalAttempts, type PortalAttemptRecord, type PortalExamRecord, type PortalQuestionData, type PortalMarkData } from "@workspace/db";
import { check } from "./portal-auth";

export function automaticMarks(questions: PortalQuestionData[], answers: Record<string, string>): PortalMarkData[] {
  return questions.filter((q) => q.type === "mcq").map((q) => ({
    questionId: q.id, score: answers[q.id] !== undefined && answers[q.id] === String(q.correctAnswer) ? q.marks : 0, feedback: "",
  }));
}
export function validateQuestions(questions: PortalQuestionData[], published: boolean) {
  check(questions.length > 0 && questions.length <= 200, "Add between 1 and 200 questions.");
  check(new Set(questions.map((q) => q.id)).size === questions.length, "Question IDs must be unique.");
  for (const q of questions) {
    check(q.text.trim().length > 0, "Every question needs text.");
    if (q.type === "mcq") {
      check(q.options.length >= 2 && q.options.length <= 8 && q.options.every((o) => o.trim()), "Multiple-choice questions need 2–8 nonempty choices.");
      check(new Set(q.options.map((o) => o.trim())).size === q.options.length, "Answer choices must be distinct.");
      check(q.correctAnswer == null || (Number.isInteger(q.correctAnswer) && q.correctAnswer >= 0 && q.correctAnswer < q.options.length), "Invalid answer key.");
      if (published) check(q.correctAnswer != null, "Confirm every multiple-choice answer key before publishing.");
    }
  }
}
export function validAnswers(questions: PortalQuestionData[], answers: Record<string, string>) {
  check(Object.keys(answers).length <= questions.length, "Invalid answer count.");
  const clean: Record<string, string> = {};
  for (const [id, value] of Object.entries(answers)) {
    const q = questions.find((q) => q.id === id);
    check(q, "Unknown question.");
    check(q.type !== "mcq" || value === "" || (/^\d$/.test(value) && Number(value) < q.options.length), "Invalid answer choice.");
    clean[id] = value;
  }
  return clean;
}
export async function finalizeExpired(attempt: PortalAttemptRecord) {
  if (attempt.status !== "in_progress" || attempt.deadline.getTime() > Date.now()) return attempt;
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(portalAttempts).where(eq(portalAttempts.id, attempt.id)).for("update");
    if (!current || current.status !== "in_progress" || current.deadline.getTime() > Date.now()) return current ?? attempt;
    const [saved] = await tx.update(portalAttempts).set({
      status: current.questions.some((q) => q.type === "written") ? "submitted" : "marked",
      marks: automaticMarks(current.questions, current.answers),
    }).where(eq(portalAttempts.id, current.id)).returning();
    return saved;
  });
}
export function attemptView(attempt: PortalAttemptRecord, exam: PortalExamRecord, staff = false) {
  const released = exam.resultsReleased && attempt.status === "marked";
  // After submitting, students see which multiple-choice answers were right and the right answer for
  // each (in their own option order); their score stays hidden until the school releases results.
  const showAnswers = exam.instantResults && attempt.status !== "in_progress";
  return {
    id: attempt.id, examId: exam.id, title: exam.title, subject: exam.subject, mode: exam.mode,
    instructions: exam.instructions, fileId: exam.mode === "pdf" ? exam.fileId : null,
    questions: attempt.questions.map(({ correctAnswer: _key, rubric: _rubric, ...q }) => q),
    answers: attempt.answers, startedAt: attempt.startedAt.toISOString(), deadline: attempt.deadline.toISOString(),
    serverNow: new Date().toISOString(), savedAt: attempt.savedAt.toISOString(), status: attempt.status,
    totalMarks: attempt.questions.reduce((sum, q) => sum + q.marks, 0), resultsReleased: released, lockdown: exam.lockdown,
    ...(showAnswers ? { review: attempt.questions.filter((q) => q.type === "mcq" && q.correctAnswer != null).map((q) => ({ questionId: q.id, correctAnswer: q.correctAnswer!, correct: attempt.answers[q.id] === String(q.correctAnswer) })) } : {}),
    ...((staff || released) ? { score: attempt.marks.reduce((s, m) => s + m.score, 0), marks: attempt.marks } : {}),
  };
}
