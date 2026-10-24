import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { db, pool, portalAttendance, portalClasses, portalImages, portalSessions, portalStudents } from "@workspace/db";
import portalRouter from "../routes/portal";
import { hashPassword } from "./portal-auth";
import { useMemoryImageStore } from "./images";
import { addDays, schoolDate } from "./learning";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 3)]);

// Database checks for the register and assignments, including who may see what.
test("learning: attendance register, summaries, assignments, submissions and marking", async () => {
  const saved = process.env.SCHOOL_ADMIN_EMAILS;
  const marker = `QA-LRN-${randomUUID().slice(0, 8)}`.toUpperCase();
  process.env.SCHOOL_ADMIN_EMAILS = `admin-${marker}@example.test`.toLowerCase();
  useMemoryImageStore();
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
  async function call(path: string, method = "GET", body?: unknown, opts: { cookie?: string; admin?: boolean } = {}): Promise<{ status: number; data: any }> {
    const raw = Buffer.isBuffer(body);
    const r = await fetch(root + path, {
      method,
      headers: { ...(body ? { "Content-Type": raw ? "image/png" : "application/json" } : {}), ...(opts.cookie ? { Cookie: opts.cookie } : {}), ...(opts.admin ? { "X-Test-Admin": marker } : {}) },
      ...(body ? { body: raw ? new Uint8Array(body) : JSON.stringify(body) } : {}),
    });
    const type = r.headers.get("content-type") ?? "";
    return { status: r.status, data: type.includes("json") ? await r.json() : await r.arrayBuffer() };
  }
  const admin = { admin: true };
  try {
    const [mine] = await db.insert(portalClasses).values({ name: marker + " A" }).returning();
    const [other] = await db.insert(portalClasses).values({ name: marker + " B" }).returning();
    classIds.push(mine.id, other.id);
    const pw = await hashPassword("Learning-Pass-1");
    const [ada, bayo, chi] = await db.insert(portalStudents).values([
      { studentId: marker + "-1", name: "Ada Obi", classId: mine.id, passwordHash: pw, mustChangePassword: false },
      { studentId: marker + "-2", name: "Bayo Ade", classId: mine.id, passwordHash: pw, mustChangePassword: false },
      { studentId: marker + "-3", name: "Chi Eze", classId: other.id, passwordHash: pw, mustChangePassword: false },
    ]).returning();
    const login = async (id: string) => ({ cookie: (await fetch(root + "/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: id, password: "Learning-Pass-1" }) })).headers.get("set-cookie")!.split(";")[0] });
    const adaS = await login(ada.studentId), chiS = await login(chi.studentId);
    const today = schoolDate();
    const yesterday = addDays(today, -1);

    // Register: staff only, real dates, no future, only this class's students.
    assert.equal((await call(`/attendance?classId=${mine.id}&date=${today}`)).status, 401);
    assert.equal((await call(`/attendance?classId=${mine.id}&date=${today}`, "GET", undefined, adaS)).status, 403);
    const empty = await call(`/attendance?classId=${mine.id}&date=${today}`, "GET", undefined, admin);
    assert.deepEqual([empty.data.taken, empty.data.students.map((s: { name: string }) => s.name)], [false, ["Ada Obi", "Bayo Ade"]]);
    assert.equal((await call("/attendance", "PUT", { classId: mine.id, date: addDays(today, 1), records: [] }, admin)).status, 400, "no future registers");
    assert.equal((await call("/attendance", "PUT", { classId: mine.id, date: "2026-02-30", records: [] }, admin)).status, 400);
    assert.equal((await call("/attendance", "PUT", { classId: mine.id, date: today, records: [{ studentId: chi.id, status: "present" }] }, admin)).status, 400, "student from another class");
    const saved1 = await call("/attendance", "PUT", { classId: mine.id, date: yesterday, records: [{ studentId: ada.id, status: "present" }, { studentId: bayo.id, status: "absent", note: "Sick" }] }, admin);
    assert.equal(saved1.status, 200, JSON.stringify(saved1.data));
    assert.equal(saved1.data.taken, true);
    await call("/attendance", "PUT", { classId: mine.id, date: today, records: [{ studentId: ada.id, status: "late" }, { studentId: bayo.id, status: "present" }] }, admin);
    // Saving again updates rather than duplicating.
    await call("/attendance", "PUT", { classId: mine.id, date: today, records: [{ studentId: bayo.id, status: "excused" }] }, admin);
    const rows = await db.select().from(portalAttendance).where(eq(portalAttendance.classId, mine.id));
    assert.equal(rows.length, 4);

    // Summary for a range, and the student's own view.
    const summary = await call(`/attendance/summary?classId=${mine.id}&from=${yesterday}&to=${today}`, "GET", undefined, admin);
    assert.equal(summary.data.daysOpen, 2);
    const adaRow = summary.data.students.find((s: { id: number }) => s.id === ada.id);
    assert.deepEqual([adaRow.present, adaRow.late, adaRow.daysPresent], [1, 1, 2]);
    const bayoRow = summary.data.students.find((s: { id: number }) => s.id === bayo.id);
    assert.deepEqual([bayoRow.absent, bayoRow.excused, bayoRow.daysPresent], [1, 1, 0]);
    const mineView = await call("/attendance/me", "GET", undefined, adaS);
    assert.deepEqual([mineView.data.totals.daysPresent, mineView.data.records[0].date, mineView.data.records[0].status], [2, today, "late"]);
    assert.equal((await call("/attendance/me", "GET", undefined, chiS)).data.totals.daysRecorded, 0, "students only see their own");

    // Assignments: staff create; students see published ones for their class only.
    const due = new Date(Date.now() + 86_400_000).toISOString();
    assert.equal((await call("/assignments", "POST", { classId: mine.id, subject: "Maths", title: "Fractions", dueAt: due, maxScore: 10, published: true }, adaS)).status, 403);
    const a1 = await call("/assignments", "POST", { classId: mine.id, subject: "Maths", title: "Fractions", instructions: "Questions 1-5", dueAt: due, maxScore: 10, published: true }, admin);
    assert.equal(a1.status, 200, JSON.stringify(a1.data));
    assert.deepEqual([a1.data.className, a1.data.students, a1.data.submitted], [marker + " A", 2, 0]);
    const draft = (await call("/assignments", "POST", { classId: mine.id, subject: "English", title: "Draft", dueAt: due, maxScore: 5, published: false }, admin)).data;
    const list = (await call("/my-assignments", "GET", undefined, adaS)).data;
    assert.deepEqual(list.map((x: { title: string }) => x.title), ["Fractions"], "drafts are hidden");
    assert.deepEqual((await call("/my-assignments", "GET", undefined, chiS)).data, [], "other classes see nothing");

    // Submitting: text and/or own photos; photos stay private.
    assert.equal((await call(`/my-assignments/${a1.data.id}/submit`, "POST", { text: "  ", imageIds: [] }, adaS)).status, 400);
    const photo = (await call("/assignment-images", "POST", PNG, adaS)).data.imageId;
    const chiPhoto = (await call("/assignment-images", "POST", PNG, chiS)).data.imageId;
    assert.equal((await call(`/my-assignments/${a1.data.id}/submit`, "POST", { text: "", imageIds: [chiPhoto] }, adaS)).status, 400, "cannot use someone else's photo");
    assert.equal((await call(`/my-assignments/${draft.id}/submit`, "POST", { text: "x", imageIds: [] }, adaS)).status, 404, "drafts cannot be submitted");
    const sub = await call(`/my-assignments/${a1.data.id}/submit`, "POST", { text: "1/2 + 1/4 = 3/4", imageIds: [photo] }, adaS);
    assert.equal(sub.status, 200, JSON.stringify(sub.data));
    assert.deepEqual([sub.data.submission.text, sub.data.submission.imageIds, sub.data.submission.late], ["1/2 + 1/4 = 3/4", [photo], false]);
    assert.equal((await call(`/images/${photo}`, "GET", undefined, adaS)).status, 200, "the student sees their own photo");
    assert.equal((await call(`/images/${photo}`, "GET", undefined, chiS)).status, 404, "other students cannot");
    assert.equal((await call(`/images/${photo}`, "GET", undefined, admin)).status, 200, "staff can");
    // Editing replaces the answer and deletes a removed photo.
    await call(`/my-assignments/${a1.data.id}/submit`, "POST", { text: "Revised", imageIds: [] }, adaS);
    assert.equal((await db.select().from(portalImages).where(eq(portalImages.id, photo))).length, 0, "removed photo deleted");

    // Marking: staff see every student, score within the maximum, then the answer is locked.
    const subs = (await call(`/assignments/${a1.data.id}/submissions`, "GET", undefined, admin)).data;
    assert.deepEqual(subs.map((r: { name: string; submission: unknown }) => [r.name, Boolean(r.submission)]), [["Ada Obi", true], ["Bayo Ade", false]]);
    const subId = subs[0].submission.id;
    assert.equal((await call(`/submissions/${subId}/mark`, "POST", { score: 11, feedback: "" }, admin)).status, 400, "above the maximum");
    assert.equal((await call(`/submissions/${subId}/mark`, "POST", { score: 8, feedback: "Good work" }, adaS)).status, 403);
    assert.equal((await call(`/submissions/${subId}/mark`, "POST", { score: 8, feedback: " Good work " }, admin)).status, 200);
    const marked = (await call("/my-assignments", "GET", undefined, adaS)).data[0].submission;
    assert.deepEqual([marked.score, marked.feedback, Boolean(marked.markedAt)], [8, "Good work", true]);
    assert.equal((await call(`/my-assignments/${a1.data.id}/submit`, "POST", { text: "Too late to change", imageIds: [] }, adaS)).status, 409);
    const staffList = (await call("/assignments", "GET", undefined, admin)).data.find((x: { id: number }) => x.id === a1.data.id);
    assert.deepEqual([staffList.submitted, staffList.marked], [1, 1]);

    // A late submission is flagged; deleting the assignment removes its submissions.
    const past = await call("/assignments", "POST", { classId: mine.id, subject: "Science", title: "Overdue", dueAt: new Date(Date.now() - 3_600_000).toISOString(), maxScore: 5, published: true }, admin);
    const lateSub = await call(`/my-assignments/${past.data.id}/submit`, "POST", { text: "Sorry it is late", imageIds: [] }, adaS);
    assert.equal(lateSub.data.submission.late, true);
    assert.equal((await call(`/assignments/${past.data.id}`, "DELETE", undefined, admin)).status, 200);
    assert.equal((await call(`/assignments/${past.data.id}/submissions`, "GET", undefined, admin)).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    if (classIds.length) {
      const ids = (await db.select({ id: portalStudents.id }).from(portalStudents).where(inArray(portalStudents.classId, classIds))).map((s) => s.id);
      if (ids.length) await db.delete(portalSessions).where(inArray(portalSessions.studentId, ids));
      await db.delete(portalStudents).where(inArray(portalStudents.classId, classIds));
      await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    }
    await db.delete(portalImages).where(eq(portalImages.purpose, "assignment"));
    if (saved === undefined) delete process.env.SCHOOL_ADMIN_EMAILS; else process.env.SCHOOL_ADMIN_EMAILS = saved;
    await pool.end();
  }
});
