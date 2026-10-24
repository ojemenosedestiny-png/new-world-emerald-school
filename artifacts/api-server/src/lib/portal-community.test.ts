import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { inArray } from "drizzle-orm";
import { db, pool, portalClasses, portalEvents, portalSessions, portalStudents, portalTeachers } from "@workspace/db";
import portalRouter from "../routes/portal";
import { hashPassword } from "./portal-auth";

// Database-only checks for the student community features: calendar events and the staff directory.
test("community: events by class, admin-only writes, and a contact-free staff directory", async () => {
  const saved = process.env.SCHOOL_ADMIN_EMAILS;
  const marker = `QA-COM-${randomUUID().slice(0, 8)}`.toUpperCase();
  process.env.SCHOOL_ADMIN_EMAILS = `admin-${marker}@example.test`.toLowerCase();
  const classIds: number[] = [];
  const teacherIds: number[] = [];
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
  async function call(path: string, method = "GET", body?: unknown, opts: { cookie?: string; admin?: boolean } = {}): Promise<{ status: number; cookie: string; data: any }> {
    const r = await fetch(root + path, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(opts.cookie ? { Cookie: opts.cookie } : {}), ...(opts.admin ? { "X-Test-Admin": marker } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "", data: await r.json() };
  }
  const admin = { admin: true };
  try {
    const [mine] = await db.insert(portalClasses).values({ name: marker + " A" }).returning();
    const [other] = await db.insert(portalClasses).values({ name: marker + " B" }).returning();
    classIds.push(mine.id, other.id);
    await db.insert(portalStudents).values({ studentId: marker, name: "Ada Obi", classId: mine.id, passwordHash: await hashPassword("Community-Pass-1"), mustChangePassword: false });
    const login = await call("/session", "POST", { studentId: marker, password: "Community-Pass-1" });
    assert.equal(login.status, 200);
    const student = { cookie: login.cookie };

    // Only administrators write; guests cannot read.
    const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
    const base = { details: "Bring water", venue: "Sports field", category: "sports", allDay: false, published: true };
    assert.equal((await call("/events")).status, 401);
    assert.equal((await call("/events", "POST", { ...base, title: "Sneaky", startsAt: day(1) }, student)).status, 403);
    assert.equal((await call("/events", "POST", { ...base, title: "  ", startsAt: day(1) }, admin)).status, 400);
    assert.equal((await call("/events", "POST", { ...base, title: "Backwards", startsAt: day(2), endsAt: day(1) }, admin)).status, 400);
    assert.equal((await call("/events", "POST", { ...base, title: "Ghost class", startsAt: day(1), classId: 2_000_000_000 }, admin)).status, 404);

    const school = await call("/events", "POST", { ...base, title: `${marker} Sports day`, startsAt: day(3), endsAt: day(3.2) }, admin);
    assert.equal(school.status, 200, JSON.stringify(school.data));
    assert.equal(school.data.className, null);
    const ours = await call("/events", "POST", { ...base, title: `${marker} Class trip`, startsAt: day(5), classId: mine.id, category: "academic" }, admin);
    assert.equal(ours.data.className, marker + " A");
    await call("/events", "POST", { ...base, title: `${marker} Other trip`, startsAt: day(5), classId: other.id }, admin);
    const draft = await call("/events", "POST", { ...base, title: `${marker} Draft`, startsAt: day(6), published: false }, admin);

    // Students see published events for the whole school and their own class only.
    const seen = (await call("/events", "GET", undefined, student)).data.filter((e: { title: string }) => e.title.startsWith(marker)).map((e: { title: string }) => e.title);
    assert.deepEqual(seen, [`${marker} Sports day`, `${marker} Class trip`], "sorted by start, no drafts or other classes");
    const all = (await call("/events", "GET", undefined, admin)).data.filter((e: { title: string }) => e.title.startsWith(marker));
    assert.equal(all.length, 4, "administrators see everything");

    // Edit and delete.
    const edited = await call(`/events/${draft.data.id}`, "PUT", { ...base, title: `${marker} Draft now live`, startsAt: day(6), published: true }, admin);
    assert.equal(edited.data.published, true);
    assert.equal((await call(`/events/${draft.data.id}`, "PUT", { ...base, title: "x", startsAt: day(6) }, student)).status, 403);
    assert.equal((await call(`/events/2000000000`, "PUT", { ...base, title: "x", startsAt: day(6) }, admin)).status, 404);
    assert.equal((await call(`/events/${draft.data.id}`, "DELETE", undefined, student)).status, 403);
    assert.equal((await call(`/events/${draft.data.id}`, "DELETE", undefined, admin)).status, 200);
    assert.equal((await call(`/events/${draft.data.id}`, "DELETE", undefined, admin)).status, 404);

    // Directory: admin edits title and subjects through saveTeacher; email never leaves the server.
    const save = (teacher: Record<string, unknown>) => call("/manage", "POST", { action: "saveTeacher", teacher }, admin);
    assert.equal((await save({ email: `t1-${marker}@example.test`, name: "Mrs Bello", classIds: [mine.id], active: true, title: "Class Teacher", subjects: [" Mathematics ", "mathematics", "Basic Science", ""] })).status, 200);
    assert.equal((await save({ email: `t2-${marker}@example.test`, name: "Mr Hidden", classIds: [], active: true, showInDirectory: false })).status, 200);
    assert.equal((await save({ email: `t3-${marker}@example.test`, name: "Mr Former", classIds: [], active: false })).status, 200);
    const rows = await db.select().from(portalTeachers).where(inArray(portalTeachers.email, [1, 2, 3].map((n) => `t${n}-${marker}@example.test`.toLowerCase())));
    teacherIds.push(...rows.map((r) => r.id));
    const bello = rows.find((r) => r.name === "Mrs Bello")!;
    assert.deepEqual(bello.subjects, ["Mathematics", "Basic Science"], "trimmed and de-duplicated");

    // Saving without the directory fields (older screens) keeps them.
    await save({ id: bello.id, email: bello.email, name: "Mrs Bello", classIds: [mine.id], active: true });
    const directory = await call("/staff-directory", "GET", undefined, student);
    assert.equal(directory.status, 200);
    const listed = directory.data.filter((t: { id: number }) => teacherIds.includes(t.id));
    assert.deepEqual(listed, [{ id: bello.id, name: "Mrs Bello", title: "Class Teacher", subjects: ["Mathematics", "Basic Science"], classNames: [marker + " A"], photoId: null }]);
    assert.ok(!JSON.stringify(directory.data).includes("@"), "no email addresses in the directory");
    assert.equal((await call("/staff-directory")).status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    if (teacherIds.length) await db.delete(portalTeachers).where(inArray(portalTeachers.id, teacherIds));
    if (classIds.length) {
      await db.delete(portalEvents).where(inArray(portalEvents.classId, classIds));
      const ids = (await db.select({ id: portalStudents.id }).from(portalStudents).where(inArray(portalStudents.classId, classIds))).map((s) => s.id);
      if (ids.length) await db.delete(portalSessions).where(inArray(portalSessions.studentId, ids));
      await db.delete(portalStudents).where(inArray(portalStudents.classId, classIds));
      await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    }
    const leftovers = (await db.select({ id: portalEvents.id, title: portalEvents.title }).from(portalEvents)).filter((e) => e.title.startsWith(marker)).map((e) => e.id);
    if (leftovers.length) await db.delete(portalEvents).where(inArray(portalEvents.id, leftovers));
    if (saved === undefined) delete process.env.SCHOOL_ADMIN_EMAILS; else process.env.SCHOOL_ADMIN_EMAILS = saved;
    await pool.end();
  }
});
