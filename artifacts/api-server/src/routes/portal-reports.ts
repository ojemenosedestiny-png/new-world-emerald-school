import { Router } from "express";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import {
  db, portalClasses, portalStudents, portalTerms, portalSubjects, portalScores, portalReportCards, portalReportReleases,
  portalPrincipals, portalReportSettings, portalReportWorkflow, portalTeachers, type PortalTermRecord, type PortalReportWorkflowRecord,
} from "@workspace/db";
import { GetReportWorkspaceQueryParams, ManageReportsBody } from "@workspace/api-zod";
import { check, classAllowed, portalActor, staffOnly, studentOnly, type PortalActor } from "../lib/portal-auth";
import { classSection } from "../lib/principal";
import { isHeadOfSchool, isSuperAdmin } from "../lib/website-admin";
import { GRADE_SCALE, traitsProblem, buildClassReport, nextStatus, scaleProblem, schemeFor, schemeMaxima, schemePossible, signatureProblem, validScorePart, type GradeBand, type ResultScheme, type ResultStatus } from "../lib/report-cards";

export const portalReportsRouter = Router();

const approver = (req: { identity?: { email?: string | null } }, actor: PortalActor) => actor.name || req.identity?.email || "School office";

const termView = (t: PortalTermRecord) => ({ id: t.id, session: t.session, term: t.term, caMax: t.caMax, ca2Max: t.ca2Max, examMax: t.examMax, nextTermBegins: t.nextTermBegins });

async function reportSettings() {
  const [row] = await db.select().from(portalReportSettings).where(eq(portalReportSettings.id, 1));
  return { gradingScale: (row?.gradingScale ?? GRADE_SCALE.map((b) => ({ ...b }))) as GradeBand[], principalName: row?.principalName ?? "", principalSignature: row?.principalSignature ?? null };
}
/** The Director, printed on every report card beside the Head Teacher (primary) or the principal (secondary). */
async function cardDirector() {
  const [row] = await db.select().from(portalPrincipals).where(eq(portalPrincipals.section, "director"));
  return { name: row?.name ?? "", signature: row?.signature ?? null };
}
/**
 * Only the Head Teacher (the Head of School) or the school owner approves primary results; the Head Teacher's
 * saved signature goes on them. Secondary results keep the office approval (the principal signs in their portal).
 */
async function approvalSignature(req: Parameters<typeof isHeadOfSchool>[0], classId: number): Promise<{ principalName: string; principalSignature: string | null }> {
  const [cls] = await db.select({ name: portalClasses.name }).from(portalClasses).where(eq(portalClasses.id, classId));
  if (!cls || classSection(cls.name) !== "primary") return { principalName: "", principalSignature: null };
  check(isHeadOfSchool(req) || isSuperAdmin(req), "Only the Head Teacher approves and signs primary results.", 403);
  if (!isHeadOfSchool(req)) return { principalName: "", principalSignature: null };
  const [head] = await db.select().from(portalPrincipals).where(eq(portalPrincipals.section, "head"));
  check(head?.name && head.signature, "Add your name and signature first (Head of School page, My signature), then approve.", 409);
  return { principalName: head.name, principalSignature: head.signature };
}
/**
 * The principal printed on a class's report cards: whoever signed them in the principal's portal, else that
 * school's principal (primary or secondary), else the school-wide principal in Result settings.
 */
async function cardPrincipal(classId: number, workflow: PortalReportWorkflowRecord | undefined, settings: { principalName: string; principalSignature: string | null }) {
  if (workflow?.principalSignature) return { name: workflow.principalName, signature: workflow.principalSignature };
  const [cls] = await db.select({ name: portalClasses.name }).from(portalClasses).where(eq(portalClasses.id, classId));
  const section = cls ? classSection(cls.name) : null;
  // Primary results are signed by the Head Teacher (the Head of School), never the primary principal.
  if (section === "primary") {
    const [head] = await db.select().from(portalPrincipals).where(eq(portalPrincipals.section, "head"));
    return { name: head?.name ?? "", signature: head?.signature ?? null };
  }
  const [own] = section ? await db.select().from(portalPrincipals).where(eq(portalPrincipals.section, section)) : [];
  if (own?.signature) return { name: own.name, signature: own.signature };
  return { name: settings.principalName, signature: settings.principalSignature };
}
export async function workflowRow(termId: number, classId: number) {
  const [row] = await db.select().from(portalReportWorkflow).where(and(eq(portalReportWorkflow.termId, termId), eq(portalReportWorkflow.classId, classId)));
  return row;
}
/** Published is a release row; otherwise the workflow row's status (draft when there is none). */
export const statusOf = (row: PortalReportWorkflowRecord | undefined, released: boolean): ResultStatus => (released ? "published" : (row?.status as ResultStatus) ?? "draft");
const workflowView = (row: PortalReportWorkflowRecord | undefined, released: boolean) => ({
  status: statusOf(row, released), mode: (row?.mode ?? "automatic") as "automatic" | "manual",
  teacherName: row?.teacherName ?? "", teacherSignature: row?.teacherSignature ?? null, submittedAt: row?.submittedAt?.toISOString() ?? null,
  approvedBy: row?.approvedBy ?? "", approvedAt: row?.approvedAt?.toISOString() ?? null, returnNote: row?.returnNote ?? "",
});
export async function upsertWorkflow(termId: number, classId: number, values: Partial<typeof portalReportWorkflow.$inferInsert>) {
  await db.insert(portalReportWorkflow).values({ termId, classId, ...values, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [portalReportWorkflow.termId, portalReportWorkflow.classId], set: { ...values, updatedAt: new Date() } });
}

/** Primary (Year 1 to 6) or secondary, from the class's name. */
async function classScheme(classId: number): Promise<ResultScheme> {
  const [cls] = await db.select({ name: portalClasses.name }).from(portalClasses).where(eq(portalClasses.id, classId));
  return schemeFor(cls?.name ?? "");
}

async function classData(termId: number, classId: number) {
  const [termRow] = await db.select().from(portalTerms).where(eq(portalTerms.id, termId));
  check(termRow, "Term not found.", 404);
  // Primary classes use First Half Term and Second Half Term marks out of 100 whatever the term's CA and exam maxima are.
  const scheme = await classScheme(classId);
  const term = schemeMaxima(termRow, scheme);
  const subjectRows = await db.select().from(portalSubjects).where(eq(portalSubjects.classId, classId)).orderBy(asc(portalSubjects.sortOrder), asc(portalSubjects.name));
  const teacherIds = [...new Set(subjectRows.map((s) => s.teacherId).filter((id): id is number => id !== null))];
  const teacherNames = new Map(teacherIds.length ? (await db.select({ id: portalTeachers.id, name: portalTeachers.name }).from(portalTeachers).where(inArray(portalTeachers.id, teacherIds))).map((t) => [t.id, t.name]) : []);
  const subjects = subjectRows.map((s) => ({ ...s, teacherName: s.teacherId === null ? null : teacherNames.get(s.teacherId) ?? null }));
  // The class for a term is its current pupils plus anyone with scores in its subjects that term,
  // so past (or imported) results keep the pupils who have since moved to another class.
  const subjectIds = subjects.map((s) => s.id);
  const scored = subjectIds.length ? (await db.selectDistinct({ id: portalScores.studentId }).from(portalScores).where(and(eq(portalScores.termId, termId), inArray(portalScores.subjectId, subjectIds)))).map((r) => r.id) : [];
  const students = await db.select({ id: portalStudents.id, studentId: portalStudents.studentId, name: portalStudents.name })
    .from(portalStudents).where(or(and(eq(portalStudents.classId, classId), eq(portalStudents.active, true)), scored.length ? inArray(portalStudents.id, scored) : undefined)).orderBy(asc(portalStudents.name));
  const ids = students.map((s) => s.id);
  const scores = ids.length && subjectIds.length ? await db.select().from(portalScores).where(and(eq(portalScores.termId, termId), inArray(portalScores.studentId, ids), inArray(portalScores.subjectId, subjectIds))) : [];
  const cards = ids.length ? await db.select().from(portalReportCards).where(and(eq(portalReportCards.termId, termId), inArray(portalReportCards.studentId, ids))) : [];
  const [release] = await db.select().from(portalReportReleases).where(and(eq(portalReportReleases.termId, termId), eq(portalReportReleases.classId, classId)));
  const [workflow, settings] = await Promise.all([workflowRow(termId, classId), reportSettings()]);
  // Typed totals and grades count only when the class's results are in manual mode.
  const manual = workflow?.mode === "manual";
  const report = buildClassReport(ids, subjects.map((s) => s.id), scores.map((s) => (manual ? s : { ...s, total: null, grade: null })), term, settings.gradingScale, scheme);
  const [principal, director] = await Promise.all([cardPrincipal(classId, workflow, settings), cardDirector()]);
  return { term, scheme, subjects, students, scores, cards, release, report, workflow, settings, principal, director };
}

/** A class's results for a term as the workspace shows them. */
const classPayload = (d: Awaited<ReturnType<typeof classData>>) => ({
  scheme: d.scheme, subjects: d.subjects, students: d.students,
  scores: d.scores.map((s) => ({ studentId: s.studentId, subjectId: s.subjectId, ca: s.ca, ca2: s.ca2, exam: s.exam, comment: s.comment, total: s.total, grade: s.grade })),
  cards: d.cards.map(cardView), results: d.report.students, subjectStats: d.report.subjectStats, ranked: d.report.ranked, released: !!d.release,
  workflow: workflowView(d.workflow, !!d.release), cardPrincipalName: d.principal.name, cardPrincipalSignature: d.principal.signature,
  cardDirectorName: d.director.name, cardDirectorSignature: d.director.signature,
});

/** One class's report workspace, read-only (no editing rights, no teacher list): for a principal's report card preview. */
export async function readOnlyWorkspace(termId: number, classId: number) {
  const [terms, [cls], settings] = await Promise.all([
    db.select().from(portalTerms).orderBy(desc(portalTerms.createdAt), desc(portalTerms.id)),
    db.select({ id: portalClasses.id, name: portalClasses.name }).from(portalClasses).where(eq(portalClasses.id, classId)),
    reportSettings(),
  ]);
  check(cls, "Class not found.", 404);
  const d = await classData(termId, classId);
  return {
    terms: terms.map(termView), classes: [cls], canAdmin: false, termId, classId, gradingScale: settings.gradingScale,
    principalName: settings.principalName, principalSignature: settings.principalSignature, mySignature: null, teachers: [],
    isClassTeacher: false, editableSubjectIds: [] as number[], ...classPayload(d),
  };
}

const cardView = (c: typeof portalReportCards.$inferSelect) => ({ studentId: c.studentId, teacherRemark: c.teacherRemark, principalRemark: c.principalRemark, daysPresent: c.daysPresent, daysOpen: c.daysOpen, traits: c.traits ?? {} });

portalReportsRouter.get("/reports/manage", async (req, res) => {
  const actor = await portalActor(req);
  staffOnly(actor);
  const query = GetReportWorkspaceQueryParams.parse(req.query);
  const terms = await db.select().from(portalTerms).orderBy(desc(portalTerms.createdAt), desc(portalTerms.id));
  const me = actor.role === "teacher" ? await teacherRecord(req.identity?.email) : undefined;
  const taught = await subjectsTaught(me?.id);
  const visible = [...new Set([...actor.classIds, ...taught.map((t) => t.classId)])];
  const classes = await db.select().from(portalClasses).where(actor.role === "admin" ? undefined : inArray(portalClasses.id, visible.length ? visible : [-1])).orderBy(asc(portalClasses.name));
  const settings = await reportSettings();
  const empty = { subjects: [], students: [], scores: [], cards: [], results: [], subjectStats: [], ranked: 0, released: false, workflow: workflowView(undefined, false), isClassTeacher: false, editableSubjectIds: [] as number[], scheme: "secondary" as ResultScheme, cardPrincipalName: settings.principalName, cardPrincipalSignature: settings.principalSignature };
  const teachers = actor.role === "admin" ? (await db.select({ id: portalTeachers.id, name: portalTeachers.name }).from(portalTeachers).where(eq(portalTeachers.active, true)).orderBy(asc(portalTeachers.name))) : [];
  const base = {
    terms: terms.map(termView), classes: classes.map((c) => ({ id: c.id, name: c.name })), canAdmin: actor.role === "admin", termId: query.termId ?? null, classId: query.classId ?? null,
    gradingScale: settings.gradingScale, principalName: settings.principalName, principalSignature: settings.principalSignature, mySignature: me?.signature ?? null, teachers,
  };
  if (!query.termId || !query.classId) { res.json({ ...base, ...empty }); return; }
  const isClassTeacher = actor.role === "admin" || actor.classIds.includes(query.classId);
  const mine = taught.filter((t) => t.classId === query.classId).map((t) => t.id);
  check(isClassTeacher || mine.length, "You do not teach this class.", 403);
  const d = await classData(query.termId, query.classId);
  res.json({
    ...base, isClassTeacher, editableSubjectIds: isClassTeacher ? null : mine, ...classPayload(d),
  });
});

/** Subjects a teacher is the subject teacher for. */
async function subjectsTaught(teacherId: number | undefined) {
  if (!teacherId) return [];
  return db.select({ id: portalSubjects.id, classId: portalSubjects.classId }).from(portalSubjects).where(eq(portalSubjects.teacherId, teacherId));
}

/** Students the actor may edit, keyed by id, with their class. Rejects anyone outside the actor's classes. */
async function editableStudents(actor: PortalActor, ids: number[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map<number, number>();
  const rows = await db.select({ id: portalStudents.id, classId: portalStudents.classId, active: portalStudents.active }).from(portalStudents).where(inArray(portalStudents.id, unique));
  check(rows.length === unique.length && rows.every((r) => r.active), "One or more students were not found.", 404);
  for (const r of rows) classAllowed(actor, r.classId);
  return new Map(rows.map((r) => [r.id, r.classId]));
}

async function teacherRecord(email: string | null | undefined) {
  if (!email) return undefined;
  const [t] = await db.select().from(portalTeachers).where(and(eq(portalTeachers.email, email.trim().toLowerCase()), eq(portalTeachers.active, true)));
  return t;
}

/** Scores and remarks change only in draft; the office may still correct them while they wait for approval. */
async function assertEditable(actor: PortalActor, termId: number, classIds: number[]) {
  for (const classId of new Set(classIds)) {
    const [release] = await db.select().from(portalReportReleases).where(and(eq(portalReportReleases.termId, termId), eq(portalReportReleases.classId, classId))).limit(1);
    check(!release, "Results for this class are published. Withhold them before making changes.", 409);
    const status = statusOf(await workflowRow(termId, classId), false);
    check(status !== "approved", "These results are approved. Return them to draft before making changes.", 409);
    check(status !== "review" || actor.role === "admin", "These results are waiting for approval. Take them back to make changes.", 409);
  }
}

portalReportsRouter.post("/reports/manage", async (req, res) => {
  const actor = await portalActor(req);
  staffOnly(actor);
  const body = ManageReportsBody.parse(req.body);
  const adminOnly = ["saveTerm", "deleteTerm", "saveSubject", "deleteSubject", "releaseReports", "saveSettings"];
  if (adminOnly.includes(body.action)) check(actor.role === "admin", "Only school administrators can change terms, subjects, result settings and result release.", 403);
  switch (body.action) {
    case "saveTerm": {
      const t = body.term;
      check(t, "Term details required.");
      const session = t.session.trim(), term = t.term.trim();
      check(/^\d{4}\/\d{4}$/.test(session) && Number(session.slice(5)) === Number(session.slice(0, 4)) + 1, "Use a session like 2026/2027.");
      check(term, "Term name required.");
      const [current] = t.id ? await db.select().from(portalTerms).where(eq(portalTerms.id, t.id)) : [];
      const ca2Max = t.ca2Max ?? current?.ca2Max ?? 0;
      check(t.caMax + ca2Max + t.examMax > 0, "Continuous assessment and exam cannot both be zero.");
      check(t.caMax + ca2Max + t.examMax <= 300, "The marks for CA and exam add up to too much.");
      const values = { session, term, caMax: t.caMax, ca2Max, examMax: t.examMax, nextTermBegins: t.nextTermBegins?.trim() || null };
      const [clash] = await db.select({ id: portalTerms.id }).from(portalTerms).where(and(eq(portalTerms.session, session), eq(portalTerms.term, term)));
      check(!clash || clash.id === t.id, "That term already exists for this session.", 409);
      if (t.id) {
        // Primary classes' marks are out of 100 whatever the term says, so only secondary marks are checked here.
        const scores = (await db.select({ ca: portalScores.ca, ca2: portalScores.ca2, exam: portalScores.exam, className: portalClasses.name }).from(portalScores)
          .innerJoin(portalSubjects, eq(portalSubjects.id, portalScores.subjectId)).innerJoin(portalClasses, eq(portalClasses.id, portalSubjects.classId))
          .where(eq(portalScores.termId, t.id))).filter((r) => schemeFor(r.className) === "secondary");
        check(scores.every((s) => (s.ca ?? 0) <= t.caMax && (s.ca2 ?? 0) <= ca2Max && (s.exam ?? 0) <= t.examMax), "Some entered scores are higher than the new maximum. Correct them first.", 409);
        const rows = await db.update(portalTerms).set(values).where(eq(portalTerms.id, t.id)).returning();
        check(rows.length, "Term not found.", 404);
      } else await db.insert(portalTerms).values(values);
      break;
    }
    case "deleteTerm": {
      check(body.target, "Term required.");
      const id = body.target.id;
      const [score] = await db.select({ id: portalScores.id }).from(portalScores).where(eq(portalScores.termId, id)).limit(1);
      const [card] = await db.select({ id: portalReportCards.id }).from(portalReportCards).where(eq(portalReportCards.termId, id)).limit(1);
      check(!score && !card, "This term already has scores or remarks, so it cannot be deleted.", 409);
      await db.delete(portalReportReleases).where(eq(portalReportReleases.termId, id));
      const rows = await db.delete(portalTerms).where(eq(portalTerms.id, id)).returning();
      check(rows.length, "Term not found.", 404);
      break;
    }
    case "saveSubject": {
      const s = body.subject;
      check(s, "Subject details required.");
      const name = s.name.trim().replace(/\s+/g, " ");
      check(name, "Subject name required.");
      const [cls] = await db.select().from(portalClasses).where(eq(portalClasses.id, s.classId));
      check(cls, "Class not found.", 404);
      const existing = await db.select({ id: portalSubjects.id, name: portalSubjects.name }).from(portalSubjects).where(eq(portalSubjects.classId, s.classId));
      const teacherId = s.teacherId ?? null;
      if (teacherId !== null) {
        const [t] = await db.select({ id: portalTeachers.id }).from(portalTeachers).where(and(eq(portalTeachers.id, teacherId), eq(portalTeachers.active, true)));
        check(t, "Choose an active teacher.", 404);
      }
      check(!existing.some((e) => e.id !== s.id && e.name.toLowerCase() === name.toLowerCase()), "This class already has that subject.", 409);
      if (s.id) {
        const rows = await db.update(portalSubjects).set({ name, sortOrder: s.sortOrder ?? 0, teacherId }).where(and(eq(portalSubjects.id, s.id), eq(portalSubjects.classId, s.classId))).returning();
        check(rows.length, "Subject not found.", 404);
      } else await db.insert(portalSubjects).values({ classId: s.classId, name, sortOrder: s.sortOrder ?? existing.length, teacherId });
      break;
    }
    case "deleteSubject": {
      check(body.target, "Subject required.");
      const [score] = await db.select({ id: portalScores.id }).from(portalScores).where(eq(portalScores.subjectId, body.target.id)).limit(1);
      check(!score, "Scores have been entered for this subject, so it cannot be deleted.", 409);
      const rows = await db.delete(portalSubjects).where(eq(portalSubjects.id, body.target.id)).returning();
      check(rows.length, "Subject not found.", 404);
      break;
    }
    case "saveScores": {
      const data = body.scores;
      check(data && data.entries.length, "Scores required.");
      const [term] = await db.select().from(portalTerms).where(eq(portalTerms.id, data.termId));
      check(term, "Term not found.", 404);
      const taughtIds = new Set((await subjectsTaught(actor.role === "teacher" ? (await teacherRecord(req.identity?.email))?.id : undefined)).map((t) => t.id));
      const ownClass = (classId: number) => actor.role === "admin" || actor.classIds.includes(classId);
      const rows = await db.select({ id: portalStudents.id, classId: portalStudents.classId, active: portalStudents.active }).from(portalStudents).where(inArray(portalStudents.id, [...new Set(data.entries.map((e) => e.studentId))]));
      check(rows.length === new Set(data.entries.map((e) => e.studentId)).size && rows.every((r) => r.active), "One or more students were not found.", 404);
      const studentClass = new Map(rows.map((r) => [r.id, r.classId]));
      for (const e of data.entries) check(ownClass(studentClass.get(e.studentId)!) || taughtIds.has(e.subjectId), "You can only enter scores for your own classes or the subjects you teach.", 403);
      const subjects = await db.select({ id: portalSubjects.id, classId: portalSubjects.classId }).from(portalSubjects).where(inArray(portalSubjects.id, [...new Set(data.entries.map((e) => e.subjectId))]));
      const subjectClass = new Map(subjects.map((s) => [s.id, s.classId]));
      const seen = new Set<string>();
      const modes = new Map<number, string>();
      for (const classId of new Set(studentClass.values())) modes.set(classId, (await workflowRow(term.id, classId))?.mode ?? "automatic");
      const scale = (await reportSettings()).gradingScale;
      const schemes = new Map<number, ResultScheme>();
      for (const classId of new Set(studentClass.values())) schemes.set(classId, await classScheme(classId));
      for (const e of data.entries) {
        check(subjectClass.get(e.subjectId) === studentClass.get(e.studentId), "A subject does not belong to the student's class.");
        const scheme = schemes.get(studentClass.get(e.studentId)!)!;
        const m = schemeMaxima(term, scheme);
        if (scheme === "primary") {
          check(validScorePart(e.ca, 100) && validScorePart(e.exam, 100), "First Half Term and Second Half Term marks must be between 0 and 100, in half marks.");
          check(e.ca2 === undefined || e.ca2 === null, "Primary classes have no CA 2: enter a First Half Term and an Second Half Term mark.");
        } else {
          check(validScorePart(e.ca, m.caMax) && validScorePart(e.exam, m.examMax), m.ca2Max
            ? `Scores must be between 0 and ${m.caMax} (CA 1) and 0 and ${m.examMax} (exam), in half marks.`
            : `Scores must be between 0 and ${m.caMax} (CA) and 0 and ${m.examMax} (exam), in half marks.`);
          check(validScorePart(e.ca2, m.ca2Max), m.ca2Max ? `CA 2 must be between 0 and ${m.ca2Max}, in half marks.` : "This term has no CA 2. Set a CA 2 maximum for the term first.");
        }
        if (e.comment !== undefined && e.comment !== null) { e.comment = e.comment.trim(); check(e.comment.length <= 300, "Keep each comment under 300 characters."); }
        if (modes.get(studentClass.get(e.studentId)!) !== "manual") { e.total = null; e.grade = null; }
        const possible = schemePossible(m, scheme);
        check(validScorePart(e.total, possible), `A typed total must be between 0 and ${possible}, in half marks.`);
        e.grade = e.grade?.trim().toUpperCase() || null;
        check(!e.grade || scale.some((b) => b.grade.toUpperCase() === e.grade), "Use a grade from the school's grading scale.");
        const key = e.studentId + ":" + e.subjectId;
        check(!seen.has(key), "Each student and subject may appear only once.");
        seen.add(key);
      }
      await assertEditable(actor, term.id, [...studentClass.values()]);
      await db.transaction(async (tx) => {
        for (const e of data.entries) {
          const where = and(eq(portalScores.termId, term.id), eq(portalScores.studentId, e.studentId), eq(portalScores.subjectId, e.subjectId));
          const total = e.total ?? null, grade = e.grade ?? null;
          // CA 2 and the comment are only changed when sent, so a CBT import or pasted CA 1 keeps them.
          const extra = { ...(e.ca2 !== undefined ? { ca2: e.ca2 } : {}), ...(e.comment !== undefined ? { comment: e.comment ?? "" } : {}) };
          await tx.insert(portalScores).values({ termId: term.id, studentId: e.studentId, subjectId: e.subjectId, ca: e.ca, exam: e.exam, total, grade, ...extra })
            .onConflictDoUpdate({ target: [portalScores.termId, portalScores.studentId, portalScores.subjectId], set: { ca: e.ca, exam: e.exam, total, grade, ...extra, updatedAt: new Date() } });
          // A row with no marks and no comment left is removed.
          await tx.delete(portalScores).where(and(where, isNull(portalScores.ca), isNull(portalScores.ca2), isNull(portalScores.exam), isNull(portalScores.total), eq(portalScores.comment, "")));
        }
      });
      break;
    }
    case "saveCards": {
      const data = body.cards;
      check(data && data.entries.length, "Remarks required.");
      const [term] = await db.select().from(portalTerms).where(eq(portalTerms.id, data.termId));
      check(term, "Term not found.", 404);
      const studentClass = await editableStudents(actor, data.entries.map((e) => e.studentId));
      check(new Set(data.entries.map((e) => e.studentId)).size === data.entries.length, "Each student may appear only once.");
      for (const e of data.entries) check(e.daysPresent === null || e.daysOpen === null || e.daysPresent <= e.daysOpen, "Days present cannot exceed days the school opened.");
      for (const e of data.entries) { const problem = e.traits ? traitsProblem(e.traits) : null; check(!problem, problem ?? ""); }
      await assertEditable(actor, term.id, [...studentClass.values()]);
      const existing = await db.select().from(portalReportCards).where(and(eq(portalReportCards.termId, term.id), inArray(portalReportCards.studentId, data.entries.map((e) => e.studentId))));
      const previous = new Map(existing.map((c) => [c.studentId, c]));
      await db.transaction(async (tx) => {
        for (const e of data.entries) {
          // Only administrators write the principal's remark; a teacher's save keeps it unchanged.
          const principalRemark = actor.role === "admin" ? e.principalRemark.trim() : previous.get(e.studentId)?.principalRemark ?? "";
          const values = { teacherRemark: e.teacherRemark.trim(), principalRemark, daysPresent: e.daysPresent, daysOpen: e.daysOpen, ...(e.traits ? { traits: e.traits } : {}) };
          await tx.insert(portalReportCards).values({ termId: term.id, studentId: e.studentId, ...values })
            .onConflictDoUpdate({ target: [portalReportCards.termId, portalReportCards.studentId], set: values });
        }
      });
      break;
    }
    case "releaseReports": {
      const r = body.release;
      check(r, "Release details required.");
      const [term] = await db.select({ id: portalTerms.id }).from(portalTerms).where(eq(portalTerms.id, r.termId));
      const [cls] = await db.select({ id: portalClasses.id }).from(portalClasses).where(eq(portalClasses.id, r.classId));
      check(term && cls, "Term or class not found.", 404);
      // The office publishing directly counts as its approval.
      if (r.released) {
        if (statusOf(await workflowRow(r.termId, r.classId), false) !== "approved") await upsertWorkflow(r.termId, r.classId, { status: "approved", approvedBy: approver(req, actor), approvedAt: new Date(), ...await approvalSignature(req, r.classId) });
        await db.insert(portalReportReleases).values({ termId: r.termId, classId: r.classId }).onConflictDoNothing();
      } else {
        // Withholding sends the results back to draft so they can be corrected.
        await db.delete(portalReportReleases).where(and(eq(portalReportReleases.termId, r.termId), eq(portalReportReleases.classId, r.classId)));
        await upsertWorkflow(r.termId, r.classId, { status: "draft", principalName: "", principalSignature: null });
      }
      break;
    }
    case "saveSettings": {
      const st = body.settings;
      check(st, "Result settings required.");
      const scale = st.gradingScale.map((b) => ({ min: b.min, grade: b.grade.trim().toUpperCase(), remark: b.remark.trim() }));
      const problem = scaleProblem(scale) ?? signatureProblem(st.principalSignature);
      check(!problem, problem ?? "");
      const values = { gradingScale: scale, principalName: st.principalName.trim(), principalSignature: st.principalSignature, updatedAt: new Date() };
      await db.insert(portalReportSettings).values({ id: 1, ...values }).onConflictDoUpdate({ target: portalReportSettings.id, set: values });
      break;
    }
    case "saveSignature": {
      check(body.signature, "Signature required.");
      check(actor.role === "teacher", "The principal's signature is set in Result settings.", 403);
      const problem = signatureProblem(body.signature.image);
      check(!problem, problem ?? "");
      const me = await teacherRecord(req.identity?.email);
      check(me, "Teacher not found.", 404);
      await db.update(portalTeachers).set({ signature: body.signature.image }).where(eq(portalTeachers.id, me.id));
      break;
    }
    case "setMode": {
      const m = body.mode;
      check(m, "Mode required.");
      classAllowed(actor, m.classId);
      const status = statusOf(await workflowRow(m.termId, m.classId), false);
      const [release] = await db.select().from(portalReportReleases).where(and(eq(portalReportReleases.termId, m.termId), eq(portalReportReleases.classId, m.classId)));
      check(!release && status === "draft", "Change how results are prepared only while they are a draft.", 409);
      await upsertWorkflow(m.termId, m.classId, { mode: m.mode });
      break;
    }
    case "workflow": {
      const w = body.workflow;
      check(w, "Action required.");
      classAllowed(actor, w.classId);
      const [term] = await db.select({ id: portalTerms.id }).from(portalTerms).where(eq(portalTerms.id, w.termId));
      check(term, "Term not found.", 404);
      const row = await workflowRow(w.termId, w.classId);
      const [release] = await db.select().from(portalReportReleases).where(and(eq(portalReportReleases.termId, w.termId), eq(portalReportReleases.classId, w.classId)));
      const next = nextStatus(statusOf(row, !!release), w.action, actor.role === "admin" ? "admin" : "teacher");
      check(!("problem" in next), "problem" in next ? next.problem : "");
      if (w.action === "submit") {
        const d = await classData(w.termId, w.classId);
        check(d.scores.length > 0, "Enter scores before sending the results for approval.");
        let signature: string | null = null;
        if (actor.role === "teacher") {
          signature = (await teacherRecord(req.identity?.email))?.signature ?? null;
          check(signature, "Add your signature first (Result settings, My signature), then send the results.");
        }
        await upsertWorkflow(w.termId, w.classId, { status: "review", teacherName: actor.name, teacherSignature: signature, submittedAt: new Date(), returnNote: "" });
      } else if (w.action === "withdraw") await upsertWorkflow(w.termId, w.classId, { status: "draft" });
      else if (w.action === "approve") await upsertWorkflow(w.termId, w.classId, { status: "approved", approvedBy: approver(req, actor), approvedAt: new Date(), ...await approvalSignature(req, w.classId) });
      else if (w.action === "return") await upsertWorkflow(w.termId, w.classId, { status: "draft", returnNote: (w.note ?? "").trim(), approvedAt: null, approvedBy: "", principalName: "", principalSignature: null });
      else if (w.action === "publish") await db.insert(portalReportReleases).values({ termId: w.termId, classId: w.classId }).onConflictDoNothing();
      else await db.delete(portalReportReleases).where(and(eq(portalReportReleases.termId, w.termId), eq(portalReportReleases.classId, w.classId)));
      break;
    }
  }
  res.json({ message: "Saved successfully." });
});

portalReportsRouter.get("/reports", async (req, res) => {
  res.json(await publishedReportsFor(studentOnly(await portalActor(req))));
});

/** A student's published report cards, newest term first: for the student, and for their parents. */
export async function publishedReportsFor(student: { id: number; classId: number; name: string; studentId: string }) {
  const [cls] = await db.select().from(portalClasses).where(eq(portalClasses.id, student.classId));
  // Published results for the student's current class, and for any class they had scores in (past years, imported results).
  const scoredIn = await db.selectDistinct({ termId: portalScores.termId, classId: portalSubjects.classId }).from(portalScores)
    .innerJoin(portalSubjects, eq(portalSubjects.id, portalScores.subjectId)).where(eq(portalScores.studentId, student.id));
  const releases = (await db.select().from(portalReportReleases).where(inArray(portalReportReleases.classId, [...new Set([student.classId, ...scoredIn.map((p) => p.classId)])])))
    .filter((r) => r.classId === student.classId || scoredIn.some((p) => p.termId === r.termId && p.classId === r.classId));
  const classNames = new Map((await db.select({ id: portalClasses.id, name: portalClasses.name }).from(portalClasses)).map((c) => [c.id, c.name]));
  const reports = [];
  for (const release of releases) {
    const d = await classData(release.termId, release.classId);
    const result = d.report.students.find((s) => s.studentId === student.id);
    if (!result) continue;
    const card = d.cards.find((c) => c.studentId === student.id);
    reports.push({
      term: termView(d.term), scheme: d.scheme, subjects: d.subjects, result, subjectStats: d.report.subjectStats,
      classSize: d.report.ranked, card: card ? cardView(card) : null, releasedAt: release.releasedAt.toISOString(),
      className: classNames.get(release.classId) ?? "", gradingScale: d.settings.gradingScale,
      teacherName: d.workflow?.teacherName ?? "", teacherSignature: d.workflow?.teacherSignature ?? null,
      principalName: d.principal.name, principalSignature: d.principal.signature,
      directorName: d.director.name, directorSignature: d.director.signature,
      sortKey: d.term.createdAt.getTime(),
    });
  }
  reports.sort((a, b) => b.sortKey - a.sortKey);
  return { studentName: student.name, studentId: student.studentId, className: cls?.name ?? "", reports: reports.map(({ sortKey: _s, ...r }) => r) };
}
