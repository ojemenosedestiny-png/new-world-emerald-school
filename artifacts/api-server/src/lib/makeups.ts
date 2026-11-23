import { and, eq, inArray, sql } from "drizzle-orm";
import { db, portalExamMakeups, type PortalExamMakeupRecord } from "@workspace/db";

/** This student's make-up sittings, by exam. */
export async function studentMakeups(studentId: number, examIds: number[]) {
  const rows = examIds.length ? await db.select().from(portalExamMakeups).where(and(eq(portalExamMakeups.studentId, studentId), inArray(portalExamMakeups.examId, examIds))) : [];
  return new Map<number, PortalExamMakeupRecord>(rows.map((r) => [r.examId, r]));
}

/** When the last sitting of each exam ends: its own window, or the latest make-up. Answers wait until then. */
export async function lastSittingEnds(exams: { id: number; endsAt: Date }[]) {
  const ids = exams.map((e) => e.id);
  const rows = ids.length ? await db.select({ examId: portalExamMakeups.examId, last: sql<string>`max(${portalExamMakeups.endsAt})` }).from(portalExamMakeups).where(inArray(portalExamMakeups.examId, ids)).groupBy(portalExamMakeups.examId) : [];
  const later = new Map(rows.map((r) => [r.examId, new Date(r.last)]));
  return new Map(exams.map((e) => [e.id, new Date(Math.max(e.endsAt.getTime(), later.get(e.id)?.getTime() ?? 0))]));
}

/** The window a student writes in: their make-up if they have one, otherwise the class's. */
export const sittingWindow = (exam: { startsAt: Date; endsAt: Date }, makeup?: { startsAt: Date; endsAt: Date } | null) => makeup ?? exam;
