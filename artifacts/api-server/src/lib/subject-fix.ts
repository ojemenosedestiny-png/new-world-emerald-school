import { and, eq, inArray, sql } from "drizzle-orm";
import { db, portalClasses, portalExams, portalScores, portalSubjects } from "@workspace/db";

export type SubjectFixResult = { renamed: string[]; merged: string[]; removed: string[]; skipped: { className: string; reason: string }[] };
const same = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

/** A subject name as typed, tidied; null when it is not a sensible name. */
export function cleanSubjectName(name: string | null | undefined) {
  const n = (name ?? "").trim().replace(/\s+/g, " ");
  return n && n.length <= 80 && /^[\p{L}\p{N}][\p{L}\p{N} &()'.,/+-]*$/u.test(n) ? n : null;
}

/**
 * Corrects or removes a subject in several classes at once (for example a misspelling made in every arm of a year).
 * - Rename: where a class already has the correct subject, the two are merged: marks move across, the subject
 *   teacher is kept, and the misspelled one is removed. A class is skipped if the same student has marks under both.
 * - Remove: only where no marks have been entered; otherwise the class is skipped.
 * CBT exams set under the old name are relabelled too, so students see the corrected name everywhere.
 */
export async function fixSubject(classIds: number[], oldName: string, newName: string | null): Promise<SubjectFixResult> {
  const out: SubjectFixResult = { renamed: [], merged: [], removed: [], skipped: [] };
  if (!classIds.length) return out;
  const classes = await db.select({ id: portalClasses.id, name: portalClasses.name }).from(portalClasses).where(inArray(portalClasses.id, classIds));
  for (const cls of classes) {
    await db.transaction(async (tx) => {
      const subjects = await tx.select().from(portalSubjects).where(eq(portalSubjects.classId, cls.id)).for("update");
      const wrong = subjects.find((s) => same(s.name, oldName));
      if (!wrong) return;
      const scores = await tx.select({ id: portalScores.id, termId: portalScores.termId, studentId: portalScores.studentId }).from(portalScores).where(eq(portalScores.subjectId, wrong.id));
      if (newName === null) {
        if (scores.length) { out.skipped.push({ className: cls.name, reason: "marks have been entered for it" }); return; }
        await tx.delete(portalSubjects).where(eq(portalSubjects.id, wrong.id));
        out.removed.push(cls.name);
        return;
      }
      const right = subjects.find((s) => s.id !== wrong.id && same(s.name, newName));
      if (right) {
        if (scores.length) {
          const theirs = await tx.select({ termId: portalScores.termId, studentId: portalScores.studentId }).from(portalScores).where(eq(portalScores.subjectId, right.id));
          const clash = scores.some((a) => theirs.some((b) => b.termId === a.termId && b.studentId === a.studentId));
          if (clash) { out.skipped.push({ className: cls.name, reason: "the same students have marks under both spellings" }); return; }
          await tx.update(portalScores).set({ subjectId: right.id }).where(eq(portalScores.subjectId, wrong.id));
        }
        if (right.teacherId === null && wrong.teacherId !== null) await tx.update(portalSubjects).set({ teacherId: wrong.teacherId }).where(eq(portalSubjects.id, right.id));
        await tx.delete(portalSubjects).where(eq(portalSubjects.id, wrong.id));
        out.merged.push(cls.name);
      } else {
        await tx.update(portalSubjects).set({ name: newName }).where(eq(portalSubjects.id, wrong.id));
        out.renamed.push(cls.name);
      }
      await tx.update(portalExams).set({ subject: newName })
        .where(and(eq(portalExams.classId, cls.id), sql`lower(regexp_replace(trim(${portalExams.subject}), '\\s+', ' ', 'g')) = ${oldName.trim().replace(/\s+/g, " ").toLowerCase()}`));
    });
  }
  return out;
}

/** One sentence for the person who made the change. */
export function fixMessage(r: SubjectFixResult, oldName: string, newName: string | null) {
  const n = (list: string[]) => `${list.length} ${list.length === 1 ? "class" : "classes"}`;
  const parts: string[] = [];
  if (r.renamed.length) parts.push(`renamed to ${newName} in ${n(r.renamed)}`);
  if (r.merged.length) parts.push(`merged into ${newName} in ${n(r.merged)} (marks and teacher kept)`);
  if (r.removed.length) parts.push(`removed from ${n(r.removed)}`);
  const head = parts.length ? `${oldName}: ${parts.join("; ")}.` : `No class has a subject called ${oldName}.`;
  const skipped = r.skipped.length ? ` Not changed in ${r.skipped.map((s) => `${s.className} (${s.reason})`).join(", ")}.` : "";
  return head + skipped;
}
