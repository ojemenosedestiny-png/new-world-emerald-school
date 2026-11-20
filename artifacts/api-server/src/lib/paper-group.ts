import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db, portalAttempts, portalClasses, portalExams, portalFiles, type PortalExamRecord, type PortalQuestionData } from "@workspace/db";

/**
 * One exam set for several classes at once (JSS 1A, 1B and 1C) is stored as one copy per class, sharing a paper
 * group. Changes saved to one copy go to the others, so a paper is uploaded and corrected once. A copy that students
 * have started keeps its questions (marking stays fair); its times can still move.
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const newPaperGroup = () => randomUUID();

/** The other copies of this paper, locked for update. */
export async function linkedCopies(tx: Tx, exam: Pick<PortalExamRecord, "id" | "paperGroup">) {
  if (!exam.paperGroup) return [];
  return tx.select().from(portalExams).where(and(eq(portalExams.paperGroup, exam.paperGroup), ne(portalExams.id, exam.id))).orderBy(portalExams.id).for("update");
}

/** Each class has its own record of a picture or PDF (same stored file): reuses one the class already has. */
export async function filesForClass(tx: Tx, ids: (string | null | undefined)[], classId: number) {
  const wanted = [...new Set(ids.filter((f): f is string => !!f))];
  const map = new Map<string, string>();
  if (!wanted.length) return map;
  const files = await tx.select().from(portalFiles).where(inArray(portalFiles.id, wanted));
  for (const f of files) {
    if (f.classId === classId) { map.set(f.id, f.id); continue; }
    const [own] = await tx.select({ id: portalFiles.id }).from(portalFiles).where(and(eq(portalFiles.classId, classId), eq(portalFiles.objectName, f.objectName))).limit(1);
    if (own) { map.set(f.id, own.id); continue; }
    const copy = randomUUID();
    await tx.insert(portalFiles).values({ id: copy, classId, objectName: f.objectName, uploadedByTeacherId: f.uploadedByTeacherId });
    map.set(f.id, copy);
  }
  return map;
}

export async function questionsForClass(tx: Tx, questions: PortalQuestionData[], fileId: string | null | undefined, classId: number) {
  const map = await filesForClass(tx, [fileId, ...questions.map((q) => q.diagramFileId)], classId);
  return {
    questions: questions.map((q) => (q.diagramFileId ? { ...q, diagramFileId: map.get(q.diagramFileId) ?? null } : q)),
    fileId: fileId ? map.get(fileId) ?? null : null,
  };
}

export async function hasStarted(tx: Tx, examId: number) {
  const [a] = await tx.select({ id: portalAttempts.id }).from(portalAttempts).where(eq(portalAttempts.examId, examId)).limit(1);
  return !!a;
}

export async function classNames(ids: number[]) {
  const rows = ids.length ? await db.select({ id: portalClasses.id, name: portalClasses.name }).from(portalClasses).where(inArray(portalClasses.id, [...new Set(ids)])) : [];
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** "JSS 1A, JSS 1B and JSS 1C" */
export function listNames(names: string[]) {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
