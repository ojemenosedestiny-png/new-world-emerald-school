import { Router } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  db, portalClasses, portalStudents, portalTerms, portalSubjects, portalScores, portalReportCards, portalReportReleases,
  portalReportSettings, portalReportWorkflow, portalTeachers, type PortalTermRecord, type PortalReportWorkflowRecord,
} from "@workspace/db";
import { GetReportWorkspaceQueryParams, ManageReportsBody } from "@workspace/api-zod";
import { check, classAllowed, portalActor, staffOnly, studentOnly, type PortalActor } from "../lib/portal-auth";
import { GRADE_SCALE, buildClassReport, nextStatus, scaleProblem, signatureProblem, validScorePart, type GradeBand, type ResultStatus } from "../lib/report-cards";

export const portalReportsRouter = Router();

const approver = (req: { identity?: { email?: string | null } }, actor: PortalActor) => actor.name || req.identity?.email || "School office";

const termView = (t: PortalTermRecord) => ({ id: t.id, session: t.session, term: t.term, caMax: t.caMax, examMax: t.examMax, nextTermBegins: t.nextTermBegins });

async function reportSettings() {
  const [row] = await db.select().from(portalReportSettings).where(eq(portalReportSettings.id, 1));
  return { gradingScale: (row?.gradingScale ?? GRADE_SCALE.map((b) => ({ ...b }))) as GradeBand[], principalName: row?.principalName ?? "", principalSignature: row?.principalSignature ?? null };
}
async function workflowRow(termId: number, classId: number) {
  const [row] = await db.select().from(portalReportWorkflow).where(and(eq(portalReportWorkflow.termId, termId), eq(portalReportWorkflow.classId, classId)));
  return row;
}
/** Published is a release row; otherwise the workflow row's status (draft when there is none). */
const statusOf = (row: PortalReportWorkflowRecord | undefined, released: boolean): ResultStatus => (released ? "published" : (row?.status as ResultStatus) ?? "draft");
const workflowView = (row: PortalReportWorkflowRecord | undefined, released: boolean) => ({
  status: statusOf(row, released), mode: (row?.mode ?? "automatic") as "automatic" | "manual",
  teacherName: row?.teacherName ?? "", teacherSignature: row?.teacherSignature ?? null, submittedAt: row?.submittedAt?.toISOString() ?? null,
  approvedBy: row?.approvedBy ?? "", approvedAt: row?.approvedAt?.toISOString() ?? null, returnNote: row?.returnNote ?? "",
});
async function upsertWorkflow(termId: number, classId: number, values: Partial<typeof portalReportWorkflow.$inferInsert>) {
  await db.insert(portalReportWorkflow).values({ termId, classId, ...values, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [portalReportWorkflow.termId, portalReportWorkflow.classId], set: { ...values, updatedAt: new Date() } });
}

async function classData(termId: number, classId: number) {
  const [term] = await db.select().from(portalTerms).where(eq(portalTerms.id, termId));
  check(term, "Term not found.", 404);
  const subjects = await db.select().from(portalSubjects).where(eq(portalSubjects.classId, classId)).orderBy(asc(portalSubjects.sortOrder), asc(portalSubjects.name));
  const students = await db.select({ id: portalStudents.id, studentId: portalStudents.studentId, name: portalStudents.name })
    .from(portalStudents).where(and(eq(portalStudents.classId, classId), eq(portalStudents.active, true))).orderBy(asc(portalStudents.name));
  const ids = students.map((s) => s.id);
  const scores = ids.length ? await db.select().from(portalScores).where(and(eq(portalScores.termId, termId), inArray(portalScores.studentId, ids))) : [];
  const cards = ids.length ? await db.select().from(portalReportCards).where(and(eq(portalReportCards.termId, termId), inArray(portalReportCards.studentId, ids))) : [];
  const [release] = await db.select().from(portalReportReleases).where(and(eq(portalReportReleases.termId, termId), eq(portalReportReleases.classId, classId)));
  const [workflow, settings] = await Promise.all([workflowRow(termId, classId), reportSettings()]);
  // Typed totals and grades count only when the class's results are in manual mode.
  const manual = workflow?.mode === "manual";
  const report = buildClassReport(ids, subjects.map((s) => s.id), scores.map((s) => (manual ? s : { ...s, total: null, grade: null })), term, settings.gradingScale);
  return { term, subjects, students, scores, cards, release, report, workflow, settings };
}

const cardView = (c: typeof portalReportCards.$inferSelect) => ({ studentId: c.studentId, teacherRemark: c.teacherRemark, principalRemark: c.principalRemark, daysPresent: c.daysPresent, daysOpen: c.daysOpen });

portalReportsRouter.get("/reports/manage", async (req, res) => {
  const actor = await portalActor(req);
  staffOnly(actor);
  const query = GetReportWorkspaceQueryParams.parse(req.query);
  const terms = await db.select().from(portalTerms).orderBy(desc(portalTerms.createdAt), desc(portalTerms.id));
  const classes = await db.select().from(portalClasses).where(actor.role === "admin" ? undefined : inArray(portalClasses.id, actor.classIds.length ? actor.classIds : [-1])).orderBy(asc(portalClasses.name));
  const empty = { subjects: [], students: [], scores: [], cards: [], results: [], subjectStats: [], ranked: 0, released: false, workflow: workflowView(undefined, false) };
  const settings = await reportSettings();
  const me = actor.role === "teacher" ? await teacherRecord(req.identity?.email) : undefined;
  const base = {
    terms: terms.map(termView), classes: classes.map((c) => ({ id: c.id, name: c.name })), canAdmin: actor.role === "admin", termId: query.termId ?? null, classId: query.classId ?? null,
    gradingScale: settings.gradingScale, principalName: settings.principalName, principalSignature: settings.principalSignature, mySignature: me?.signature ?? null,
  };
  if (!query.termId || !query.classId) { res.json({ ...base, ...empty }); return; }
  classAllowed(actor, query.classId);
  const d = await classData(query.termId, query.classId);
  res.json({
    ...base,
    subjects: d.subjects, students: d.students,
    scores: d.scores.map((s) => ({ studentId: s.studentId, subjectId: s.subjectId, ca: s.ca, exam: s.exam, total: s.total, grade: s.grade })),
    cards: d.cards.map(cardView), results: d.report.students, subjectStats: d.report.subjectStats, ranked: d.report.ranked, released: !!d.release,
    workflow: workflowView(d.workflow, !!d.release),
  });
});

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
      check(t.caMax + t.examMax > 0, "Continuous assessment and exam cannot both be zero.");
      const values = { session, term, caMax: t.caMax, examMax: t.examMax, nextTermBegins: t.nextTermBegins?.trim() || null };
      const [clash] = await db.select({ id: portalTerms.id }).from(portalTerms).where(and(eq(portalTerms.session, session), eq(portalTerms.term, term)));
      check(!clash || clash.id === t.id, "That term already exists for this session.", 409);
      if (t.id) {
        const scores = await db.select({ ca: portalScores.ca, exam: portalScores.exam }).from(portalScores).where(eq(portalScores.termId, t.id));
        check(scores.every((s) => (s.ca ?? 0) <= t.caMax && (s.exam ?? 0) <= t.examMax), "Some entered scores are higher than the new maximum. Correct them first.", 409);
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
      check(!existing.some((e) => e.id !== s.id && e.name.toLowerCase() === name.toLowerCase()), "This class already has that subject.", 409);
      if (s.id) {
        const rows = await db.update(portalSubjects).set({ name, sortOrder: s.sortOrder ?? 0 }).where(and(eq(portalSubjects.id, s.id), eq(portalSubjects.classId, s.classId))).returning();
        check(rows.length, "Subject not found.", 404);
      } else await db.insert(portalSubjects).values({ classId: s.classId, name, sortOrder: s.sortOrder ?? existing.length });
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
      const studentClass = await editableStudents(actor, data.entries.map((e) => e.studentId));
      const subjects = await db.select({ id: portalSubjects.id, classId: portalSubjects.classId }).from(portalSubjects).where(inArray(portalSubjects.id, [...new Set(data.entries.map((e) => e.subjectId))]));
      const subjectClass = new Map(subjects.map((s) => [s.id, s.classId]));
      const seen = new Set<string>();
      const modes = new Map<number, string>();
      for (const classId of new Set(studentClass.values())) modes.set(classId, (await workflowRow(term.id, classId))?.mode ?? "automatic");
      const scale = (await reportSettings()).gradingScale;
      for (const e of data.entries) {
        check(subjectClass.get(e.subjectId) === studentClass.get(e.studentId), "A subject does not belong to the student's class.");
        check(validScorePart(e.ca, term.caMax) && validScorePart(e.exam, term.examMax), `Scores must be between 0 and ${term.caMax} (CA) and 0 and ${term.examMax} (exam), in half marks.`);
        if (modes.get(studentClass.get(e.studentId)!) !== "manual") { e.total = null; e.grade = null; }
        check(validScorePart(e.total, term.caMax + term.examMax), `A typed total must be between 0 and ${term.caMax + term.examMax}, in half marks.`);
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
          if (e.ca === null && e.exam === null && total === null) { await tx.delete(portalScores).where(where); continue; }
          await tx.insert(portalScores).values({ termId: term.id, studentId: e.studentId, subjectId: e.subjectId, ca: e.ca, exam: e.exam, total, grade })
            .onConflictDoUpdate({ target: [portalScores.termId, portalScores.studentId, portalScores.subjectId], set: { ca: e.ca, exam: e.exam, total, grade, updatedAt: new Date() } });
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
      await assertEditable(actor, term.id, [...studentClass.values()]);
      const existing = await db.select().from(portalReportCards).where(and(eq(portalReportCards.termId, term.id), inArray(portalReportCards.studentId, data.entries.map((e) => e.studentId))));
      const previous = new Map(existing.map((c) => [c.studentId, c]));
      await db.transaction(async (tx) => {
        for (const e of data.entries) {
          // Only administrators write the principal's remark; a teacher's save keeps it unchanged.
          const principalRemark = actor.role === "admin" ? e.principalRemark.trim() : previous.get(e.studentId)?.principalRemark ?? "";
          const values = { teacherRemark: e.teacherRemark.trim(), principalRemark, daysPresent: e.daysPresent, daysOpen: e.daysOpen };
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
        if (statusOf(await workflowRow(r.termId, r.classId), false) !== "approved") await upsertWorkflow(r.termId, r.classId, { status: "approved", approvedBy: approver(req, actor), approvedAt: new Date() });
        await db.insert(portalReportReleases).values({ termId: r.termId, classId: r.classId }).onConflictDoNothing();
      } else {
        // Withholding sends the results back to draft so they can be corrected.
        await db.delete(portalReportReleases).where(and(eq(portalReportReleases.termId, r.termId), eq(portalReportReleases.classId, r.classId)));
        await upsertWorkflow(r.termId, r.classId, { status: "draft" });
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
      else if (w.action === "approve") await upsertWorkflow(w.termId, w.classId, { status: "approved", approvedBy: approver(req, actor), approvedAt: new Date() });
      else if (w.action === "return") await upsertWorkflow(w.termId, w.classId, { status: "draft", returnNote: (w.note ?? "").trim(), approvedAt: null, approvedBy: "" });
      else if (w.action === "publish") await db.insert(portalReportReleases).values({ termId: w.termId, classId: w.classId }).onConflictDoNothing();
      else await db.delete(portalReportReleases).where(and(eq(portalReportReleases.termId, w.termId), eq(portalReportReleases.classId, w.classId)));
      break;
    }
  }
  res.json({ message: "Saved successfully." });
});

portalReportsRouter.get("/reports", async (req, res) => {
  const student = studentOnly(await portalActor(req));
  const [cls] = await db.select().from(portalClasses).where(eq(portalClasses.id, student.classId));
  const releases = await db.select().from(portalReportReleases).where(eq(portalReportReleases.classId, student.classId));
  const reports = [];
  for (const release of releases) {
    const d = await classData(release.termId, student.classId);
    const result = d.report.students.find((s) => s.studentId === student.id);
    if (!result) continue;
    const card = d.cards.find((c) => c.studentId === student.id);
    reports.push({
      term: termView(d.term), subjects: d.subjects, result, subjectStats: d.report.subjectStats,
      classSize: d.report.ranked, card: card ? cardView(card) : null, releasedAt: release.releasedAt.toISOString(),
      className: cls?.name ?? "", gradingScale: d.settings.gradingScale,
      teacherName: d.workflow?.teacherName ?? "", teacherSignature: d.workflow?.teacherSignature ?? null,
      principalName: d.settings.principalName, principalSignature: d.settings.principalSignature,
      sortKey: d.term.createdAt.getTime(),
    });
  }
  reports.sort((a, b) => b.sortKey - a.sortKey);
  res.json({ studentName: student.name, studentId: student.studentId, className: cls?.name ?? "", reports: reports.map(({ sortKey: _s, ...r }) => r) });
});
