import { Router, type Request } from "express";
import { and, asc, desc, eq, gte, inArray, isNull, like, lt, or, sql } from "drizzle-orm";
import { db, portalAttempts, portalAuditLog, portalClasses, portalExams, portalStudents, portalSubjects, portalTeachers, type PortalExamRecord } from "@workspace/db";
import { GetExamOfficerActivityQueryParams, GetExamOfficerExamParams, GetExamOfficerOverviewQueryParams, ManageExamOfficerBody, RecordExamAccessBody, RecordExamAccessParams } from "@workspace/api-zod";
import { check, classAllowed, portalActor, staffOnly } from "../lib/portal-auth";
import { canPublishExams, isExamOfficer } from "../lib/website-admin";
import { examOfficerEmails } from "../lib/approved-identities";
import { validateQuestions } from "../lib/portal-assessment";
import { classSection, examTerm, lagosDay, lagosToday, lastDays } from "../lib/principal";
import { recordAudit } from "../lib/audit";

/**
 * The exam officer: the final step before an exam reaches students. Sees every exam in the school, publishes or returns
 * them, and sees what each member of staff did with exams, including who opened which questions.
 */
export const portalExamOfficerRouter = Router();

function officerOnly(req: Request) {
  check(req.dbUser, "Sign in with the exam officer's email.", 401);
  check(canPublishExams(req), "This page is for the exam officer only.", 403);
}

export type OfficerStatus = "draft" | "awaiting" | "returned" | "scheduled" | "open" | "closed" | "released";
export function officerStatus(e: Pick<PortalExamRecord, "published" | "resultsReleased" | "reviewStatus" | "startsAt" | "endsAt">, now = new Date()): OfficerStatus {
  if (e.published) {
    if (e.resultsReleased) return "released";
    if (now < e.startsAt) return "scheduled";
    return now <= e.endsAt ? "open" : "closed";
  }
  if (e.reviewStatus === "submitted") return "awaiting";
  return e.reviewStatus === "returned" ? "returned" : "draft";
}

const ACCESS = /^POST \/portal\/exams\/(\d+)\/access$/;

/** Everything needed to describe exams: classes, teachers (for names) and subjects (for older exams' setters). */
async function lookups() {
  const [classes, teachers, subjects] = await Promise.all([
    db.select({ id: portalClasses.id, name: portalClasses.name }).from(portalClasses),
    db.select({ id: portalTeachers.id, name: portalTeachers.name, email: portalTeachers.email }).from(portalTeachers),
    db.select({ classId: portalSubjects.classId, name: portalSubjects.name, teacherId: portalSubjects.teacherId }).from(portalSubjects),
  ]);
  const className = new Map(classes.map((c) => [c.id, c.name]));
  const byEmail = new Map(teachers.map((t) => [t.email.toLowerCase(), t.name]));
  const setBy = (e: PortalExamRecord) => {
    const by = e.createdBy.trim();
    if (by) return byEmail.get(by.toLowerCase()) ?? by;
    const s = subjects.find((x) => x.classId === e.classId && x.name.trim().toLowerCase() === e.subject.trim().toLowerCase());
    return (s?.teacherId ? teachers.find((t) => t.id === s.teacherId)?.name : "") ?? "";
  };
  const who = (label: string) => byEmail.get(label.toLowerCase()) ?? (examOfficerEmails().includes(label.toLowerCase()) ? `${label} (exam officer)` : label || "School office");
  return { className, setBy, who, byEmail };
}

async function summaries(exams: PortalExamRecord[]) {
  const ids = exams.map((e) => e.id);
  const L = await lookups();
  const classIds = [...new Set(exams.map((e) => e.classId))];
  const [counts, students, opens] = await Promise.all([
    ids.length ? db.select({ examId: portalAttempts.examId, sat: sql<number>`count(*) filter (where ${portalAttempts.status} <> 'in_progress')::int`, marked: sql<number>`count(*) filter (where ${portalAttempts.status} = 'marked')::int` })
      .from(portalAttempts).where(inArray(portalAttempts.examId, ids)).groupBy(portalAttempts.examId) : [] as { examId: number; sat: number; marked: number }[],
    classIds.length ? db.select({ classId: portalStudents.classId, n: sql<number>`count(*)::int` }).from(portalStudents).where(and(eq(portalStudents.active, true), inArray(portalStudents.classId, classIds))).groupBy(portalStudents.classId) : [] as { classId: number; n: number }[],
    ids.length ? db.select({ action: portalAuditLog.action, n: sql<number>`count(*)::int` }).from(portalAuditLog)
      .where(and(like(portalAuditLog.action, "POST /portal/exams/%/access"), eq(portalAuditLog.outcome, "success"))).groupBy(portalAuditLog.action) : [] as { action: string; n: number }[],
  ]);
  const opened = new Map<number, number>();
  for (const o of opens) { const m = ACCESS.exec(o.action); if (m) opened.set(Number(m[1]), (opened.get(Number(m[1])) ?? 0) + o.n); }
  return exams.map((e) => {
    const name = L.className.get(e.classId) ?? "";
    const c = counts.find((x) => x.examId === e.id);
    return {
      id: e.id, title: e.title, subject: e.subject, classId: e.classId, className: name, section: (classSection(name) ?? "other") as "primary" | "secondary" | "other",
      setBy: L.setBy(e), startsAt: e.startsAt.toISOString(), endsAt: e.endsAt.toISOString(), durationMinutes: e.durationMinutes, mode: e.mode,
      questionCount: e.questions.length, totalMarks: e.questions.reduce((n, q) => n + (q.marks || 0), 0), status: officerStatus(e),
      reviewNote: e.reviewNote, submittedBy: e.submittedBy ? L.who(e.submittedBy) : "", submittedAt: e.submittedAt?.toISOString() ?? null,
      reviewedBy: e.reviewedBy, reviewedAt: e.reviewedAt?.toISOString() ?? null,
      students: students.find((s) => s.classId === e.classId)?.n ?? 0, sat: c?.sat ?? 0, marked: c?.marked ?? 0, opened: opened.get(e.id) ?? 0,
    };
  });
}

const SECTION_LABEL = { primary: "Primary (Year 1 to 6)", secondary: "Secondary (JSS 1 to SS 3)", other: "Nursery and other classes" } as const;

/** Every exam for a term, and publishing by section. */
portalExamOfficerRouter.get("/exam-officer", async (req, res) => {
  officerOnly(req);
  const query = GetExamOfficerOverviewQueryParams.parse(req.query);
  const all = await db.select().from(portalExams).orderBy(asc(portalExams.startsAt));
  const byTerm = new Map<string, { key: string; label: string; count: number }>();
  for (const e of all) { const t = examTerm(e.startsAt); byTerm.set(t.key, { ...t, count: (byTerm.get(t.key)?.count ?? 0) + 1 }); }
  const terms = [...byTerm.values()].sort((a, b) => b.key.localeCompare(a.key));
  const now = examTerm(new Date());
  const term = terms.find((t) => t.key === query.term)?.key ?? (terms.some((t) => t.key === now.key) ? now.key : terms[0]?.key ?? null);
  // Exams waiting for the exam officer are always listed, whatever their dates.
  const chosen = all.filter((e) => examTerm(e.startsAt).key === term || e.reviewStatus === "submitted");
  const exams = await summaries(chosen);
  const sections = (["secondary", "primary", "other"] as const).map((section) => {
    const mine = exams.filter((e) => e.section === section);
    const n = (s: string) => mine.filter((e) => e.status === s).length;
    return { section, label: SECTION_LABEL[section], draft: n("draft"), awaiting: n("awaiting"), returned: n("returned"), scheduled: n("scheduled"), open: n("open"), closed: n("closed"), released: n("released") };
  });
  res.json({ configured: examOfficerEmails().length > 0, today: lagosToday(), term, terms, exams, sections });
});

type AuditRow = { at: Date; actorLabel: string; action: string; targetId: string | null; after: unknown };
type Kind = "saved" | "pdf" | "diagram" | "submitted" | "published" | "returned" | "withdrawn" | "hidden" | "opened" | "marked" | "released" | "deleted" | "attempt";

/** What an audit row means for exams, or null when it has nothing to do with them. */
export function describeExamEvent(row: Pick<AuditRow, "action" | "targetId" | "after">): { kind: Kind; label: string; examId: number | null; title: string } | null {
  const after = (row.after && typeof row.after === "object" ? row.after : {}) as Record<string, unknown>;
  const sub = (k: string) => (after[k] && typeof after[k] === "object" ? after[k] as Record<string, unknown> : {});
  const target = row.targetId && /^\d+$/.test(row.targetId) ? Number(row.targetId) : null;
  const access = ACCESS.exec(row.action);
  if (access) {
    const kind = after.kind === "copy" ? "Copied the questions" : after.kind === "pdf" ? "Opened the PDF paper" : "Opened the questions";
    return { kind: "opened", label: kind, examId: Number(access[1]), title: "" };
  }
  switch (row.action) {
    case "portal.saveExam": {
      const exam = sub("exam");
      return { kind: exam.published ? "submitted" : "saved", label: exam.published ? "Saved questions and asked to publish" : "Uploaded or edited questions", examId: target ?? (typeof exam.id === "number" ? exam.id : null), title: typeof exam.title === "string" ? exam.title : "" };
    }
    case "portal.examStatus": {
      const s = sub("examStatus");
      if (s.resultsReleased === true) return { kind: "released", label: "Released results", examId: target, title: "" };
      return s.published ? { kind: "submitted", label: "Asked to publish", examId: target, title: "" } : { kind: "hidden", label: "Hid or withdrew an exam", examId: target, title: "" };
    }
    case "portal.deleteExam": return { kind: "deleted", label: "Deleted an exam", examId: target, title: "" };
    case "portal.grade": return { kind: "marked", label: "Marked a script", examId: null, title: "" };
    case "portal.extendAttempt": case "portal.resetAttempt": return { kind: "attempt", label: row.action === "portal.extendAttempt" ? "Gave a student extra time" : "Reset a student's attempt", examId: null, title: "" };
    case "POST /portal/import": return { kind: "pdf", label: "Uploaded a PDF exam paper", examId: null, title: "" };
    case "POST /portal/diagrams": return { kind: "diagram", label: "Added a diagram to a question", examId: null, title: "" };
    case "POST /portal/exam-officer": {
      const id = typeof after.examId === "number" ? after.examId : null;
      if (after.action === "publish") return { kind: "published", label: "Published to students", examId: id, title: "" };
      if (after.action === "return") return { kind: "returned", label: "Returned to the teacher", examId: id, title: "" };
      if (after.action === "withdraw") return { kind: "withdrawn", label: "Withdrew from students", examId: id, title: "" };
      return null;
    }
    case "exam.officer.view": return { kind: "opened", label: "Opened the questions (exam officer)", examId: target, title: "" };
    default: return null;
  }
}

const EXAM_ACTIONS = ["portal.saveExam", "portal.examStatus", "portal.deleteExam", "portal.grade", "portal.extendAttempt", "portal.resetAttempt", "POST /portal/import", "POST /portal/diagrams", "POST /portal/exam-officer", "exam.officer.view"];

/** One exam paper, with answers, its history and who opened its questions. The exam officer's visit is logged too. */
portalExamOfficerRouter.get("/exam-officer/exams/:examId", async (req, res) => {
  officerOnly(req);
  const { examId } = GetExamOfficerExamParams.parse(req.params);
  const [exam] = await db.select().from(portalExams).where(eq(portalExams.id, examId));
  check(exam, "Exam not found.", 404);
  await recordAudit({ actorKind: "staff", actorId: req.dbUser?.id ?? null, actorLabel: req.identity?.email ?? "", action: "exam.officer.view", targetType: "exam", targetId: exam.id });
  const rows = await db.select({ at: portalAuditLog.at, actorLabel: portalAuditLog.actorLabel, action: portalAuditLog.action, targetId: portalAuditLog.targetId, after: portalAuditLog.after }).from(portalAuditLog)
    .where(and(eq(portalAuditLog.outcome, "success"), or(
      and(inArray(portalAuditLog.action, ["portal.saveExam", "portal.examStatus", "exam.officer.view"]), eq(portalAuditLog.targetId, String(exam.id))),
      eq(portalAuditLog.action, `POST /portal/exams/${exam.id}/access`),
      // A new exam has no id until it is saved, so its first save is matched by title and class.
      and(eq(portalAuditLog.action, "portal.saveExam"), isNull(portalAuditLog.targetId), sql`${portalAuditLog.after}->'exam'->>'title' = ${exam.title}`, sql`${portalAuditLog.after}->'exam'->>'classId' = ${String(exam.classId)}`),
      and(eq(portalAuditLog.action, "POST /portal/exam-officer"), sql`${portalAuditLog.after}->>'examId' = ${String(exam.id)}`),
    ))).orderBy(desc(portalAuditLog.at)).limit(300);
  const L = await lookups();
  const [summary] = await summaries([exam]);
  res.json({
    exam: summary, instructions: exam.instructions,
    questions: exam.questions.map((q) => ({ id: q.id, type: q.type, text: q.text, options: q.options ?? [], correctAnswer: q.type === "mcq" ? q.correctAnswer ?? null : null, marks: q.marks, passage: q.passage ?? "", hasDiagram: !!q.diagramFileId })),
    history: rows.flatMap((r) => { const d = describeExamEvent(r); return d ? [{ at: r.at.toISOString(), who: L.who(r.actorLabel), label: d.label, kind: d.kind, examId: exam.id, examTitle: exam.title }] : []; }),
  });
});

/** What each member of staff did with exams between two days, Lagos time (the last seven days by default). */
portalExamOfficerRouter.get("/exam-officer/activity", async (req, res) => {
  officerOnly(req);
  const q = GetExamOfficerActivityQueryParams.parse(req.query);
  const today = lagosToday();
  const to = q.to && lagosDay(q.to) && q.to <= today ? q.to : today;
  const from = q.from && lagosDay(q.from) && q.from <= to ? q.from : lastDays(to, 7)[0];
  check(Date.parse(to) - Date.parse(from) <= 92 * 86_400_000, "Choose at most three months at a time.");
  const rows = await db.select({ at: portalAuditLog.at, actorLabel: portalAuditLog.actorLabel, action: portalAuditLog.action, targetId: portalAuditLog.targetId, after: portalAuditLog.after }).from(portalAuditLog)
    .where(and(gte(portalAuditLog.at, lagosDay(from)!.start), lt(portalAuditLog.at, lagosDay(to)!.end), eq(portalAuditLog.outcome, "success"),
      or(inArray(portalAuditLog.action, EXAM_ACTIONS), like(portalAuditLog.action, "POST /portal/exams/%/access"))))
    .orderBy(desc(portalAuditLog.at)).limit(10000);
  const L = await lookups();
  const ids = [...new Set(rows.map((r) => describeExamEvent(r)?.examId).filter((id): id is number => typeof id === "number"))];
  const titles = new Map(ids.length ? (await db.select({ id: portalExams.id, title: portalExams.title }).from(portalExams).where(inArray(portalExams.id, ids))).map((e) => [e.id, e.title]) : []);
  const staff = new Map<string, { email: string; name: string; role: "teacher" | "exam officer" | "office"; counts: Record<Kind, number>; events: { at: string; who: string; label: string; kind: Kind; examId: number | null; examTitle: string }[] }>();
  const zero = (): Record<Kind, number> => ({ saved: 0, pdf: 0, diagram: 0, submitted: 0, published: 0, returned: 0, withdrawn: 0, hidden: 0, opened: 0, marked: 0, released: 0, deleted: 0, attempt: 0 });
  for (const r of rows) {
    const d = describeExamEvent(r);
    if (!d) continue;
    const email = r.actorLabel.toLowerCase();
    const role = L.byEmail.has(email) ? "teacher" : examOfficerEmails().includes(email) ? "exam officer" : "office";
    const entry = staff.get(email) ?? { email, name: L.byEmail.get(email) ?? (r.actorLabel || "School office"), role, counts: zero(), events: [] };
    entry.counts[d.kind] += 1;
    entry.events.push({ at: r.at.toISOString(), who: entry.name, label: d.label, kind: d.kind, examId: d.examId, examTitle: (d.examId !== null ? titles.get(d.examId) : undefined) ?? d.title });
    staff.set(email, entry);
  }
  res.json({ from, to, today, staff: [...staff.values()].sort((a, b) => b.events.length - a.events.length || a.name.localeCompare(b.name)) });
});

/** Publish, return with a note, or withdraw from students. Each is in the audit log. */
portalExamOfficerRouter.post("/exam-officer", async (req, res) => {
  officerOnly(req);
  const body = ManageExamOfficerBody.parse(req.body);
  const by = isExamOfficer(req) ? req.identity?.email ?? "Exam officer" : `${req.identity?.email ?? "Super administrator"} (super administrator)`;
  const note = (body.note ?? "").trim();
  let message = "Saved.";
  await db.transaction(async (tx) => {
    const [exam] = await tx.select().from(portalExams).where(eq(portalExams.id, body.examId)).for("update");
    check(exam, "Exam not found.", 404);
    const reviewed = { reviewedBy: by, reviewedAt: new Date() };
    if (body.action === "publish") {
      check(!exam.published, "This exam is already published.", 409);
      check(new Date() < exam.endsAt, "This exam's window has already closed. Return it so the teacher can set new dates.", 409);
      validateQuestions(exam.questions, true);
      await tx.update(portalExams).set({ published: true, reviewStatus: "approved", reviewNote: "", ...reviewed }).where(eq(portalExams.id, exam.id));
      message = `"${exam.title}" is published to students.`;
    } else if (body.action === "return") {
      check(note, "Say what the teacher should change.");
      const [attempt] = await tx.select({ id: portalAttempts.id }).from(portalAttempts).where(eq(portalAttempts.examId, exam.id)).limit(1);
      check(!attempt, "Students have started this exam, so it cannot be returned. Withdraw it instead.", 409);
      await tx.update(portalExams).set({ published: false, reviewStatus: "returned", reviewNote: note, ...reviewed }).where(eq(portalExams.id, exam.id));
      message = `"${exam.title}" went back to the teacher.`;
    } else {
      check(exam.published, "This exam is not published.", 409);
      await tx.update(portalExams).set({ published: false, reviewStatus: note ? "returned" : "", reviewNote: note, ...reviewed }).where(eq(portalExams.id, exam.id));
      message = `"${exam.title}" is withdrawn; students no longer see it.`;
    }
  });
  res.json({ message });
});

/** Staff record opening, copying or downloading an exam's questions; the audit log keeps it for the exam officer. */
portalExamOfficerRouter.post("/exams/:examId/access", async (req, res) => {
  const actor = await portalActor(req);
  staffOnly(actor);
  const { examId } = RecordExamAccessParams.parse(req.params);
  RecordExamAccessBody.parse(req.body);
  const [exam] = await db.select({ classId: portalExams.classId }).from(portalExams).where(eq(portalExams.id, examId));
  check(exam, "Exam not found.", 404);
  classAllowed(actor, exam.classId);
  res.json({ message: "Recorded." });
});
