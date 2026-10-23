import { Router } from "express";
import { randomBytes } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { db, portalStudents, portalSessions } from "@workspace/db";
import { LoginPortalStudentBody, ChangePortalPasswordBody } from "@workspace/api-zod";
import { check, hashPassword, hashToken, portalActor, sessionToken, setPortalCookie, verifyPassword, portalCookie } from "../lib/portal-auth";
import { adminNeedsMfa, isSuperAdmin } from "../lib/website-admin";
import { refreshApprovedIdentitiesSoon } from "../lib/approved-identities";
import { clientIp, recordAudit } from "../lib/audit";
import { recordStudentLogin } from "./portal-security";

export const portalSessionRouter = Router();
const limits = new Map<string, { count: number; until: number }>();
const dummyHash = hashPassword(randomBytes(32).toString("hex"));
portalSessionRouter.get("/session", async (req, res) => {
  const actor = await portalActor(req);
  const mfaRequired = adminNeedsMfa(req);
  if (mfaRequired) refreshApprovedIdentitiesSoon();
  res.json({ role: actor.role, name: actor.name, classIds: actor.classIds, mustChangePassword: actor.mustChangePassword,
    ...(actor.role === "admin" ? { superAdmin: isSuperAdmin(req) } : {}), ...(mfaRequired ? { mfaRequired: true } : {}),
    ...(actor.student ? { studentId: actor.student.studentId, classId: actor.student.classId } : {}) });
});
portalSessionRouter.post("/session", async (req, res) => {
  const body = LoginPortalStudentBody.parse(req.body);
  const studentId = body.studentId.trim().toUpperCase();
  // Behind a hosting proxy many students share one address (and a school network
  // shares one too), so only failed attempts count, per address and student ID.
  // Each account also locks itself after repeated wrong passwords (below).
  const key = (req.ip || req.socket.remoteAddress || "unknown") + "|" + studentId;
  const now = Date.now();
  let limit = limits.get(key);
  if (!limit || limit.until < now) {
    if (limits.size > 10000) limits.clear();
    limit = { count: 0, until: now + 15 * 60_000 };
  }
  check(limit.count < 20, "Too many sign-in attempts. Please wait 15 minutes.", 429);
  const student = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(portalStudents).where(eq(portalStudents.studentId, studentId)).for("update");
    const valid = await verifyPassword(body.password, row?.passwordHash ?? await dummyHash);
    if (!row || !row.active || (row.lockedUntil && row.lockedUntil.getTime() > now)) return null;
    if (!valid) {
      const failures = row.failedLogins + 1;
      await tx.update(portalStudents).set({ failedLogins: failures >= 8 ? 0 : failures, lockedUntil: failures >= 8 ? new Date(now + 15 * 60_000) : null }).where(eq(portalStudents.id, row.id));
      return null;
    }
    await tx.update(portalStudents).set({ failedLogins: 0, lockedUntil: null }).where(eq(portalStudents.id, row.id));
    return row;
  });
  if (!student) { limit.count++; limits.set(key, limit); }
  else limits.delete(key);
  const [known] = student ? [student] : await db.select({ id: portalStudents.id }).from(portalStudents).where(eq(portalStudents.studentId, studentId));
  await recordStudentLogin(req, studentId, known?.id ?? null, !!student);
  check(student, "Student ID or password is incorrect, or this account is temporarily unavailable.", 401);
  const token = randomBytes(32).toString("hex");
  // Replacing a browser login cannot retain another student's session.
  await db.delete(portalSessions).where(eq(portalSessions.tokenHash, hashToken(sessionToken(req))));
  await db.delete(portalSessions).where(lt(portalSessions.expiresAt, new Date()));
  await db.insert(portalSessions).values({ tokenHash: hashToken(token), studentId: student.id, expiresAt: new Date(now + 12 * 60 * 60_000), ip: clientIp(req), userAgent: (req.headers["user-agent"] ?? "").slice(0, 300) || null });
  setPortalCookie(req, res, token);
  res.json({ role: "student", name: student.name, studentId: student.studentId, classId: student.classId, classIds: [student.classId], mustChangePassword: student.mustChangePassword });
});
portalSessionRouter.delete("/session", async (req, res) => {
  await db.delete(portalSessions).where(eq(portalSessions.tokenHash, hashToken(sessionToken(req))));
  res.clearCookie(portalCookie, { path: "/api/portal", sameSite: "strict" });
  res.status(204).end();
});
portalSessionRouter.put("/password", async (req, res) => {
  const actor = await portalActor(req);
  check(actor.student && actor.role === "student", "Student sign-in required.", 401);
  const body = ChangePortalPasswordBody.parse(req.body);
  check(body.newPassword !== body.currentPassword, "Choose a different password.");
  const token = randomBytes(32).toString("hex");
  await db.transaction(async (tx) => {
    const [student] = await tx.select().from(portalStudents).where(eq(portalStudents.id, actor.student!.id)).for("update");
    check(student && student.active && await verifyPassword(body.currentPassword, student.passwordHash), "Current password is incorrect.", 400);
    // A password reset revokes the old cookie even if this request began earlier.
    const [session] = await tx.select().from(portalSessions).where(and(eq(portalSessions.tokenHash, hashToken(sessionToken(req))), eq(portalSessions.studentId, student.id)));
    check(session, "Your session expired. Sign in again.", 401);
    await tx.update(portalStudents).set({ passwordHash: await hashPassword(body.newPassword), mustChangePassword: false }).where(eq(portalStudents.id, student.id));
    await tx.delete(portalSessions).where(eq(portalSessions.studentId, student.id));
    await tx.insert(portalSessions).values({ tokenHash: hashToken(token), studentId: student.id, expiresAt: new Date(Date.now() + 12 * 60 * 60_000), ip: clientIp(req), userAgent: (req.headers["user-agent"] ?? "").slice(0, 300) || null });
  });
  await recordAudit({ actorKind: "student", actorId: String(actor.student!.id), actorLabel: actor.student!.studentId, action: "student.password_changed", ip: clientIp(req), userAgent: req.headers["user-agent"] ?? null });
  setPortalCookie(req, res, token);
  res.status(204).end();
});
