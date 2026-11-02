import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";
import { db, pool, portalAuditLog, portalClasses, portalSubjects, portalTeacherPresence, portalTeachers } from "@workspace/db";
import portalRouter from "../routes/portal";
import { setApprovedIdentitiesForTest } from "./approved-identities";

// Database checks for the principal portal: who may open it, assigning and replacing teachers, and a teacher's day.
test("principal: assigns and replaces teachers, and sees each teacher's day", async () => {
  const marker = `QA-PRN-${randomUUID().slice(0, 8)}`.toUpperCase();
  const lower = marker.toLowerCase();
  const principal = `principal-${lower}@example.test`, office = `office-${lower}@example.test`, boss = `boss-${lower}@example.test`;
  const saved = { admins: process.env.SCHOOL_ADMIN_EMAILS, principals: process.env.SCHOOL_PRINCIPAL_EMAILS, supers: process.env.SCHOOL_SUPER_ADMIN_EMAILS };
  process.env.SCHOOL_ADMIN_EMAILS = [boss, principal, office].join(",");
  process.env.SCHOOL_SUPER_ADMIN_EMAILS = boss;
  process.env.SCHOOL_PRINCIPAL_EMAILS = principal;
  setApprovedIdentitiesForTest([[`id-${principal}`, { email: principal, mfa: true }], [`id-${office}`, { email: office, mfa: true }]]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error() {}, warn() {}, info() {} } as unknown as typeof req.log;
    const who = req.headers["x-test-user"];
    if (typeof who === "string") {
      req.dbUser = { id: `id-${who}` } as NonNullable<typeof req.dbUser>;
      req.identity = { email: who, emailVerified: true, mfa: true };
    }
    next();
  });
  app.use("/api/portal", portalRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/portal`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (path: string, who: string | null, body?: unknown): Promise<{ status: number; data: any }> => {
    const r = await fetch(root + path, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...(who ? { "X-Test-User": who } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  const classIds: number[] = [];
  const teacherIds: number[] = [];
  try {
    const [jss1] = await db.insert(portalClasses).values({ name: `${marker} JSS 1` }).returning();
    const [jss2] = await db.insert(portalClasses).values({ name: `${marker} JSS 2` }).returning();
    classIds.push(jss1.id, jss2.id);
    const [musa] = await db.insert(portalTeachers).values({ email: `musa-${lower}@example.test`, name: `${marker} Mr Musa`, classIds: [jss1.id], active: true }).returning();
    const [ngozi] = await db.insert(portalTeachers).values({ email: `ngozi-${lower}@example.test`, name: `${marker} Mrs Ngozi`, classIds: [], active: true }).returning();
    teacherIds.push(musa.id, ngozi.id);
    const [maths] = await db.insert(portalSubjects).values({ classId: jss1.id, name: "Mathematics", teacherId: musa.id }).returning();
    const [english] = await db.insert(portalSubjects).values({ classId: jss1.id, name: "English" }).returning();

    // Only the principal (or the super administrator) may open it; another office admin may not.
    assert.equal((await call("/principal", null)).status, 401);
    assert.equal((await call("/principal", office)).status, 403);
    assert.equal((await call("/principal", office, { action: "assign", classId: jss2.id, teacherId: ngozi.id })).status, 403);
    const home = await call("/principal", principal);
    assert.equal(home.status, 200, JSON.stringify(home.data));
    const jss1View = home.data.classes.find((c: { id: number }) => c.id === jss1.id);
    assert.deepEqual(jss1View.teachers.map((t: { name: string }) => t.name), [`${marker} Mr Musa`]);
    assert.deepEqual(jss1View.subjects.map((s: { name: string; teacherName: string | null }) => [s.name, s.teacherName]), [["English", null], ["Mathematics", `${marker} Mr Musa`]]);

    // Assign, refuse a repeat, set a subject teacher, and remove.
    assert.equal((await call("/principal", principal, { action: "assign", classId: jss2.id, teacherId: ngozi.id })).status, 200);
    assert.equal((await call("/principal", principal, { action: "assign", classId: jss2.id, teacherId: ngozi.id })).status, 409);
    assert.equal((await call("/principal", principal, { action: "setSubjectTeacher", classId: jss1.id, subjectId: english.id, teacherId: ngozi.id })).status, 200);
    assert.equal((await call("/principal", principal, { action: "setSubjectTeacher", classId: jss2.id, subjectId: english.id, teacherId: ngozi.id })).status, 404, "subject must be in the class");
    assert.equal((await call("/principal", principal, { action: "remove", classId: jss2.id, teacherId: ngozi.id })).status, 200);
    assert.deepEqual((await db.select().from(portalTeachers).where(eq(portalTeachers.id, ngozi.id)))[0].classIds, []);

    // Replacing Mr Musa in JSS 1 moves the class and his subjects there to Mrs Ngozi.
    const replaced = await call("/principal", principal, { action: "replace", classId: jss1.id, teacherId: musa.id, newTeacherId: ngozi.id });
    assert.equal(replaced.status, 200, JSON.stringify(replaced.data));
    assert.match(replaced.data.message, /has replaced .* in .* JSS 1, including 1 subject/);
    assert.deepEqual((await db.select().from(portalTeachers).where(eq(portalTeachers.id, musa.id)))[0].classIds, []);
    assert.deepEqual((await db.select().from(portalTeachers).where(eq(portalTeachers.id, ngozi.id)))[0].classIds, [jss1.id]);
    assert.equal((await db.select().from(portalSubjects).where(eq(portalSubjects.id, maths.id)))[0].teacherId, ngozi.id);

    // A teacher's day: when they were in the portal and what they did, in order; failed or denied attempts are not shown.
    const day = "2026-11-04";
    await db.insert(portalTeacherPresence).values({ teacherId: musa.id, day, firstAt: new Date("2026-11-04T06:50:00Z"), lastAt: new Date("2026-11-04T13:10:00Z") });
    await db.insert(portalAuditLog).values([
      { at: new Date("2026-11-04T07:05:00Z"), actorKind: "staff", actorLabel: musa.email, action: "PUT /portal/attendance", outcome: "success" },
      { at: new Date("2026-11-04T10:20:00Z"), actorKind: "staff", actorLabel: musa.email.toUpperCase(), action: "portal.saveScores", outcome: "success" },
      { at: new Date("2026-11-04T11:00:00Z"), actorKind: "staff", actorLabel: musa.email, action: "portal.grade", outcome: "denied" },
      { at: new Date("2026-11-03T22:30:00Z"), actorKind: "staff", actorLabel: musa.email, action: "portal.grade", outcome: "success" },
    ]);
    assert.equal((await call(`/principal/activity?date=${day}`, office)).status, 403);
    assert.equal((await call("/principal/activity?date=2026-02-31", principal)).status, 400);
    const activity = await call(`/principal/activity?date=${day}`, principal);
    assert.equal(activity.status, 200, JSON.stringify(activity.data));
    const musaDay = activity.data.teachers.find((t: { id: number }) => t.id === musa.id);
    assert.deepEqual(musaDay.actions.map((a: { label: string }) => a.label), ["Took the class register", "Entered report card scores and comments"]);
    assert.deepEqual([musaDay.counts.register, musaDay.counts.scores, musaDay.counts.marking], [1, 1, 0]);
    assert.deepEqual([musaDay.firstSeen, musaDay.lastSeen], ["2026-11-04T06:50:00.000Z", "2026-11-04T13:10:00.000Z"]);
    const ngoziDay = activity.data.teachers.find((t: { id: number }) => t.id === ngozi.id);
    assert.deepEqual([ngoziDay.actions.length, ngoziDay.firstSeen, ngoziDay.classes], [0, null, [`${marker} JSS 1`]]);
  } finally {
    server.close();
    const emails = [`musa-${lower}@example.test`, `ngozi-${lower}@example.test`];
    await db.delete(portalAuditLog).where(inArray(portalAuditLog.actorLabel, [...emails, emails[0].toUpperCase()]));
    if (teacherIds.length) await db.delete(portalTeacherPresence).where(inArray(portalTeacherPresence.teacherId, teacherIds));
    await db.delete(portalSubjects).where(inArray(portalSubjects.classId, classIds.length ? classIds : [-1]));
    await db.delete(portalTeachers).where(like(portalTeachers.name, `${marker}%`));
    if (classIds.length) await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    for (const [k, v] of [["SCHOOL_ADMIN_EMAILS", saved.admins], ["SCHOOL_PRINCIPAL_EMAILS", saved.principals], ["SCHOOL_SUPER_ADMIN_EMAILS", saved.supers]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    await pool.end();
  }
});
