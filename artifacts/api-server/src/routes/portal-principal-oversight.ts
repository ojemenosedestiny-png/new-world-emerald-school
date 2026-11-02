import { Router } from "express";
import { and, desc, eq, gte, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import {
  db, portalAttendance, portalAttempts, portalAuditLog, portalClasses, portalExams, portalPrincipals, portalReportReleases,
  portalReportWorkflow, portalScores, portalStudents, portalSubjects, portalTeacherPresence, portalTerms,
  type PortalExamRecord, type PortalReportWorkflowRecord,
} from "@workspace/db";
import { GetPrincipalDashboardQueryParams, GetPrincipalExamParams, GetPrincipalExamsQueryParams, GetPrincipalResultsQueryParams, ManagePrincipalResultsBody } from "@workspace/api-zod";
import { check } from "../lib/portal-auth";
import { isPrincipal } from "../lib/website-admin";
import { nextStatus, signatureProblem } from "../lib/report-cards";
import { classSection, describeActivity, examTerm, lagosDay, lagosToday, lastDays, type ActivityKind } from "../lib/principal";
import { KINDS, principalOnly, sectionStaff } from "./portal-principal";
import { statusOf, upsertWorkflow, workflowRow } from "./portal-reports";

/** The principals' oversight: an overview of the week, the exams teachers set each term, and signing results. */
export const portalPrincipalOversightRouter = Router();

type Staff = Awaited<ReturnType<typeof sectionStaff>>;

function examStatus(e: PortalExamRecord, now = new Date()) {
  if (!e.published) return "draft" as const;
  if (e.resultsReleased) return "released" as const;
  if (now < e.startsAt) return "scheduled" as const;
  return now <= e.endsAt ? "open" as const : "closed" as const;
}

/** Who set an exam: whoever saved it, or, for exams from before that was recorded, the subject's teacher in that class. */
function setter(e: PortalExamRecord, staff: Staff) {
  const by = e.createdBy.trim().toLowerCase();
  if (by) {
    const t = staff.teachers.find((x) => x.name.toLowerCase() === by || x.email.toLowerCase() === by);
    return { id: t?.id ?? null, name: t?.name ?? e.createdBy };
  }
  const subject = staff.subjects.find((s) => s.classId === e.classId && s.name.trim().toLowerCase() === e.subject.trim().toLowerCase());
  const t = subject?.teacherId ? staff.teachers.find((x) => x.id === subject.teacherId) : undefined;
  return { id: t?.id ?? null, name: t?.name ?? "" };
}

async function activeStudents(classIds: number[]) {
  if (!classIds.length) return new Map<number, number>();
  const rows = await db.select({ classId: portalStudents.classId, n: sql<number>`count(*)::int` }).from(portalStudents)
    .where(and(eq(portalStudents.active, true), inArray(portalStudents.classId, classIds))).groupBy(portalStudents.classId);
  return new Map(rows.map((r) => [r.classId, r.n]));
}

async function examSummaries(exams: PortalExamRecord[], staff: Staff) {
  const ids = exams.map((e) => e.id);
  const attempts = ids.length ? await db.select({ examId: portalAttempts.examId, status: portalAttempts.status, marks: portalAttempts.marks, questions: portalAttempts.questions }).from(portalAttempts).where(inArray(portalAttempts.examId, ids)) : [];
  const students = await activeStudents([...new Set(exams.map((e) => e.classId))]);
  const className = new Map(staff.classes.map((c) => [c.id, c.name]));
  return exams.map((e) => {
    const mine = attempts.filter((a) => a.examId === e.id && a.status !== "in_progress");
    const marked = mine.filter((a) => a.status === "marked");
    const percents = marked.map((a) => {
      const possible = a.questions.reduce((n, q) => n + (q.marks || 0), 0);
      return possible ? (a.marks.reduce((n, m) => n + (m.score || 0), 0) / possible) * 100 : null;
    }).filter((p): p is number => p !== null);
    return {
      id: e.id, title: e.title, subject: e.subject, classId: e.classId, className: className.get(e.classId) ?? "", setBy: setter(e, staff).name,
      startsAt: e.startsAt.toISOString(), endsAt: e.endsAt.toISOString(), durationMinutes: e.durationMinutes, mode: e.mode,
      questionCount: e.questions.length, totalMarks: e.questions.reduce((n, q) => n + (q.marks || 0), 0), status: examStatus(e),
      students: students.get(e.classId) ?? 0, sat: mine.length, marked: marked.length,
      averagePercent: percents.length ? Math.round((percents.reduce((a, b) => a + b, 0) / percents.length) * 10) / 10 : null,
    };
  });
}

/** For one term: each class's results status, and how many scores are in out of students × subjects. */
async function resultProgress(staff: Staff, termId: number | null) {
  const classIds = staff.classes.map((c) => c.id);
  const students = await activeStudents(classIds);
  const out = new Map<number, { row: PortalReportWorkflowRecord | undefined; status: ReturnType<typeof statusOf>; entered: number; expected: number; students: number }>();
  if (!termId || !classIds.length) {
    for (const c of staff.classes) out.set(c.id, { row: undefined, status: "draft", entered: 0, expected: 0, students: students.get(c.id) ?? 0 });
    return out;
  }
  const [rows, releases, entered] = await Promise.all([
    db.select().from(portalReportWorkflow).where(and(eq(portalReportWorkflow.termId, termId), inArray(portalReportWorkflow.classId, classIds))),
    db.select().from(portalReportReleases).where(and(eq(portalReportReleases.termId, termId), inArray(portalReportReleases.classId, classIds))),
    db.select({ classId: portalSubjects.classId, n: sql<number>`count(*)::int` }).from(portalScores).innerJoin(portalSubjects, eq(portalSubjects.id, portalScores.subjectId))
      .where(and(eq(portalScores.termId, termId), inArray(portalSubjects.classId, classIds), or(isNotNull(portalScores.ca), isNotNull(portalScores.ca2), isNotNull(portalScores.exam))))
      .groupBy(portalSubjects.classId),
  ]);
  for (const c of staff.classes) {
    const row = rows.find((r) => r.classId === c.id);
    const n = students.get(c.id) ?? 0;
    const expected = n * staff.subjects.filter((s) => s.classId === c.id).length;
    out.set(c.id, { row, status: statusOf(row, releases.some((r) => r.classId === c.id)), entered: Math.min(entered.find((e) => e.classId === c.id)?.n ?? 0, expected), expected, students: n });
  }
  return out;
}

const termName = (t: { session: string; term: string }) => `${t.term}, ${t.session}`;

/** The week at a glance: who was in, what they did, each class's register today, exams this term and results waiting. */
portalPrincipalOversightRouter.get("/principal/dashboard", async (req, res) => {
  const section = GetPrincipalDashboardQueryParams.parse(req.query).section ?? "secondary";
  principalOnly(req, section);
  const today = lagosToday();
  const days = lastDays(today);
  const from = lagosDay(days[0])!.start, to = lagosDay(today)!.end;
  const staff = await sectionStaff(section);
  const teachers = staff.teachers.filter(staff.inSection);
  const classIds = staff.classes.map((c) => c.id);
  const emails = teachers.map((t) => t.email.toLowerCase());
  const [rows, presence, registers, exams, [term]] = await Promise.all([
    emails.length ? db.select({ at: portalAuditLog.at, actorLabel: portalAuditLog.actorLabel, action: portalAuditLog.action }).from(portalAuditLog)
      .where(and(gte(portalAuditLog.at, from), lt(portalAuditLog.at, to), eq(portalAuditLog.outcome, "success"), inArray(sql`lower(${portalAuditLog.actorLabel})`, emails))).limit(20000) : [] as { at: Date; actorLabel: string; action: string }[],
    teachers.length ? db.select().from(portalTeacherPresence).where(and(inArray(portalTeacherPresence.day, days), inArray(portalTeacherPresence.teacherId, teachers.map((t) => t.id)))) : [] as (typeof portalTeacherPresence.$inferSelect)[],
    classIds.length ? db.selectDistinct({ classId: portalAttendance.classId }).from(portalAttendance).where(and(eq(portalAttendance.date, today), inArray(portalAttendance.classId, classIds))) : [] as { classId: number }[],
    classIds.length ? db.select().from(portalExams).where(inArray(portalExams.classId, classIds)) : [] as PortalExamRecord[],
    db.select().from(portalTerms).orderBy(desc(portalTerms.createdAt), desc(portalTerms.id)).limit(1),
  ]);
  const current = examTerm(new Date());
  const termExams = exams.filter((e) => examTerm(e.startsAt).key === current.key);
  const progress = await resultProgress(staff, term?.id ?? null);
  const className = new Map(staff.classes.map((c) => [c.id, c.name]));
  const week = teachers.map((t) => {
    const actions = rows.filter((r) => r.actorLabel.toLowerCase() === t.email.toLowerCase())
      .map((r) => ({ at: r.at, kind: describeActivity(r.action)?.kind })).filter((a): a is { at: Date; kind: ActivityKind } => !!a.kind);
    const seen = presence.filter((p) => p.teacherId === t.id);
    const activeDays = days.map((d) => seen.some((p) => p.day === d) || actions.some((a) => lagosToday(a.at) === d));
    const times = [...actions.map((a) => a.at.getTime()), ...seen.map((p) => p.lastAt.getTime())];
    return {
      id: t.id, name: t.name, email: t.email, photoFileId: t.photoFileId ?? null,
      classes: t.classIds.map((id) => className.get(id)).filter((n): n is string => !!n),
      activeDays, activeToday: activeDays[activeDays.length - 1], lastSeen: times.length ? new Date(Math.max(...times)).toISOString() : null,
      counts: Object.fromEntries(KINDS.map((k) => [k, actions.filter((a) => a.kind === k).length])) as Record<ActivityKind, number>,
      examsSet: termExams.filter((e) => setter(e, staff).id === t.id).length,
    };
  });
  const registered = new Set(registers.map((r) => r.classId));
  const classes = staff.classes.map((c) => {
    const p = progress.get(c.id)!;
    return {
      id: c.id, name: c.name, students: p.students, classTeachers: teachers.filter((t) => t.classIds.includes(c.id)).map((t) => t.name),
      registerToday: registered.has(c.id), resultStatus: p.status, scoresEntered: p.entered, scoresExpected: p.expected,
      examsThisTerm: termExams.filter((e) => e.classId === c.id).length,
    };
  });
  res.json({
    today, days, examTerm: current.label, resultTerm: term ? termName(term) : null,
    figures: {
      teachers: week.length, activeToday: week.filter((t) => t.activeToday).length, classes: classes.length,
      registersToday: registered.size, examsThisTerm: termExams.length, awaitingSignature: classes.filter((c) => c.resultStatus === "review").length,
    },
    teachers: week, classes,
  });
});

/** Exams set in the section's classes, for one term at a time. */
portalPrincipalOversightRouter.get("/principal/exams", async (req, res) => {
  const query = GetPrincipalExamsQueryParams.parse(req.query);
  const section = query.section ?? "secondary";
  principalOnly(req, section);
  const staff = await sectionStaff(section);
  const classIds = staff.classes.map((c) => c.id);
  const exams = classIds.length ? await db.select().from(portalExams).where(inArray(portalExams.classId, classIds)) : [];
  const byTerm = new Map<string, { key: string; label: string; count: number }>();
  for (const e of exams) {
    const t = examTerm(e.startsAt);
    byTerm.set(t.key, { ...t, count: (byTerm.get(t.key)?.count ?? 0) + 1 });
  }
  const terms = [...byTerm.values()].sort((a, b) => b.key.localeCompare(a.key));
  const now = examTerm(new Date()).key;
  const term = terms.find((t) => t.key === query.term)?.key ?? terms.find((t) => t.key === now)?.key ?? terms[0]?.key ?? null;
  const chosen = exams.filter((e) => examTerm(e.startsAt).key === term).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  res.json({ terms, term, exams: await examSummaries(chosen, staff) });
});

/** One exam paper, questions and answers included, for the principal of that class's section. */
portalPrincipalOversightRouter.get("/principal/exams/:examId", async (req, res) => {
  check(req.dbUser, "Sign in with the principal's email.", 401);
  const { examId } = GetPrincipalExamParams.parse(req.params);
  const [exam] = await db.select().from(portalExams).where(eq(portalExams.id, examId));
  check(exam, "Exam not found.", 404);
  const [cls] = await db.select({ name: portalClasses.name }).from(portalClasses).where(eq(portalClasses.id, exam.classId));
  const section = cls ? classSection(cls.name) : null;
  check(section && isPrincipal(req, section), "This exam is not in one of your classes.", 403);
  const [summary] = await examSummaries([exam], await sectionStaff(section));
  res.json({
    exam: summary, instructions: exam.instructions,
    questions: exam.questions.map((q) => ({
      id: q.id, type: q.type, text: q.text, options: q.options ?? [], correctAnswer: q.type === "mcq" ? q.correctAnswer ?? null : null,
      marks: q.marks, passage: q.passage ?? "", hasDiagram: !!q.diagramFileId,
    })),
  });
});

/** Each class's results for a term, and the principal's saved name and signature. */
portalPrincipalOversightRouter.get("/principal/results", async (req, res) => {
  const query = GetPrincipalResultsQueryParams.parse(req.query);
  const section = query.section ?? "secondary";
  principalOnly(req, section);
  const terms = await db.select().from(portalTerms).orderBy(desc(portalTerms.createdAt), desc(portalTerms.id));
  const termId = terms.find((t) => t.id === query.termId)?.id ?? terms[0]?.id ?? null;
  const staff = await sectionStaff(section);
  const [[own], progress] = await Promise.all([db.select().from(portalPrincipals).where(eq(portalPrincipals.section, section)), resultProgress(staff, termId)]);
  res.json({
    terms: terms.map((t) => ({ id: t.id, label: termName(t) })), termId,
    signature: { name: own?.name ?? "", image: own?.signature ?? null },
    classes: staff.classes.map((c) => {
      const p = progress.get(c.id)!;
      return {
        id: c.id, name: c.name, status: p.status, teacherName: p.row?.teacherName ?? "", submittedAt: p.row?.submittedAt?.toISOString() ?? null,
        approvedBy: p.row?.approvedBy ?? "", approvedAt: p.row?.approvedAt?.toISOString() ?? null, signedByPrincipal: !!p.row?.principalSignature,
        students: p.students, scoresEntered: p.entered, scoresExpected: p.expected, returnNote: p.row?.returnNote ?? "",
      };
    }),
  });
});

/** The principal's signature, and approving (signing), returning, publishing or withholding a class's results. */
portalPrincipalOversightRouter.post("/principal/results", async (req, res) => {
  check(req.dbUser, "Sign in with the principal's email.", 401);
  const body = ManagePrincipalResultsBody.parse(req.body);
  if (body.action === "saveSignature") {
    principalOnly(req, body.section);
    const name = (body.name ?? "").trim();
    check(name, "Type your name as it should appear on report cards.");
    const image = body.signature ?? null;
    const problem = signatureProblem(image);
    check(!problem, problem ?? "");
    const values = { name, signature: image, updatedAt: new Date() };
    await db.insert(portalPrincipals).values({ section: body.section, ...values }).onConflictDoUpdate({ target: portalPrincipals.section, set: values });
    res.json({ message: "Your name and signature are saved." });
    return;
  }
  check(body.termId && body.classId, "Choose a term and a class.");
  const [cls] = await db.select().from(portalClasses).where(eq(portalClasses.id, body.classId));
  check(cls, "Class not found.", 404);
  const section = classSection(cls.name);
  check(section === body.section && isPrincipal(req, section), `${cls.name} is not one of your classes.`, 403);
  const [term] = await db.select({ id: portalTerms.id }).from(portalTerms).where(eq(portalTerms.id, body.termId));
  check(term, "Term not found.", 404);
  const row = await workflowRow(body.termId, cls.id);
  const [release] = await db.select().from(portalReportReleases).where(and(eq(portalReportReleases.termId, body.termId), eq(portalReportReleases.classId, cls.id)));
  const next = nextStatus(statusOf(row, !!release), body.action, "admin");
  check(!("problem" in next), "problem" in next ? next.problem : "");
  let message = "Saved.";
  if (body.action === "approve") {
    const [own] = await db.select().from(portalPrincipals).where(eq(portalPrincipals.section, section));
    check(own?.name && own.signature, "Add your name and signature first (Results, My signature).", 409);
    await upsertWorkflow(body.termId, cls.id, { status: "approved", approvedBy: own.name, approvedAt: new Date(), principalName: own.name, principalSignature: own.signature });
    message = `${cls.name}'s results are approved and signed.`;
  } else if (body.action === "return") {
    await upsertWorkflow(body.termId, cls.id, { status: "draft", returnNote: (body.note ?? "").trim(), approvedAt: null, approvedBy: "", principalName: "", principalSignature: null });
    message = `${cls.name}'s results went back to the class teacher.`;
  } else if (body.action === "publish") {
    await db.insert(portalReportReleases).values({ termId: body.termId, classId: cls.id }).onConflictDoNothing();
    message = `${cls.name}'s report cards are published to students and parents.`;
  } else if (body.action === "unpublish") {
    await db.delete(portalReportReleases).where(and(eq(portalReportReleases.termId, body.termId), eq(portalReportReleases.classId, cls.id)));
    message = `${cls.name}'s report cards are withheld.`;
  }
  res.json({ message });
});
