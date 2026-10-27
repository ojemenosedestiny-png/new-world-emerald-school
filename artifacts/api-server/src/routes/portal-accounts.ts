import { Router, type Request } from "express";
import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, portalAccountTokens, portalClasses, portalIdSequences, portalSessions, portalStudents, type PortalStudentRecord } from "@workspace/db";
import { CheckAccountTokenBody, CompleteAccountTokenBody, CreateAccountLinkBody, EnrolStudentBody, RequestPasswordResetBody } from "@workspace/api-zod";
import { check, hashPassword, hashToken, portalActor, setPortalCookie } from "../lib/portal-auth";
import {
  ACTIVATION_HOURS, RESET_HOURS, accountLink, formatStudentId, hashAccountToken, newAccountToken, passwordProblem, siteBaseUrl, validEmail, validTokenShape,
} from "../lib/accounts";
import { accountReadyEmail, activationEmail, emailConfigured, passwordChangedEmail, resetEmail, sendEmail } from "../lib/email";
import { clientIp, recordAudit } from "../lib/audit";

export const portalAccountsRouter = Router();
const STUDENT_ID = /^[A-Z0-9][A-Z0-9/_-]{0,49}$/;
const INVALID_LINK = "This link is invalid, already used or expired. Ask the school office for a new one.";

async function adminOnly(req: Request) {
  const actor = await portalActor(req);
  check(actor.role === "admin", actor.role === "guest" ? "Sign in as an administrator." : "Only school administrators can manage student accounts.", actor.role === "guest" ? 401 : 403);
}

/** Next automatic Student ID for this year, skipping any number already used by hand. */
export async function nextStudentId(year: number) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const [row] = await db.insert(portalIdSequences).values({ year, last: 1 })
      .onConflictDoUpdate({ target: portalIdSequences.year, set: { last: sql`${portalIdSequences.last} + 1` } }).returning();
    const candidate = formatStudentId(year, row.last);
    const [taken] = await db.select({ id: portalStudents.id }).from(portalStudents).where(eq(portalStudents.studentId, candidate));
    if (!taken) return candidate;
  }
  throw new Error("Could not allocate a Student ID");
}

/** Issues a one-time link, replacing earlier unused links of the same purpose. */
async function issueToken(studentId: number, purpose: "activate" | "reset", createdBy: string | null) {
  const { token, hash } = newAccountToken();
  const expiresAt = new Date(Date.now() + (purpose === "activate" ? ACTIVATION_HOURS : RESET_HOURS) * 3_600_000);
  await db.transaction(async (tx) => {
    await tx.delete(portalAccountTokens).where(and(eq(portalAccountTokens.studentId, studentId), eq(portalAccountTokens.purpose, purpose), isNull(portalAccountTokens.usedAt)));
    await tx.insert(portalAccountTokens).values({ studentId, tokenHash: hash, purpose, expiresAt, createdBy });
  });
  return { token, expiresAt };
}

/** Builds the link and, when asked and possible, emails it to the parent. */
async function deliver(req: Request, student: PortalStudentRecord, className: string, purpose: "activate" | "reset", token: string, send: boolean) {
  const trusted = siteBaseUrl();
  // Staff see a working link even before the public address is configured; emails need the trusted one.
  const displayBase = trusted ?? `${req.headers["x-forwarded-proto"] === "https" || req.secure ? "https" : "http"}://${req.headers.host}`;
  const url = accountLink(displayBase, token);
  let emailed = false;
  let emailNote = "Not emailed. Share the link with the family.";
  if (!send) emailNote = "Not emailed (as requested).";
  else if (!student.guardianEmail) emailNote = "Not emailed: no parent email on file. Share the link by WhatsApp or print it.";
  else if (!emailConfigured()) emailNote = "Not emailed: email is not set up yet (RESEND_API_KEY and EMAIL_FROM).";
  else if (!trusted) emailNote = "Not emailed: the site address is not configured (PUBLIC_SITE_URL).";
  else {
    const hours = purpose === "activate" ? ACTIVATION_HOURS : RESET_HOURS;
    const mail = purpose === "activate"
      ? activationEmail({ studentName: student.name, studentId: student.studentId, className, url, hours })
      : resetEmail({ studentName: student.name, studentId: student.studentId, url, hours });
    const result = await sendEmail({ to: student.guardianEmail, ...mail });
    emailed = result.sent;
    emailNote = result.sent ? `Emailed to ${student.guardianEmail}.` : `Not emailed: ${result.detail ?? result.reason}. Share the link instead.`;
    if (!result.sent) req.log.warn({ reason: result.reason, detail: result.detail }, "Account email not sent");
  }
  return { url, emailed, emailNote };
}

async function className(classId: number) {
  const [c] = await db.select({ name: portalClasses.name }).from(portalClasses).where(eq(portalClasses.id, classId));
  return c?.name ?? "";
}
const view = (s: PortalStudentRecord, cls: string) => ({ id: s.id, studentId: s.studentId, name: s.name, className: cls, guardianEmail: s.guardianEmail });

portalAccountsRouter.post("/accounts/enrol", async (req, res) => {
  await adminOnly(req);
  const body = EnrolStudentBody.parse(req.body);
  const name = body.name.trim().replace(/\s+/g, " ");
  check(name, "Student name required.");
  const cls = await className(body.classId);
  check(cls, "Class not found.", 404);
  const guardianEmail = body.guardianEmail?.trim().toLowerCase() || null;
  check(!guardianEmail || validEmail(guardianEmail), "Enter a valid parent email, or leave it empty.");
  let studentId: string;
  if (body.studentId?.trim()) {
    studentId = body.studentId.trim().toUpperCase();
    check(STUDENT_ID.test(studentId), "Use letters, numbers, hyphens, slashes or underscores for student IDs.");
    const [taken] = await db.select({ id: portalStudents.id }).from(portalStudents).where(eq(portalStudents.studentId, studentId));
    check(!taken, "That Student ID is already in use.", 409);
  } else studentId = await nextStudentId(new Date().getFullYear());
  // The account cannot be signed into until the family chooses a password through the link.
  const [student] = await db.insert(portalStudents).values({
    studentId, name, classId: body.classId, guardianEmail, accountStatus: "pending", mustChangePassword: false,
    passwordHash: await hashPassword(randomBytes(32).toString("hex")),
  }).returning();
  const { token, expiresAt } = await issueToken(student.id, "activate", req.dbUser?.id ?? null);
  const delivery = await deliver(req, student, cls, "activate", token, body.send !== false);
  res.json({ student: view(student, cls), expiresAt: expiresAt.toISOString(), ...delivery });
});

portalAccountsRouter.post("/accounts/:id/link", async (req, res) => {
  await adminOnly(req);
  const id = Number(req.params.id);
  check(Number.isSafeInteger(id) && id > 0, "Invalid student.");
  const body = CreateAccountLinkBody.parse(req.body);
  const [student] = await db.select().from(portalStudents).where(eq(portalStudents.id, id));
  check(student, "Student not found.", 404);
  check(student.active, "This student is deactivated. Reactivate them first.", 409);
  if (body.purpose === "activate") check(student.accountStatus === "pending", "This account is already active. Send a password reset link instead.", 409);
  else check(student.accountStatus === "active", "This account has not been activated yet. Send an activation link instead.", 409);
  const cls = await className(student.classId);
  const { token, expiresAt } = await issueToken(student.id, body.purpose, req.dbUser?.id ?? null);
  const delivery = await deliver(req, student, cls, body.purpose, token, body.send !== false);
  res.json({ student: view(student, cls), expiresAt: expiresAt.toISOString(), ...delivery });
});

/** Looks up a live link and its student. */
async function liveToken(token: unknown) {
  check(validTokenShape(token), INVALID_LINK, 410);
  const [row] = await db.select({ t: portalAccountTokens, s: portalStudents }).from(portalAccountTokens)
    .innerJoin(portalStudents, eq(portalStudents.id, portalAccountTokens.studentId))
    .where(eq(portalAccountTokens.tokenHash, hashAccountToken(token)));
  check(row && !row.t.usedAt && row.t.expiresAt.getTime() > Date.now() && row.s.active, INVALID_LINK, 410);
  check(row.t.purpose === "reset" || row.s.accountStatus === "pending", INVALID_LINK, 410);
  return row;
}

/** Confirms a finished activation or reset by email. Never blocks the student: failures are only logged. */
async function confirmByEmail(req: Request, student: PortalStudentRecord, purpose: string) {
  const base = siteBaseUrl();
  if (!student.guardianEmail || !emailConfigured() || !base) return;
  const signInUrl = `${base}/portal`;
  const mail = purpose === "activate"
    ? accountReadyEmail({ studentName: student.name, studentId: student.studentId, className: await className(student.classId), signInUrl })
    : passwordChangedEmail({ studentName: student.name, studentId: student.studentId, signInUrl });
  try {
    const result = await sendEmail({ to: student.guardianEmail, ...mail });
    if (!result.sent) req.log.warn({ reason: result.reason, detail: result.detail }, "Account confirmation email not sent");
  } catch (error) {
    req.log.warn({ err: error }, "Account confirmation email not sent");
  }
}

portalAccountsRouter.post("/accounts/token/check", async (req, res) => {
  const { token } = CheckAccountTokenBody.parse(req.body);
  const { t, s } = await liveToken(token);
  res.json({ purpose: t.purpose, studentName: s.name, studentId: s.studentId, className: await className(s.classId), expiresAt: t.expiresAt.toISOString() });
});

portalAccountsRouter.post("/accounts/token/complete", async (req, res) => {
  const body = CompleteAccountTokenBody.parse(req.body);
  const problem = passwordProblem(body.password);
  check(!problem, problem ?? "", 400);
  const { t } = await liveToken(body.token);
  const session = randomBytes(32).toString("hex");
  const student = await db.transaction(async (tx) => {
    // Lock the link so two submissions cannot both use it.
    const [locked] = await tx.select().from(portalAccountTokens).where(and(eq(portalAccountTokens.id, t.id), isNull(portalAccountTokens.usedAt))).for("update");
    check(locked, INVALID_LINK, 410);
    await tx.update(portalAccountTokens).set({ usedAt: new Date() }).where(eq(portalAccountTokens.id, t.id));
    await tx.delete(portalAccountTokens).where(and(eq(portalAccountTokens.studentId, t.studentId), isNull(portalAccountTokens.usedAt)));
    const [updated] = await tx.update(portalStudents).set({
      passwordHash: await hashPassword(body.password), accountStatus: "active", mustChangePassword: false, failedLogins: 0, lockedUntil: null,
      activatedAt: sql`coalesce(${portalStudents.activatedAt}, now())`,
    }).where(eq(portalStudents.id, t.studentId)).returning();
    // A new password signs out every other device.
    await tx.delete(portalSessions).where(eq(portalSessions.studentId, t.studentId));
    await tx.insert(portalSessions).values({ tokenHash: hashToken(session), studentId: t.studentId, expiresAt: new Date(Date.now() + 12 * 3_600_000), ip: clientIp(req), userAgent: (req.headers["user-agent"] ?? "").slice(0, 300) || null });
    return updated;
  });
  setPortalCookie(req, res, session);
  await recordAudit({ actorKind: "student", actorId: String(student.id), actorLabel: student.studentId, action: t.purpose === "activate" ? "student.account_activated" : "student.password_reset", ip: clientIp(req), userAgent: req.headers["user-agent"] ?? null });
  await confirmByEmail(req, student, t.purpose);
  res.json({ role: "student", name: student.name, studentId: student.studentId, classId: student.classId, classIds: [student.classId], mustChangePassword: false });
});

const forgotLimits = new Map<string, { count: number; until: number }>();
const FORGOT_REPLY = "If that Student ID has a parent email on file, a password reset link has been sent to it. If nothing arrives, please contact the school office.";
portalAccountsRouter.post("/accounts/forgot", async (req, res) => {
  const body = RequestPasswordResetBody.parse(req.body);
  const studentId = body.studentId.trim().toUpperCase();
  const key = (req.ip || "unknown") + "|" + studentId;
  const now = Date.now();
  const limit = forgotLimits.get(key);
  if (limit && limit.until > now && limit.count >= 3) { res.json({ message: FORGOT_REPLY }); return; }
  if (forgotLimits.size > 10000) forgotLimits.clear();
  forgotLimits.set(key, limit && limit.until > now ? { ...limit, count: limit.count + 1 } : { count: 1, until: now + 60 * 60_000 });
  // Reply identically and immediately; the lookup and email continue in the background.
  res.json({ message: FORGOT_REPLY });
  void (async () => {
    try {
      const [student] = await db.select().from(portalStudents).where(eq(portalStudents.studentId, studentId));
      const ok = student && student.active && student.accountStatus === "active" && student.guardianEmail && siteBaseUrl() && emailConfigured();
      await recordAudit({ actorKind: "student", actorId: student ? String(student.id) : null, actorLabel: studentId, action: "student.reset_requested", outcome: ok ? "success" : "failed", ip: clientIp(req), userAgent: req.headers["user-agent"] ?? null });
      if (!ok) return;
      const { token } = await issueToken(student.id, "reset", null);
      await deliver(req, student, await className(student.classId), "reset", token, true);
    } catch (error) {
      req.log.error({ err: error }, "Password reset request failed");
    }
  })();
});
