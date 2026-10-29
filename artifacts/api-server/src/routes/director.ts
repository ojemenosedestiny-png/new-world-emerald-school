import { Router, type Request, type Response } from "express";
import { and, asc, count, eq, gte, inArray, lte, sql, sum } from "drizzle-orm";
import {
  admissionApplicationsTable, db, directorBroadcasts, directorReports, feePaymentReportsTable, liveUpdatesTable, portalAssignments, portalAttempts,
  portalAttendance, portalAuditLog, portalClasses, portalExams, portalLoginEvents, portalMessages, portalStudents, portalSubmissions,
  portalTeachers, storeOrdersTable,
} from "@workspace/db";
import { approvedEmails, directorEmails } from "../lib/approved-identities";
import { SendDirectorBroadcastBody } from "@workspace/api-zod";
import { BROADCASTS_PER_DAY, MAX_RECIPIENTS, broadcastProblem, broadcastRecipients, type Audience } from "../lib/director-broadcast";
import { isDirector } from "../lib/website-admin";
import { siteBaseUrl } from "../lib/accounts";
import { directorReportEmail, emailConfigured, sendEmail, staffBroadcastEmail } from "../lib/email";
import { REPORT_PERIODS, highlights, mondayOf, percent, reportWindow, weeklyReportDue, type DirectorReport } from "../lib/director";
import { schoolDate } from "../lib/learning";
import { logger } from "../lib/logger";

const router = Router();
const AWAITING_PAYMENT = ["payment_requested", "reported"];
const n = (v: unknown) => Number(v ?? 0);

/** Everything the Director sees, for the seven days up to `now`. Read-only. */
export async function buildDirectorReport(now = new Date(), days = 7): Promise<DirectorReport> {
  const { from, to, fromDate, toDate } = reportWindow(now, days);
  const classes = await db.select().from(portalClasses).orderBy(asc(portalClasses.name));
  const className = new Map(classes.map((c) => [c.id, c.name]));

  const [[appsNew], [appsWaiting], [appsTotal]] = await Promise.all([
    db.select({ c: count() }).from(admissionApplicationsTable).where(gte(admissionApplicationsTable.submittedAt, from)),
    db.select({ c: count() }).from(admissionApplicationsTable).where(eq(admissionApplicationsTable.status, "new")),
    db.select({ c: count() }).from(admissionApplicationsTable),
  ]);

  const activeByClass = await db.select({ classId: portalStudents.classId, c: count() }).from(portalStudents)
    .where(eq(portalStudents.active, true)).groupBy(portalStudents.classId);
  const [[pending], [activated], [teachers]] = await Promise.all([
    db.select({ c: count() }).from(portalStudents).where(and(eq(portalStudents.active, true), eq(portalStudents.accountStatus, "pending"))),
    db.select({ c: count() }).from(portalStudents).where(gte(portalStudents.activatedAt, from)),
    db.select({ c: count() }).from(portalTeachers).where(eq(portalTeachers.active, true)),
  ]);

  const register = await db.select({ classId: portalAttendance.classId, status: portalAttendance.status, c: count() }).from(portalAttendance)
    .where(and(gte(portalAttendance.date, fromDate), lte(portalAttendance.date, toDate)))
    .groupBy(portalAttendance.classId, portalAttendance.status);
  const [absentToday] = await db.select({ c: count() }).from(portalAttendance)
    .where(and(eq(portalAttendance.date, schoolDate(now)), eq(portalAttendance.status, "absent")));
  const present = (rows: typeof register) => rows.filter((r) => r.status === "present" || r.status === "late").reduce((s, r) => s + n(r.c), 0);
  const total = (rows: typeof register) => rows.reduce((s, r) => s + n(r.c), 0);

  const [[examsHeld], attempts, [assignmentsSet], [submissions]] = await Promise.all([
    db.select({ c: count() }).from(portalExams).where(and(gte(portalExams.startsAt, from), lte(portalExams.startsAt, to))),
    db.select({ status: portalAttempts.status, questions: portalAttempts.questions, marks: portalAttempts.marks }).from(portalAttempts)
      .where(and(gte(portalAttempts.savedAt, from), sql`${portalAttempts.status} <> 'in_progress'`)),
    db.select({ c: count() }).from(portalAssignments).where(gte(portalAssignments.createdAt, from)),
    db.select({ c: count() }).from(portalSubmissions).where(gte(portalSubmissions.submittedAt, from)),
  ]);
  const marked = attempts.filter((a) => a.status === "marked");
  const scored = marked.reduce((s, a) => s + a.marks.reduce((t, m) => t + m.score, 0), 0);
  const possible = marked.reduce((s, a) => s + a.questions.reduce((t, q) => t + q.marks, 0), 0);

  const [[confirmed], [awaiting], [orders]] = await Promise.all([
    db.select({ c: count(), k: sum(feePaymentReportsTable.amountKobo) }).from(feePaymentReportsTable)
      .where(and(eq(feePaymentReportsTable.status, "confirmed"), gte(feePaymentReportsTable.updatedAt, from))),
    db.select({ c: count(), k: sum(feePaymentReportsTable.amountKobo) }).from(feePaymentReportsTable).where(inArray(feePaymentReportsTable.status, AWAITING_PAYMENT)),
    db.select({ c: count(), k: sum(storeOrdersTable.totalKobo) }).from(storeOrdersTable).where(gte(storeOrdersTable.createdAt, from)),
  ]);

  const [[messages], unansweredRows, [updates], [failed], [denied]] = await Promise.all([
    db.select({ c: count() }).from(portalMessages).where(gte(portalMessages.createdAt, from)),
    // Conversations whose latest message came from the student.
    db.execute(sql`select count(*)::int as c from (select distinct on (student_id, channel) from_staff from portal_messages order by student_id, channel, created_at desc, id desc) last where from_staff = false`),
    db.select({ c: count() }).from(liveUpdatesTable).where(gte(liveUpdatesTable.publishedAt, from)),
    db.select({ c: count() }).from(portalLoginEvents).where(and(gte(portalLoginEvents.at, from), eq(portalLoginEvents.success, false))),
    db.select({ c: count() }).from(portalAuditLog).where(and(gte(portalAuditLog.at, from), eq(portalAuditLog.outcome, "denied"))),
  ]);
  const unanswered = n((unansweredRows as unknown as { rows: { c: number }[] }).rows?.[0]?.c);

  const report: Omit<DirectorReport, "highlights"> = {
    days, from: from.toISOString(), to: to.toISOString(), generatedAt: new Date().toISOString(),
    admissions: { newThisWeek: n(appsNew.c), awaitingReview: n(appsWaiting.c), total: n(appsTotal.c) },
    students: {
      active: activeByClass.reduce((s, r) => s + n(r.c), 0), pendingActivation: n(pending.c), activatedThisWeek: n(activated.c),
      byClass: classes.map((c) => ({ className: c.name, students: n(activeByClass.find((r) => r.classId === c.id)?.c) })),
    },
    staff: { activeTeachers: n(teachers.c) },
    attendance: {
      rate: percent(present(register), total(register)), recorded: total(register), absentToday: n(absentToday.c),
      byClass: classes.map((c) => {
        const rows = register.filter((r) => r.classId === c.id);
        return { className: className.get(c.id) ?? c.name, rate: percent(present(rows), total(rows)), recorded: total(rows) };
      }),
    },
    learning: { examsHeld: n(examsHeld.c), attemptsSubmitted: attempts.length, averageScore: percent(scored, possible), assignmentsSet: n(assignmentsSet.c), submissions: n(submissions.c) },
    money: {
      confirmedKobo: n(confirmed.k), confirmedCount: n(confirmed.c), awaitingKobo: n(awaiting.k), awaitingCount: n(awaiting.c),
      storeOrders: n(orders.c), storeOrdersKobo: n(orders.k),
    },
    messages: { thisWeek: n(messages.c), unanswered },
    website: { liveUpdates: n(updates.c) },
    security: { failedSignIns: n(failed.c), deniedActions: n(denied.c) },
  };
  return { ...report, highlights: highlights(report) };
}

function directorOnly(req: Request, res: Response) {
  if (isDirector(req)) return true;
  res.status(403).json({ error: "This page is for the Director only." });
  return false;
}

router.get("/director/overview", async (req, res) => {
  if (!directorOnly(req, res)) return;
  res.setHeader("Cache-Control", "no-store");
  const days = Number(req.query.days ?? 7);
  res.json(await buildDirectorReport(new Date(), (REPORT_PERIODS as readonly number[]).includes(days) ? days : 7));
});

router.post("/director/report/send", async (req, res) => {
  if (!directorOnly(req, res)) return;
  if (!emailConfigured()) { res.status(503).json({ error: "Email is not set up yet (RESEND_API_KEY and EMAIL_FROM)." }); return; }
  const to = req.identity!.email!.trim().toLowerCase();
  const result = await sendEmail({ to, ...directorReportEmail(await buildDirectorReport(), `${siteBaseUrl() ?? ""}/director`) });
  if (!result.sent) { res.status(502).json({ error: "The report email could not be sent. Please try again later." }); return; }
  res.json({ message: `Report emailed to ${to}.` });
});

/**
 * Sends the Monday report once per week to the Director(s). The database row for the week is claimed
 * first, so two servers (or a restart) never send it twice. Missed while asleep? It goes out on wake-up.
 */
export async function sendWeeklyDirectorReport(now = new Date()) {
  const recipients = directorEmails();
  if (!weeklyReportDue(now) || !recipients.length || !emailConfigured()) return false;
  const weekStart = mondayOf(now);
  const claimed = await db.insert(directorReports).values({ weekStart, recipients: recipients.join(",") }).onConflictDoNothing().returning();
  if (!claimed.length) return false;
  const mail = directorReportEmail(await buildDirectorReport(now), `${siteBaseUrl() ?? ""}/director`);
  for (const to of recipients) {
    const result = await sendEmail({ to, ...mail });
    if (!result.sent) logger.warn({ reason: result.reason }, "Weekly director report not sent");
  }
  return true;
}

export function startDirectorWeeklyReport() {
  const tick = () => void sendWeeklyDirectorReport().catch((err) => logger.warn({ err }, "Weekly director report failed"));
  setTimeout(tick, 60_000).unref();
  setInterval(tick, 30 * 60_000).unref();
}

// ---- Emails from the Director to staff (teachers and administrators only)
async function recipientsFor(audience: Audience) {
  const teachers = await db.select({ email: portalTeachers.email, active: portalTeachers.active }).from(portalTeachers);
  return broadcastRecipients(audience, teachers, approvedEmails());
}
const broadcastView = (b: typeof directorBroadcasts.$inferSelect) => ({
  id: b.id, audience: b.audience as Audience, subject: b.subject, message: b.message, recipients: b.recipients, sent: b.sent, failed: b.failed, sentBy: b.sentBy, createdAt: b.createdAt.toISOString(),
});

router.get("/director/broadcasts", async (req, res) => {
  if (!directorOnly(req, res)) return;
  const [teachers, admins, all] = await Promise.all([recipientsFor("teachers"), recipientsFor("admins"), recipientsFor("all")]);
  const history = await db.select().from(directorBroadcasts).orderBy(sql`${directorBroadcasts.createdAt} desc`).limit(50);
  res.json({ counts: { teachers: teachers.length, admins: admins.length, all: all.length }, emailReady: emailConfigured(), history: history.map(broadcastView) });
});

router.post("/director/broadcasts", async (req, res) => {
  if (!directorOnly(req, res)) return;
  const parsed = SendDirectorBroadcastBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose who to email, and add a subject and a message." }); return; }
  const { audience, subject, message } = parsed.data;
  const problem = broadcastProblem(subject, message);
  if (problem) { res.status(400).json({ error: problem }); return; }
  if (!emailConfigured()) { res.status(503).json({ error: "Email is not set up yet (RESEND_API_KEY and EMAIL_FROM)." }); return; }
  const [{ c: today }] = await db.select({ c: count() }).from(directorBroadcasts).where(gte(directorBroadcasts.createdAt, new Date(Date.now() - 86_400_000)));
  if (Number(today) >= BROADCASTS_PER_DAY) { res.status(429).json({ error: `You can send up to ${BROADCASTS_PER_DAY} staff emails a day. Please try again tomorrow.` }); return; }
  const to = await recipientsFor(audience);
  if (!to.length) { res.status(400).json({ error: "There is nobody to email in that group yet." }); return; }
  if (to.length > MAX_RECIPIENTS) { res.status(400).json({ error: `That group has more than ${MAX_RECIPIENTS} people. Please contact support.` }); return; }
  const email = staffBroadcastEmail({ subject: subject.trim(), message, senderName: req.dbUser?.firstName ? `${req.dbUser.firstName} ${req.dbUser.lastName ?? ""}`.trim() : "The Director", portalUrl: `${siteBaseUrl() ?? ""}/portal/manage` });
  let sent = 0;
  // One copy per person, so nobody sees anyone else's address; paced for the email provider's limit.
  for (const address of to) {
    const result = await sendEmail({ to: address, ...email });
    if (result.sent) sent++;
    else logger.warn({ reason: result.reason }, "Director staff email not delivered");
    await new Promise((resolve) => setTimeout(resolve, 550));
  }
  const [row] = await db.insert(directorBroadcasts).values({ audience, subject: subject.trim(), message, recipients: to.length, sent, failed: to.length - sent, sentBy: req.identity?.email ?? "" }).returning();
  res.json(broadcastView(row));
});

export default router;
