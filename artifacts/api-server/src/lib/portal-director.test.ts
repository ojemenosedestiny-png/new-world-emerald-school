import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";
import { admissionApplicationsTable, db, directorReports, pool, portalAttendance, portalClasses, portalStudents } from "@workspace/db";
import directorRouter, { sendWeeklyDirectorReport } from "../routes/director";
import { mondayOf } from "./director";
import { schoolDate } from "./learning";

// Database checks for the Director dashboard: only the Director, real figures, and the weekly email sent once.
test("director: sole access, live figures and a once-a-week report", async () => {
  const keys = ["SCHOOL_ADMIN_EMAILS", "SCHOOL_DIRECTOR_EMAILS", "RESEND_API_KEY", "EMAIL_FROM", "PUBLIC_SITE_URL"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const marker = `QA-DIR-${randomUUID().slice(0, 8)}`.toUpperCase();
  const director = `director-${marker}@example.test`.toLowerCase();
  const admin = `admin-${marker}@example.test`.toLowerCase();
  process.env.SCHOOL_ADMIN_EMAILS = `${admin},${director}`;
  process.env.SCHOOL_DIRECTOR_EMAILS = director;
  delete process.env.RESEND_API_KEY;
  const classIds: number[] = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error() {}, warn() {}, info() {} } as unknown as typeof req.log;
    const who = req.headers["x-test-user"];
    if (typeof who === "string") {
      req.dbUser = { id: `synthetic-${who}` } as NonNullable<typeof req.dbUser>;
      req.identity = { email: who, emailVerified: true, mfa: true };
    }
    next();
  });
  app.use("/api", directorRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const get = async (who?: string): Promise<{ status: number; data: any }> => {
    const r = await fetch(root + "/director/overview", { headers: who ? { "X-Test-User": who } : {} });
    return { status: r.status, data: await r.json() };
  };
  const realFetch = globalThis.fetch;
  try {
    const [cls] = await db.insert(portalClasses).values({ name: marker + " JSS 1" }).returning();
    classIds.push(cls.id);
    const [a, b] = await db.insert(portalStudents).values([
      { studentId: marker + "-1", name: "Ada Obi", classId: cls.id, passwordHash: "x", mustChangePassword: false },
      { studentId: marker + "-2", name: "Bayo Ade", classId: cls.id, passwordHash: "x", mustChangePassword: false, accountStatus: "pending" },
    ]).returning();
    const today = schoolDate();
    await db.insert(portalAttendance).values([
      { classId: cls.id, studentId: a.id, date: today, status: "present" },
      { classId: cls.id, studentId: b.id, date: today, status: "absent" },
    ]);
    await db.insert(admissionApplicationsTable).values({ studentFirstName: marker, studentLastName: "Applicant", grade: "JSS 1", entryYear: "2027", guardianEmail: "parent@example.test", guardianPhone: "08000000000" });

    // Only the Director: not guests, not other administrators.
    assert.equal((await get()).status, 403);
    assert.equal((await get(admin)).status, 403, "another administrator is refused");
    const { status, data } = await get(director);
    assert.equal(status, 200, JSON.stringify(data));
    const row = data.attendance.byClass.find((c: { className: string }) => c.className === marker + " JSS 1");
    assert.deepEqual([row.rate, row.recorded], [50, 2]);
    assert.ok(data.attendance.absentToday >= 1);
    assert.ok(data.students.pendingActivation >= 1);
    assert.ok(data.admissions.newThisWeek >= 1 && data.admissions.awaitingReview >= 1);
    assert.ok(Array.isArray(data.highlights) && data.highlights.length > 0);

    // The Monday email: not without email set up, then exactly once per week.
    const monday = new Date("2026-10-26T06:30:00Z");
    await db.delete(directorReports).where(eq(directorReports.weekStart, mondayOf(monday)));
    assert.equal(await sendWeeklyDirectorReport(monday), false, "email not configured");
    process.env.RESEND_API_KEY = "test-key";
    process.env.EMAIL_FROM = "New World Emerald <office@example.test>";
    process.env.PUBLIC_SITE_URL = "https://school.example";
    const sent: { to: string; subject: string }[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { to: string[] | string; subject: string };
      sent.push({ to: Array.isArray(body.to) ? body.to[0] : body.to, subject: body.subject });
      return new Response(JSON.stringify({ id: "email-1" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    assert.equal(await sendWeeklyDirectorReport(new Date("2026-10-27T06:30:00Z")), false, "only on Monday");
    assert.equal(await sendWeeklyDirectorReport(monday), true);
    assert.equal(await sendWeeklyDirectorReport(new Date("2026-10-26T09:00:00Z")), false, "already sent this week");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, director);
    assert.match(sent[0].subject, /^Weekly school report/);
  } finally {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    await db.delete(directorReports).where(eq(directorReports.weekStart, mondayOf(new Date("2026-10-26T06:30:00Z"))));
    await db.delete(admissionApplicationsTable).where(like(admissionApplicationsTable.studentFirstName, `${marker}%`));
    if (classIds.length) {
      await db.delete(portalAttendance).where(inArray(portalAttendance.classId, classIds));
      await db.delete(portalStudents).where(inArray(portalStudents.classId, classIds));
      await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    }
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    await pool.end();
  }
});
