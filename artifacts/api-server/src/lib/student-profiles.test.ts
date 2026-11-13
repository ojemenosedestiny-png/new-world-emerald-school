import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";
import { db, pool, portalClasses, portalSessions, portalStudents, studentProfiles } from "@workspace/db";
import portalRouter from "../routes/portal";
import { setApprovedIdentitiesForTest } from "./approved-identities";
import { hashPassword } from "./portal-auth";
import { setParentEmailResolverForTest } from "../routes/portal-parent";
import { profileProblem } from "../routes/student-profiles";

// Student profiles: the office fills in the details; the student and their linked parents read them; nobody else.
test("student profiles: office saves, student and linked parent read, strangers cannot", async () => {
  const marker = `QA-PRO-${randomUUID().slice(0, 8)}`.toUpperCase();
  const m = marker.toLowerCase();
  const office = `office-${m}@example.test`, mum = `mum-${m}@example.test`;
  const saved = Object.fromEntries(["SCHOOL_ADMIN_EMAILS", "SCHOOL_SUPER_ADMIN_EMAILS"].map((k) => [k, process.env[k]]));
  process.env.SCHOOL_ADMIN_EMAILS = office;
  process.env.SCHOOL_SUPER_ADMIN_EMAILS = office;
  setApprovedIdentitiesForTest([[`id-${office}`, { email: office, mfa: true }]]);
  let parent: string | null = null;
  setParentEmailResolverForTest(async () => parent);
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
  const call = async (path: string, opts: { who?: string; cookie?: string; body?: unknown } = {}): Promise<{ status: number; data: any }> => {
    const r = await fetch(root + path, { method: opts.body === undefined ? "GET" : "PUT", headers: { "Content-Type": "application/json", ...(opts.who ? { "X-Test-User": opts.who } : {}), ...(opts.cookie ? { Cookie: opts.cookie } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const classIds: number[] = [];
  try {
    const [cls] = await db.insert(portalClasses).values({ name: `${marker} Year 5 Topaz` }).returning();
    classIds.push(cls.id);
    const [kid, other] = await db.insert(portalStudents).values([
      { studentId: `${marker}-1`, name: "Adaeze Okafor", classId: cls.id, passwordHash: await hashPassword("Profile-Test-1"), mustChangePassword: false, guardianEmail: mum },
      { studentId: `${marker}-2`, name: "Bola Ade", classId: cls.id, passwordHash: "x" },
    ]).returning();

    // Empty at first.
    const first = await call(`/students/${kid.id}/profile`, { who: office });
    assert.equal(first.status, 200);
    assert.equal(first.data.profile.address, "");
    assert.equal(first.data.canEdit, true);
    assert.equal(first.data.className, `${marker} Year 5 Topaz`);

    // Validation.
    const save = (p: object) => call(`/students/${kid.id}/profile`, { who: office, body: p });
    assert.equal((await save({ dateOfBirth: "2016-02-30" })).status, 400);
    assert.equal((await save({ dateOfBirth: "2999-01-01" })).status, 400);
    assert.equal((await save({ phone: "call me" })).status, 400);
    assert.equal((await save({ gender: "Robot" })).status, 400);

    const details = {
      dateOfBirth: "2016-05-14", gender: "Female", phone: "0803 123 4567", address: "  12   Crescent Road,  Kubwa ", city: "Kubwa, Abuja", stateOfOrigin: "Anambra",
      lga: "Onitsha North", bloodGroup: "O+", genotype: "AA", medicalNotes: "Allergic to groundnuts", admissionDate: "2022-09-12", previousSchool: "Bright Stars Nursery",
      parent1Name: "Mrs Ngozi Okafor", parent1Relationship: "Mother", parent1Phone: "+234 805 000 1111", emergencyName: "Uncle Obi", emergencyPhone: "0809 222 3333",
    };
    const ok = await save(details);
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.profile.address, "12 Crescent Road, Kubwa", "spaces tidied");
    assert.equal(ok.data.profile.medicalNotes, "Allergic to groundnuts");
    assert.equal(ok.data.updatedBy, office);

    // The student reads their own; they cannot save or read another student's.
    const cookie = (await fetch(root + "/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: kid.studentId, password: "Profile-Test-1" }) })).headers.get("set-cookie")!.split(";")[0];
    const mine = await call("/me/profile", { cookie });
    assert.equal(mine.status, 200);
    assert.equal(mine.data.profile.parent1Phone, "+234 805 000 1111");
    assert.equal(mine.data.canEdit, true, "students fill in their own details");
    assert.notEqual((await call(`/students/${kid.id}/profile`, { cookie, body: { address: "x" } })).status, 200);

    // The student (with their parents) fills in their own details; the admission date stays as the school set it.
    const admitted = mine.data.profile.admissionDate;
    const own = await call("/me/profile", { cookie, body: { ...mine.data.profile, address: " 4  Unity Close, Gwarinpa ", parent2Phone: "0809 222 3333", admissionDate: "2020-01-01" } });
    assert.equal(own.status, 200, JSON.stringify(own.data));
    assert.equal(own.data.profile.address, "4 Unity Close, Gwarinpa");
    assert.equal(own.data.profile.parent2Phone, "0809 222 3333");
    assert.equal(own.data.profile.admissionDate, admitted, "the school's admission date is kept");
    assert.equal(own.data.profile.medicalNotes, "Allergic to groundnuts", "fields sent back unchanged stay");
    assert.match(own.data.updatedBy, /\(student\)$/);
    assert.equal((await call("/me/profile", { cookie, body: { parent1Phone: "call my dad" } })).status, 400, "phone numbers checked");
    assert.equal((await call("/me/profile", { body: { address: "x" } })).status, 401, "signed-in students only");
    const [stored] = await db.select().from(studentProfiles).where(eq(studentProfiles.studentId, kid.id));
    assert.equal(stored.address, "4 Unity Close, Gwarinpa");
    const [otherRow] = await db.select().from(studentProfiles).where(eq(studentProfiles.studentId, other.id));
    assert.notEqual(otherRow?.address, "4 Unity Close, Gwarinpa", "only their own profile");
    assert.notEqual((await call(`/students/${other.id}/profile`, { cookie })).status, 200);

    // A linked parent reads their child; not someone else's child.
    parent = mum;
    assert.equal((await call(`/parent/children/${kid.id}/profile`)).data.profile.city, "Kubwa, Abuja");
    assert.equal((await call(`/parent/children/${other.id}/profile`)).status, 404);
    parent = null;
    assert.equal((await call(`/parent/children/${kid.id}/profile`)).status, 401);

    // Unit rules.
    assert.equal(profileProblem({ ...Object.fromEntries(Object.keys(details).map((k) => [k, ""])), dateOfBirth: "1985-01-01" } as never), "Check the date of birth.");
  } finally {
    server.close();
    const ids = (await db.select({ id: portalStudents.id }).from(portalStudents).where(like(portalStudents.studentId, `${marker}%`))).map((s) => s.id);
    if (ids.length) {
      await db.delete(studentProfiles).where(inArray(studentProfiles.studentId, ids));
      await db.delete(portalSessions).where(inArray(portalSessions.studentId, ids));
    }
    await db.delete(portalStudents).where(like(portalStudents.studentId, `${marker}%`));
    if (classIds.length) await db.delete(portalClasses).where(eq(portalClasses.id, classIds[0]));
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await pool.end();
  }
});
