import { Router } from "express";
import { and, count, desc, eq, gt, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import { db, portalAuditLog, portalClasses, portalLoginEvents, portalSessions, portalStudents, portalTeachers } from "@workspace/db";
import { GetAuditLogQueryParams, RevokeSessionsBody } from "@workspace/api-zod";
import { check, portalActor } from "../lib/portal-auth";
import { isSuperAdmin } from "../lib/website-admin";
import { approvedEmails } from "../lib/approved-identities";
import { clientIp, recordAudit } from "../lib/audit";

export const portalSecurityRouter = Router();

async function adminOnly(req: import("express").Request) {
  const actor = await portalActor(req);
  check(actor.role === "admin", actor.role === "guest" ? "Sign in as an administrator." : "Administrators only.", actor.role === "guest" ? 401 : 403);
  return actor;
}

portalSecurityRouter.get("/security/audit", async (req, res) => {
  await adminOnly(req);
  check(isSuperAdmin(req), "Only the super administrator can view the audit log.", 403);
  const q = GetAuditLogQueryParams.parse(req.query);
  const page = q.page ?? 1, pageSize = q.pageSize ?? 50;
  const filters: SQL[] = [];
  if (q.actorKind) filters.push(eq(portalAuditLog.actorKind, q.actorKind));
  if (q.outcome) filters.push(eq(portalAuditLog.outcome, q.outcome));
  const from = q.from ? new Date(q.from) : null, to = q.to ? new Date(q.to) : null;
  if (from && !Number.isNaN(from.getTime())) filters.push(gte(portalAuditLog.at, from));
  if (to && !Number.isNaN(to.getTime())) filters.push(lte(portalAuditLog.at, to));
  if (q.q?.trim()) {
    const like = `%${q.q.trim().replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    filters.push(or(ilike(portalAuditLog.action, like), ilike(portalAuditLog.actorLabel, like), ilike(portalAuditLog.targetId, like), ilike(portalAuditLog.ip, like))!);
  }
  const where = filters.length ? and(...filters) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(portalAuditLog).where(where);
  const rows = await db.select().from(portalAuditLog).where(where).orderBy(desc(portalAuditLog.at), desc(portalAuditLog.id)).limit(pageSize).offset((page - 1) * pageSize);
  res.json({ total, page, pageSize, entries: rows.map((r) => ({ ...r, at: r.at.toISOString() })) });
});

const sessionRef = (tokenHash: string) => tokenHash.slice(0, 16);

/** Clerk users for the school's administrators and active teachers. */
async function staffUsers() {
  const teachers = await db.select({ email: portalTeachers.email }).from(portalTeachers).where(eq(portalTeachers.active, true));
  const roles = new Map<string, string>();
  for (const e of approvedEmails()) roles.set(e, "Administrator");
  for (const t of teachers) if (!roles.has(t.email)) roles.set(t.email, "Teacher");
  const users: { id: string; email: string; role: string }[] = [];
  for (const [email, role] of roles) {
    const list = await clerkClient.users.getUserList({ emailAddress: [email], limit: 10 });
    for (const u of list.data) users.push({ id: u.id, email, role });
  }
  return users;
}

portalSecurityRouter.get("/security/sessions", async (req, res) => {
  await adminOnly(req);
  const rows = await db.select({ s: portalSessions, name: portalStudents.name, code: portalStudents.studentId, className: portalClasses.name })
    .from(portalSessions)
    .innerJoin(portalStudents, eq(portalStudents.id, portalSessions.studentId))
    .leftJoin(portalClasses, eq(portalClasses.id, portalStudents.classId))
    .where(gt(portalSessions.expiresAt, new Date()))
    .orderBy(desc(portalSessions.createdAt))
    .limit(500);
  const students = rows.map((r) => ({
    studentId: r.s.studentId, studentCode: r.code, name: r.name, className: r.className ?? "", ref: sessionRef(r.s.tokenHash),
    createdAt: r.s.createdAt?.toISOString() ?? null, expiresAt: r.s.expiresAt.toISOString(), ip: r.s.ip, userAgent: r.s.userAgent,
  }));
  let staff: { sessionId: string; email: string; role: string; lastActiveAt: string | null; createdAt: string | null }[] = [];
  let staffAvailable = true;
  try {
    for (const u of await staffUsers()) {
      const sessions = await clerkClient.sessions.getSessionList({ userId: u.id, status: "active" });
      for (const s of sessions.data) staff.push({ sessionId: s.id, email: u.email, role: u.role, lastActiveAt: s.lastActiveAt ? new Date(s.lastActiveAt).toISOString() : null, createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : null });
    }
  } catch (error) {
    req.log.warn({ err: error }, "Staff session list unavailable");
    staff = []; staffAvailable = false;
  }
  res.json({ students, staff, staffAvailable });
});

portalSecurityRouter.post("/security/revoke", async (req, res) => {
  await adminOnly(req);
  const body = RevokeSessionsBody.parse(req.body);
  let message = "Signed out.";
  if (body.kind === "student") {
    check(body.studentId, "Student required.");
    const ended = await db.delete(portalSessions).where(eq(portalSessions.studentId, body.studentId)).returning({ t: portalSessions.tokenHash });
    message = `Ended ${ended.length} ${ended.length === 1 ? "session" : "sessions"}.`;
  } else if (body.kind === "studentSession") {
    check(body.ref && /^[a-f0-9]{16}$/.test(body.ref), "Session required.");
    const ended = await db.delete(portalSessions).where(sql`left(${portalSessions.tokenHash}, 16) = ${body.ref}`).returning({ t: portalSessions.tokenHash });
    check(ended.length, "That session has already ended.", 404);
  } else {
    check(body.sessionId, "Session required.");
    // Only sessions belonging to school staff can be revoked from here.
    const users = await staffUsers();
    const session = await clerkClient.sessions.getSession(body.sessionId);
    check(users.some((u) => u.id === session.userId), "That is not a staff session.", 403);
    await clerkClient.sessions.revokeSession(body.sessionId);
  }
  res.json({ message });
});

portalSecurityRouter.get("/students/:id/activity", async (req, res) => {
  await adminOnly(req);
  const id = Number(req.params.id);
  check(Number.isSafeInteger(id) && id > 0, "Invalid student.");
  const logins = await db.select().from(portalLoginEvents).where(eq(portalLoginEvents.studentId, id)).orderBy(desc(portalLoginEvents.at)).limit(30);
  const [{ active }] = await db.select({ active: count() }).from(portalSessions).where(and(eq(portalSessions.studentId, id), gt(portalSessions.expiresAt, new Date())));
  res.json({ logins: logins.map((l) => ({ at: l.at.toISOString(), success: l.success, ip: l.ip, userAgent: l.userAgent })), activeSessions: active });
});

/** Records a student sign-in attempt for login history and the audit trail. */
export async function recordStudentLogin(req: import("express").Request, studentCode: string, studentId: number | null, success: boolean) {
  const ip = clientIp(req), userAgent = (req.headers["user-agent"] ?? "").slice(0, 300) || null;
  try { await db.insert(portalLoginEvents).values({ studentCode: studentCode.slice(0, 60), studentId, success, ip, userAgent }); } catch (error) { req.log.error({ err: error }, "Login event write failed"); }
  if (!success) await recordAudit({ actorKind: "student", actorId: studentId ? String(studentId) : null, actorLabel: studentCode, action: "student.login_failed", outcome: "denied", status: 401, ip, userAgent });
}

