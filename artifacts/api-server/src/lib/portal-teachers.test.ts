import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { inArray } from "drizzle-orm";
import { db, pool, portalClasses, portalSessions, portalStudents, portalTeachers } from "@workspace/db";
import portalRouter from "../routes/portal";
import { hashPassword } from "./portal-auth";

// Database checks for approving teachers, assigning classes and sending their invitation.
test("teachers: approval with classes, invitation, and office-only access", async () => {
  const saved = { admins: process.env.SCHOOL_ADMIN_EMAILS, key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM };
  const marker = `QA-TCH-${randomUUID().slice(0, 8)}`.toUpperCase();
  process.env.SCHOOL_ADMIN_EMAILS = `admin-${marker}@example.test`.toLowerCase();
  // No email provider in tests: the office is told to share the link instead.
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  const classIds: number[] = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error() {}, warn() {}, info() {} } as unknown as typeof req.log;
    if (req.headers["x-test-admin"] === marker) {
      req.dbUser = { id: `synthetic-${marker}` } as NonNullable<typeof req.dbUser>;
      req.identity = { email: `admin-${marker}@example.test`.toLowerCase(), emailVerified: true, mfa: true };
    }
    next();
  });
  app.use("/api/portal", portalRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/portal`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function call(body: unknown, opts: { cookie?: string; admin?: boolean } = {}): Promise<{ status: number; data: any }> {
    const r = await fetch(root + "/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(opts.cookie ? { Cookie: opts.cookie } : {}), ...(opts.admin ? { "X-Test-Admin": marker } : {}) },
      body: JSON.stringify(body),
    });
    return { status: r.status, data: await r.json() };
  }
  const admin = { admin: true };
  const email = `teacher-${marker}@example.test`.toLowerCase();
  try {
    const [a] = await db.insert(portalClasses).values({ name: marker + " A" }).returning();
    const [b] = await db.insert(portalClasses).values({ name: marker + " B" }).returning();
    classIds.push(a.id, b.id);
    const [student] = await db.insert(portalStudents).values({ studentId: marker + "-1", name: "Ada Obi", classId: a.id, passwordHash: await hashPassword("Teacher-Test-1"), mustChangePassword: false }).returning();
    const login = await fetch(root + "/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: student.studentId, password: "Teacher-Test-1" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];

    // Approving a teacher saves their classes and reports what happened to the invitation.
    const approved = await call({ action: "saveTeacher", teacher: { email: ` ${email.toUpperCase()} `, name: " Mr Bayo ", classIds: [a.id, b.id, a.id], active: true } }, admin);
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    assert.match(approved.data.message, /^Teacher approved\. Not emailed: email is not set up/);
    const [row] = await db.select().from(portalTeachers).where(inArray(portalTeachers.email, [email]));
    assert.deepEqual([row.name, [...row.classIds].sort()], ["Mr Bayo", [a.id, b.id].sort()]);

    // Re-sending works for active teachers only, and only the office can do it.
    assert.match((await call({ action: "inviteTeacher", target: { id: row.id } }, admin)).data.message, /Share the teacher link/);
    assert.equal((await call({ action: "inviteTeacher", target: { id: 999999999 } }, admin)).status, 404);
    assert.equal((await call({ action: "inviteTeacher", target: { id: row.id } }, { cookie })).status, 403);
    assert.equal((await call({ action: "inviteTeacher", target: { id: row.id } })).status, 401);
    assert.equal((await call({ action: "saveTeacher", teacher: { id: row.id, email, name: "Mr Bayo", classIds: [a.id], active: false } }, admin)).status, 200);
    assert.equal((await call({ action: "inviteTeacher", target: { id: row.id } }, admin)).status, 409);
    const [after] = await db.select().from(portalTeachers).where(inArray(portalTeachers.id, [row.id]));
    assert.deepEqual([after.active, after.classIds], [false, [a.id]], "editing changes the classes without sending another email");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    await db.delete(portalTeachers).where(inArray(portalTeachers.email, [email]));
    if (classIds.length) {
      const ids = (await db.select({ id: portalStudents.id }).from(portalStudents).where(inArray(portalStudents.classId, classIds))).map((s) => s.id);
      if (ids.length) await db.delete(portalSessions).where(inArray(portalSessions.studentId, ids));
      await db.delete(portalStudents).where(inArray(portalStudents.classId, classIds));
      await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    }
    for (const [k, v] of [["SCHOOL_ADMIN_EMAILS", saved.admins], ["RESEND_API_KEY", saved.key], ["EMAIL_FROM", saved.from]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    await pool.end();
  }
});
