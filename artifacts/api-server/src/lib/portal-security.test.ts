import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, pool, portalAuditLog, portalClasses, portalLoginEvents, portalSessions, portalStudents } from "@workspace/db";
import portalRouter from "../routes/portal";
import { auditStaffChanges } from "./audit";

// Database-only security checks (audit trail, login history, sessions, super admin, MFA).
test("audit trail, login history, session control, super admin and admin MFA", async () => {
  const saved = { admins: process.env.SCHOOL_ADMIN_EMAILS, mfa: process.env.REQUIRE_ADMIN_MFA };
  const marker = `QA-SEC-${randomUUID().slice(0, 8)}`.toUpperCase();
  process.env.SCHOOL_ADMIN_EMAILS = `super-${marker}@example.test, other-${marker}@example.test`.toLowerCase();
  const classIds: number[] = [];
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use((req, _res, next) => {
    req.log = { error() {}, warn() {}, info() {} } as unknown as typeof req.log;
    const who = req.headers["x-test-staff"];
    if (who === "super" || who === "other" || who === "nomfa") {
      req.dbUser = { id: `synthetic-${who}-${marker}` } as NonNullable<typeof req.dbUser>;
      req.identity = { email: `${who === "other" ? "other" : "super"}-${marker}@example.test`.toLowerCase(), emailVerified: true, mfa: who !== "nomfa" };
    }
    next();
  });
  app.use("/api", auditStaffChanges());
  app.use("/api/portal", portalRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/portal`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function call(path: string, method = "GET", body?: unknown, opts: { cookie?: string; staff?: string; ua?: string } = {}): Promise<{ status: number; cookie: string; data: any }> {
    const r = await fetch(root + path, {
      method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(opts.cookie ? { Cookie: opts.cookie } : {}), ...(opts.staff ? { "X-Test-Staff": opts.staff } : {}), "User-Agent": opts.ua ?? "QA-Agent/1.0", "X-Forwarded-For": "203.0.113.7" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "", data: r.status === 204 ? {} : await r.json() };
  }
  const settle = () => new Promise((r) => setTimeout(r, 150));
  const auditFor = async (action: string) => db.select().from(portalAuditLog).where(and(eq(portalAuditLog.action, action), eq(portalAuditLog.actorId, `synthetic-super-${marker}`))).orderBy(desc(portalAuditLog.id));
  try {
    // Staff changes are audited with before/after; passwords are redacted.
    assert.equal((await call("/manage", "POST", { action: "saveClass", schoolClass: { name: marker } }, { staff: "super" })).status, 200);
    const [cls] = await db.select().from(portalClasses).where(eq(portalClasses.name, marker)); classIds.push(cls.id);
    const password = "Individual-Temp-5271!";
    assert.equal((await call("/manage", "POST", { action: "saveStudent", student: { studentId: marker, name: "Security QA", classId: cls.id, active: true, password } }, { staff: "super" })).status, 200);
    const [student] = await db.select().from(portalStudents).where(eq(portalStudents.studentId, marker));
    assert.equal((await call("/manage", "POST", { action: "saveStudent", student: { id: student.id, studentId: marker, name: "Security QA Renamed", classId: cls.id, active: true } }, { staff: "super" })).status, 200);
    await settle();
    const saves = await auditFor("portal.saveStudent");
    assert.equal(saves.length, 2);
    const [update, create] = saves;
    assert.equal(create.before, null);
    assert.equal((create.after as { student: { password: string } }).student.password, "[redacted]");
    assert.equal(JSON.stringify(create).includes(password), false, "the password never reaches the audit log");
    assert.equal(update.targetType, "student");
    assert.equal(update.targetId, String(student.id));
    assert.equal((update.before as { name: string }).name, "Security QA");
    assert.equal((update.after as { student: { name: string } }).student.name, "Security QA Renamed");
    assert.equal(update.ip, "203.0.113.7");
    assert.equal(update.userAgent, "QA-Agent/1.0");
    assert.equal(update.outcome, "success");
    // Refused staff actions are audited too.
    assert.equal((await call("/manage", "POST", { action: "saveStudent", student: { studentId: "bad id!", name: "x", classId: cls.id, active: true, password } }, { staff: "super" })).status, 400);
    await settle();
    assert.equal((await auditFor("portal.saveStudent"))[0].outcome, "failed");

    // Student sign-ins: failures and successes are recorded; sessions keep device details.
    assert.equal((await call("/session", "POST", { studentId: marker, password: "wrong-password" })).status, 401);
    const login = await call("/session", "POST", { studentId: marker.toLowerCase(), password }, { ua: "Student-Phone/2.0" });
    assert.equal(login.status, 200);
    await settle();
    const events = await db.select().from(portalLoginEvents).where(eq(portalLoginEvents.studentId, student.id)).orderBy(portalLoginEvents.id);
    assert.deepEqual(events.map((e) => e.success), [false, true]);
    const [failedAudit] = await db.select().from(portalAuditLog).where(and(eq(portalAuditLog.action, "student.login_failed"), eq(portalAuditLog.actorLabel, marker)));
    assert.equal(failedAudit.outcome, "denied");
    const [session] = await db.select().from(portalSessions).where(eq(portalSessions.studentId, student.id));
    assert.equal(session.userAgent, "Student-Phone/2.0");
    assert.equal(session.ip, "203.0.113.7");

    // Password changes are audited without the password.
    const changed = await call("/password", "PUT", { currentPassword: password, newPassword: "Individual-New-6842!" }, { cookie: login.cookie });
    assert.equal(changed.status, 204);
    await settle();
    const [pwAudit] = await db.select().from(portalAuditLog).where(and(eq(portalAuditLog.action, "student.password_changed"), eq(portalAuditLog.actorLabel, marker)));
    assert.ok(pwAudit);

    // Audit log: super admin only.
    assert.equal((await call("/session", "GET", undefined, { staff: "super" })).data.superAdmin, true, "super admin flag");
    assert.equal((await call("/session", "GET", undefined, { staff: "other" })).data.superAdmin, false);
    const page = await call(`/security/audit?q=${encodeURIComponent("saveStudent")}&pageSize=5`, "GET", undefined, { staff: "super" });
    assert.equal(page.status, 200);
    assert.ok(page.data.total >= 3);
    assert.ok(page.data.entries.every((e: { action: string }) => e.action.includes("saveStudent")));
    assert.equal((await call("/security/audit", "GET", undefined, { staff: "other" })).status, 403);
    assert.equal((await call("/security/audit", "GET", undefined, { cookie: changed.cookie })).status, 403);
    assert.equal((await call("/security/audit")).status, 401);

    // Login history and session control (any administrator).
    const activity = await call(`/students/${student.id}/activity`, "GET", undefined, { staff: "other" });
    assert.equal(activity.status, 200);
    assert.deepEqual(activity.data.logins.map((l: { success: boolean }) => l.success), [true, false]);
    assert.equal(activity.data.activeSessions, 1);
    const sessions = await call("/security/sessions", "GET", undefined, { staff: "other" });
    assert.equal(sessions.status, 200);
    const mine = sessions.data.students.find((s: { studentId: number }) => s.studentId === student.id);
    // The password change replaced the session, so it carries that request's device.
    assert.equal(mine.userAgent, "QA-Agent/1.0");
    assert.equal(mine.ref.length, 16);
    assert.equal((await call("/security/sessions", "GET", undefined, { cookie: changed.cookie })).status, 403);
    assert.equal((await call("/security/revoke", "POST", { kind: "studentSession", ref: mine.ref }, { staff: "other" })).status, 200);
    assert.equal((await call("/session", "GET", undefined, { cookie: changed.cookie })).data.role, "guest");
    const again = await call("/session", "POST", { studentId: marker, password: "Individual-New-6842!" });
    assert.equal((await call("/security/revoke", "POST", { kind: "student", studentId: student.id }, { staff: "other" })).data.message, "Ended 1 session.");
    assert.equal((await call("/session", "GET", undefined, { cookie: again.cookie })).data.role, "guest");

    // Required MFA: an approved admin without two-factor gets no admin access until it is on.
    process.env.REQUIRE_ADMIN_MFA = "true";
    const blocked = await call("/session", "GET", undefined, { staff: "nomfa" });
    assert.equal(blocked.data.mfaRequired, true, "mfa required flag: " + JSON.stringify(blocked.data));
    assert.notEqual(blocked.data.role, "admin");
    assert.notEqual((await call("/manage", "GET", undefined, { staff: "nomfa" })).status, 200);
    assert.equal((await call("/session", "GET", undefined, { staff: "super" })).data.role, "admin");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    if (classIds.length) {
      const ids = (await db.select({ id: portalStudents.id }).from(portalStudents).where(inArray(portalStudents.classId, classIds))).map((s) => s.id);
      if (ids.length) {
        await db.delete(portalSessions).where(inArray(portalSessions.studentId, ids));
        await db.delete(portalLoginEvents).where(inArray(portalLoginEvents.studentId, ids));
      }
      await db.delete(portalStudents).where(inArray(portalStudents.classId, classIds));
      await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    }
    // Audit rows are append-only by design; the QA rows are labelled with the marker.
    if (saved.admins === undefined) delete process.env.SCHOOL_ADMIN_EMAILS; else process.env.SCHOOL_ADMIN_EMAILS = saved.admins;
    if (saved.mfa === undefined) delete process.env.REQUIRE_ADMIN_MFA; else process.env.REQUIRE_ADMIN_MFA = saved.mfa;
    await pool.end();
  }
});
