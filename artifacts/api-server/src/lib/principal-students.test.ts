import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";
import { db, pool, portalClasses, portalStudents, portalTeachers, studentProfiles } from "@workspace/db";
import portalRouter from "../routes/portal";
import { setApprovedIdentitiesForTest } from "./approved-identities";

// Each principal sees and works with only their own school: its teachers (plus new ones not yet in any class) and
// its students, whom they can edit, move and give a full profile.
test("principals: own school's teachers only; edit, move and profile their own students", async () => {
  const marker = `QA-PST-${randomUUID().slice(0, 8)}`.toUpperCase();
  const m = marker.toLowerCase();
  const sec = `sec-${m}@example.test`, pri = `pri-${m}@example.test`;
  const keys = ["SCHOOL_PRINCIPAL_EMAILS", "SCHOOL_PRIMARY_PRINCIPAL_EMAILS", "SCHOOL_ADMIN_EMAILS"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.SCHOOL_PRINCIPAL_EMAILS = sec;
  process.env.SCHOOL_PRIMARY_PRINCIPAL_EMAILS = pri;
  process.env.SCHOOL_ADMIN_EMAILS = `office-${m}@example.test`;
  setApprovedIdentitiesForTest([sec, pri].map((e) => [`id-${e}`, { email: e, mfa: true }]));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error() {}, warn() {}, info() {} } as unknown as typeof req.log;
    const who = req.headers["x-test-user"];
    if (typeof who === "string") { req.dbUser = { id: `id-${who}` } as NonNullable<typeof req.dbUser>; req.identity = { email: who, emailVerified: true, mfa: true }; }
    next();
  });
  app.use("/api/portal", portalRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/portal`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (path: string, who: string, body?: unknown, method?: string): Promise<{ status: number; data: any }> => {
    const r = await fetch(root + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { "Content-Type": "application/json", "X-Test-User": who }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const classIds: number[] = [];
  try {
    const [jss1a, jss1b, y3] = await db.insert(portalClasses).values([`${marker} JSS 1 Amber`, `${marker} JSS 1 Jade`, `${marker} Year 3 Ruby`].map((name) => ({ name }))).returning();
    classIds.push(jss1a.id, jss1b.id, y3.id);
    const [mrSec, mrsPri, newbie] = await db.insert(portalTeachers).values([
      { email: `s-${m}@example.test`, name: `${marker} Mr Secondary`, classIds: [jss1a.id] },
      { email: `p-${m}@example.test`, name: `${marker} Mrs Primary`, classIds: [y3.id] },
      { email: `n-${m}@example.test`, name: `${marker} New Teacher`, classIds: [] },
    ]).returning();
    const [ada, , tolu] = await db.insert(portalStudents).values([
      { studentId: `${marker}-1`, name: "Adaa Obi", classId: jss1a.id, passwordHash: "x", guardianEmail: `mum-${m}@example.test` },
      { studentId: `${marker}-2`, name: "Old Leaver", classId: jss1b.id, passwordHash: "x", active: false },
      { studentId: `${marker}-3`, name: "Tolu Ade", classId: y3.id, passwordHash: "x" },
    ]).returning();

    // Teachers: the secondary principal sees their own and the new one, never the primary teacher.
    const ov = await call("/principal?section=secondary", sec);
    assert.equal(ov.status, 200);
    const names = ov.data.teachers.map((t: { name: string }) => t.name).filter((n: string) => n.includes(marker));
    assert.deepEqual(names.sort(), [`${marker} Mr Secondary`, `${marker} New Teacher`]);
    assert.equal(ov.data.teachers.find((t: { id: number }) => t.id === newbie.id).unassigned, true);
    assert.equal((await call("/principal", sec, { action: "assign", classId: jss1b.id, teacherId: mrsPri.id })).status, 403, "not the other school's teacher");
    assert.equal((await call("/principal", sec, { action: "assign", classId: jss1b.id, teacherId: newbie.id })).status, 200, "a new teacher can be taken on");
    void mrSec;

    // Students: every one in the school, inactive included, with their details; none from primary.
    const studs = ov.data.students.filter((s: { studentId: string }) => s.studentId.startsWith(marker));
    assert.deepEqual(studs.map((s: { studentId: string }) => s.studentId).sort(), [`${marker}-1`, `${marker}-2`]);
    assert.equal(studs.find((s: { studentId: string }) => s.studentId === `${marker}-2`).active, false);
    assert.equal(studs.find((s: { studentId: string }) => s.studentId === `${marker}-1`).guardianEmail, `mum-${m}@example.test`);

    // Edit: name, parent emails (checked), active.
    const edit = (b: object) => call("/principal", sec, { action: "editStudent", classId: jss1a.id, studentId: ada.id, ...b });
    assert.equal((await edit({ guardianEmail: `dad-${m}@gmial.com` })).status, 400, "misspelt provider caught");
    assert.equal((await edit({ guardianEmail: "not an email" })).status, 400);
    assert.equal((await edit({ studentName: "A" })).status, 400);
    const ok = await edit({ studentName: " Ada   Obi ", secondGuardianEmail: `Dad-${m}@Example.test`, active: false });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    const [after] = await db.select().from(portalStudents).where(eq(portalStudents.id, ada.id));
    assert.equal(after.name, "Ada Obi");
    assert.equal(after.secondGuardianEmail, `dad-${m}@example.test`);
    assert.equal(after.active, false);
    assert.equal(after.guardianEmail, `mum-${m}@example.test`, "untouched when not sent");
    // Not someone in the other school, and not through a class they are not in.
    assert.equal((await call("/principal", sec, { action: "editStudent", classId: y3.id, studentId: tolu.id, studentName: "X Y" })).status, 403);
    assert.equal((await call("/principal", sec, { action: "editStudent", classId: jss1b.id, studentId: ada.id, studentName: "X Y" })).status, 409);

    // Move within the school.
    assert.equal((await call("/principal", sec, { action: "moveStudent", classId: jss1b.id, studentId: ada.id })).status, 200);

    // Profiles: their own school's students only.
    const prof = await call(`/students/${ada.id}/profile`, sec, { address: "12 Crescent Road, Kubwa", phone: "0803 123 4567" }, "PUT");
    assert.equal(prof.status, 200, JSON.stringify(prof.data));
    assert.equal(prof.data.profile.address, "12 Crescent Road, Kubwa");
    assert.equal(prof.data.updatedBy, sec);
    assert.equal((await call(`/students/${ada.id}/profile`, sec)).status, 200);
    assert.notEqual((await call(`/students/${tolu.id}/profile`, sec)).status, 200, "not the primary school's students");
    assert.equal((await call(`/students/${tolu.id}/profile`, pri)).status, 200, "the primary principal can");
  } finally {
    server.close();
    const ids = (await db.select({ id: portalStudents.id }).from(portalStudents).where(like(portalStudents.studentId, `${marker}%`))).map((s) => s.id);
    if (ids.length) await db.delete(studentProfiles).where(inArray(studentProfiles.studentId, ids));
    await db.delete(portalStudents).where(like(portalStudents.studentId, `${marker}%`));
    await db.delete(portalTeachers).where(like(portalTeachers.name, `${marker}%`));
    if (classIds.length) await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await pool.end();
  }
});
