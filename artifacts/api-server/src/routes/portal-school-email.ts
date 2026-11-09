import { Router, type Request } from "express";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { db, portalClasses, portalStudents, portalTeachers, schoolMessageRecipients, schoolMessages } from "@workspace/db";
import { GetSchoolEmailMessageParams, SendSchoolEmailBody } from "@workspace/api-zod";
import { check } from "../lib/portal-auth";
import { canSendSchoolEmail, isHeadOfSchool } from "../lib/website-admin";
import { dailyLimit, emailProblem, schoolDirectory } from "../lib/school-email";
import { emailConfigured, schoolLetterEmail, sendEmail } from "../lib/email";
import { siteBaseUrl } from "../lib/accounts";
import { logger } from "../lib/logger";

/** Private emails from the Director or the Head of School to teachers and parents, one copy per person. */
export const portalSchoolEmailRouter = Router();

function senderOnly(req: Request) {
  check(req.dbUser, "Sign in first.", 401);
  check(canSendSchoolEmail(req), "Only the Director and the Head of School can email teachers and parents.", 403);
  return { email: req.identity!.email!.trim().toLowerCase(), role: isHeadOfSchool(req) ? "head" as const : "director" as const };
}

async function directory() {
  const [teachers, students, classes] = await Promise.all([
    db.select({ email: portalTeachers.email, name: portalTeachers.name, active: portalTeachers.active, classIds: portalTeachers.classIds }).from(portalTeachers).orderBy(asc(portalTeachers.name)),
    db.select({ name: portalStudents.name, studentId: portalStudents.studentId, classId: portalStudents.classId, active: portalStudents.active, guardianEmail: portalStudents.guardianEmail, secondGuardianEmail: portalStudents.secondGuardianEmail }).from(portalStudents).orderBy(asc(portalStudents.name)),
    db.select({ id: portalClasses.id, name: portalClasses.name }).from(portalClasses).orderBy(asc(portalClasses.name)),
  ]);
  return { people: schoolDirectory(teachers, students, new Map(classes.map((c) => [c.id, c.name]))), classes };
}

async function sentToday() {
  const [row] = await db.select({ n: sql<number>`coalesce(sum(${schoolMessages.recipients}), 0)::int` }).from(schoolMessages).where(gte(schoolMessages.createdAt, new Date(Date.now() - 86_400_000)));
  return row?.n ?? 0;
}

const messageView = (m: typeof schoolMessages.$inferSelect) => ({
  id: m.id, subject: m.subject, body: m.body, senderName: m.senderName, senderEmail: m.senderEmail, senderRole: m.senderRole as "director" | "head",
  recipients: m.recipients, sent: m.sent, failed: m.failed, status: m.status as "sending" | "done", createdAt: m.createdAt.toISOString(), finishedAt: m.finishedAt?.toISOString() ?? null,
});

/** Everyone who can be emailed, the classes (to pick a class's parents), today's allowance and the sent history. */
portalSchoolEmailRouter.get("/school-email", async (req, res) => {
  const me = senderOnly(req);
  const [{ people, classes }, today, history] = await Promise.all([directory(), sentToday(), db.select().from(schoolMessages).orderBy(desc(schoolMessages.createdAt)).limit(100)]);
  res.json({
    sender: { email: me.email, role: me.role, name: senderName(req, me.role) }, emailReady: emailConfigured(), dailyLimit: dailyLimit(), sentToday: today,
    people: people.map(({ kind, email, name, detail, classIds }) => ({ kind, email, name, detail, classIds })), classes, history: history.map(messageView),
  });
});

/** One email: who it went to and whether each copy was delivered. */
portalSchoolEmailRouter.get("/school-email/:messageId", async (req, res) => {
  senderOnly(req);
  const { messageId } = GetSchoolEmailMessageParams.parse(req.params);
  const [message] = await db.select().from(schoolMessages).where(eq(schoolMessages.id, messageId));
  check(message, "Email not found.", 404);
  const recipients = await db.select().from(schoolMessageRecipients).where(eq(schoolMessageRecipients.messageId, message.id)).orderBy(asc(schoolMessageRecipients.kind), asc(schoolMessageRecipients.name));
  res.json({ message: messageView(message), recipients: recipients.map((r) => ({ kind: r.kind as "teacher" | "parent", email: r.email, name: r.name, status: r.status as "pending" | "sent" | "failed", detail: r.detail, sentAt: r.sentAt?.toISOString() ?? null })) });
});

function senderName(req: Request, role: "director" | "head") {
  const full = [req.dbUser?.firstName, req.dbUser?.lastName].filter(Boolean).join(" ").trim();
  return full || (role === "director" ? "The Director" : "The Head of School");
}

/** Queue one private copy per chosen teacher or parent; they go out in the background, paced for the email service. */
portalSchoolEmailRouter.post("/school-email", async (req, res) => {
  const me = senderOnly(req);
  const body = SendSchoolEmailBody.parse(req.body);
  check(emailConfigured(), "Email is not set up yet (RESEND_API_KEY and EMAIL_FROM).", 503);
  const { people } = await directory();
  const byKey = new Map(people.map((p) => [`${p.kind}:${p.email}`, p]));
  const chosen = [...new Map(body.recipients.map((r) => [`${r.kind}:${r.email.trim().toLowerCase()}`, r])).keys()].map((k) => byKey.get(k));
  check(chosen.every(Boolean), "Some of the people chosen are no longer teachers or parents of current students. Refresh the page and choose again.");
  const problem = emailProblem(body.subject, body.message, chosen.length, await sentToday(), dailyLimit());
  check(!problem, problem ?? "", problem?.includes("a day") ? 429 : 400);
  const name = senderName(req, me.role);
  const id = await db.transaction(async (tx) => {
    const [m] = await tx.insert(schoolMessages).values({ senderEmail: me.email, senderName: name, senderRole: me.role, subject: body.subject.trim(), body: body.message.trim(), recipients: chosen.length }).returning();
    await tx.insert(schoolMessageRecipients).values(chosen.map((p) => ({ messageId: m.id, kind: p!.kind, email: p!.email, name: p!.name, greeting: p!.greeting })));
    return m.id;
  });
  void sendPendingSchoolEmails();
  const [message] = await db.select().from(schoolMessages).where(eq(schoolMessages.id, id));
  res.json(messageView(message));
});

// Tests replace the email service.
let deliver: typeof sendEmail = sendEmail;
export function setSchoolEmailSenderForTest(fn: typeof sendEmail) { deliver = fn; }

let running = false;
/**
 * Sends every waiting copy, oldest first, one at a time and paced for the email service. Runs after each new email
 * and when the server starts, so copies waiting when the server restarted still go out.
 */
export async function sendPendingSchoolEmails(pause = 550) {
  if (running) return;
  running = true;
  try {
    const site = siteBaseUrl() ?? "https://newworldemeraldprivateschool.com";
    for (;;) {
      const [next] = await db.select({ r: schoolMessageRecipients, m: schoolMessages }).from(schoolMessageRecipients)
        .innerJoin(schoolMessages, eq(schoolMessages.id, schoolMessageRecipients.messageId))
        .where(eq(schoolMessageRecipients.status, "pending")).orderBy(asc(schoolMessageRecipients.id)).limit(1);
      if (!next) break;
      const { r, m } = next;
      const mail = schoolLetterEmail({ subject: m.subject, message: m.body, greeting: r.greeting, senderName: m.senderName, senderTitle: m.senderRole === "director" ? "Director" : "Head of School", kind: r.kind as "teacher" | "parent", siteUrl: site });
      const result = await deliver({ to: r.email, replyTo: m.senderEmail, ...mail });
      await db.update(schoolMessageRecipients).set({ status: result.sent ? "sent" : "failed", detail: result.sent ? "" : (result.detail ?? result.reason ?? "Not delivered"), sentAt: new Date() }).where(eq(schoolMessageRecipients.id, r.id));
      await db.update(schoolMessages).set(result.sent ? { sent: sql`${schoolMessages.sent} + 1` } : { failed: sql`${schoolMessages.failed} + 1` }).where(eq(schoolMessages.id, m.id));
      const [left] = await db.select({ n: sql<number>`count(*)::int` }).from(schoolMessageRecipients).where(and(eq(schoolMessageRecipients.messageId, m.id), eq(schoolMessageRecipients.status, "pending")));
      if (!left?.n) await db.update(schoolMessages).set({ status: "done", finishedAt: new Date() }).where(eq(schoolMessages.id, m.id));
      if (pause) await new Promise((resolve) => setTimeout(resolve, pause));
    }
  } catch (error) {
    logger.error({ err: error }, "School emails could not be sent");
  } finally {
    running = false;
  }
}
