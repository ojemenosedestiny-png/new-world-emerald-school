import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";
import { db, pool, portalAuditLog, portalClasses, portalExams } from "@workspace/db";
import portalRouter from "../routes/portal";
import { setApprovedIdentitiesForTest } from "./approved-identities";
import { auditStaffChanges } from "./audit";

// Database checks for the exam officer: the final step before exams reach students, and their view of exam activity.
test("exam officer: publishes what staff send, re-reviews changes, and sees who opened the questions", async () => {
  const marker = `QA-EXO-${randomUUID().slice(0, 8)}`.toUpperCase();
  const lower = marker.toLowerCase();
  const office = `office-${lower}@example.test`, officer = `officer-${lower}@example.test`, boss = `boss-${lower}@example.test`, outsider = `parent-${lower}@example.test`;
  const saved = { admins: process.env.SCHOOL_ADMIN_EMAILS, supers: process.env.SCHOOL_SUPER_ADMIN_EMAILS, officers: process.env.SCHOOL_EXAM_OFFICER_EMAILS };
  process.env.SCHOOL_ADMIN_EMAILS = [boss, office].join(",");
  process.env.SCHOOL_SUPER_ADMIN_EMAILS = boss;
  delete process.env.SCHOOL_EXAM_OFFICER_EMAILS;
  setApprovedIdentitiesForTest([boss, office, officer].map((e) => [`id-${e}`, { email: e, mfa: true }]));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error() {}, warn() {}, info() {} } as unknown as typeof req.log;
    const who = req.headers["x-test-user"];
    if (typeof who === "string") {
      req.dbUser = { id: `id-${who}` } as NonNullable<typeof req.dbUser>;
      req.identity = { email: who, emailVerified: who !== outsider, mfa: true };
    }
    next();
  });
  app.use("/api", auditStaffChanges());
  app.use("/api/portal", portalRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/portal`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (path: string, who: string | null, body?: unknown): Promise<{ status: number; data: any }> => {
    const r = await fetch(root + path, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...(who ? { "X-Test-User": who } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  const wait = () => new Promise((r) => setTimeout(r, 150)); // audit rows are written once each response finishes
  const classIds: number[] = [];
  try {
    const [jss1] = await db.insert(portalClasses).values({ name: `${marker} JSS 1` }).returning();
    const [year3] = await db.insert(portalClasses).values({ name: `${marker} Year 3` }).returning();
    classIds.push(jss1.id, year3.id);
    const start = new Date(Date.now() + 86_400_000), end = new Date(Date.now() + 2 * 86_400_000);
    const exam = (title: string, classId: number, published: boolean, id?: number) => ({
      ...(id ? { id } : {}), title, subject: "Mathematics", classId, durationMinutes: 30, startsAt: start.toISOString(), endsAt: end.toISOString(), mode: "interactive", instructions: "",
      questions: [{ id: "q1", type: "mcq", text: "2 + 2?", options: ["3", "4"], correctAnswer: 1, marks: 2 }], published, resultsReleased: false,
      // A sender cannot approve their own exam.
      reviewStatus: "approved",
    });
    const save = (body: object) => call("/manage", office, { action: "saveExam", exam: body });
    const find = async (title: string) => (await db.select().from(portalExams).where(eq(portalExams.title, `${marker} ${title}`)))[0];

    // No exam officer yet: the office publishes straight to students, as before.
    assert.equal((await save(exam(`${marker} Before`, jss1.id, true))).status, 200);
    assert.deepEqual([(await find("Before")).published, (await find("Before")).reviewStatus], [true, ""]);
    assert.equal((await call("/manage", office)).data.examOfficer, false);

    process.env.SCHOOL_EXAM_OFFICER_EMAILS = officer;
    assert.equal((await call("/manage", office)).data.examOfficer, true);
    // Now "publish" sends it to the exam officer; the review fields sent are ignored.
    const sent = await save(exam(`${marker} Algebra`, jss1.id, true));
    assert.equal(sent.status, 200, JSON.stringify(sent.data));
    assert.equal(sent.data.message, "Saved and sent to the exam officer to publish.");
    let algebra = await find("Algebra");
    assert.deepEqual([algebra.published, algebra.reviewStatus, algebra.submittedBy], [false, "submitted", office]);
    await save(exam(`${marker} Phonics`, year3.id, false));
    const phonics = await find("Phonics");
    assert.equal(phonics.reviewStatus, "");

    // Who may open the exam officer's portal.
    assert.equal((await call("/exam-officer", null)).status, 401);
    assert.equal((await call("/exam-officer", office)).status, 403, "the office is not the exam officer");
    assert.equal((await call("/exam-officer", outsider)).status, 403);
    assert.equal((await call("/exam-officer", boss)).status, 200, "the super administrator may");
    const overview = await call("/exam-officer", officer);
    assert.equal(overview.status, 200, JSON.stringify(overview.data));
    const mine = (id: number) => overview.data.exams.find((e: { id: number }) => e.id === id);
    assert.deepEqual([mine(algebra.id).status, mine(algebra.id).section, mine(algebra.id).submittedBy], ["awaiting", "secondary", office]);
    assert.deepEqual([mine(phonics.id).status, mine(phonics.id).section], ["draft", "primary"]);
    assert.ok(overview.data.sections.find((s: { section: string; awaiting: number }) => s.section === "secondary").awaiting >= 1);

    // Staff open and copy questions; the exam officer sees it.
    assert.equal((await call(`/exams/${algebra.id}/access`, office, { kind: "open" })).status, 200);
    assert.equal((await call(`/exams/${algebra.id}/access`, office, { kind: "copy" })).status, 200);
    assert.equal((await call(`/exams/${algebra.id}/access`, office, { kind: "steal" })).status, 400);
    await wait();
    const paper = await call(`/exam-officer/exams/${algebra.id}`, officer);
    assert.equal(paper.status, 200, JSON.stringify(paper.data));
    assert.deepEqual(paper.data.questions.map((q: { correctAnswer: number | null }) => q.correctAnswer), [1]);
    assert.equal(paper.data.exam.opened, 2);
    const labels = paper.data.history.map((h: { label: string; who: string }) => h.label);
    assert.ok(labels.includes("Opened the questions") && labels.includes("Copied the questions") && labels.includes("Saved questions and asked to publish"), labels.join());

    // Publish; editing afterwards sends it back for review and takes it off students' screens.
    assert.equal((await call("/exam-officer", office, { action: "publish", examId: algebra.id })).status, 403);
    const published = await call("/exam-officer", officer, { action: "publish", examId: algebra.id });
    assert.equal(published.status, 200, JSON.stringify(published.data));
    algebra = await find("Algebra");
    assert.deepEqual([algebra.published, algebra.reviewStatus, algebra.reviewedBy], [true, "approved", officer]);
    assert.equal((await call("/exam-officer", officer, { action: "publish", examId: algebra.id })).status, 409);
    // Hiding and showing the approved exam again needs no new review.
    const status = (published: boolean) => call("/manage", office, { action: "examStatus", examStatus: { id: algebra.id, published, resultsReleased: false } });
    assert.equal((await status(false)).status, 200);
    assert.equal((await status(true)).status, 200);
    assert.equal((await find("Algebra")).published, true);
    await save(exam(`${marker} Algebra`, jss1.id, true, algebra.id));
    algebra = await find("Algebra");
    assert.deepEqual([algebra.published, algebra.reviewStatus], [false, "submitted"]);

    // Return needs a note, which the teacher sees; withdraw takes a published exam off students' screens.
    assert.equal((await call("/exam-officer", officer, { action: "return", examId: algebra.id })).status, 400);
    assert.equal((await call("/exam-officer", officer, { action: "return", examId: algebra.id, note: "Add the working for question 1" })).status, 200);
    algebra = await find("Algebra");
    assert.deepEqual([algebra.published, algebra.reviewStatus, algebra.reviewNote], [false, "returned", "Add the working for question 1"]);
    assert.equal((await call("/manage", office)).data.exams.find((e: { id: number }) => e.id === algebra.id).reviewNote, "Add the working for question 1");
    const before = await find("Before");
    assert.equal((await call("/exam-officer", officer, { action: "withdraw", examId: before.id })).status, 200);
    assert.equal((await find("Before")).published, false);
    // The office's publish now goes to the exam officer too.
    const again = await status(true);
    assert.equal(again.data.message, "Sent to the exam officer to publish.");
    assert.deepEqual([(await find("Algebra")).published, (await find("Algebra")).reviewStatus], [false, "submitted"]);

    // Activity: what each member of staff did with exams.
    await wait();
    const activity = await call("/exam-officer/activity", officer);
    assert.equal(activity.status, 200, JSON.stringify(activity.data));
    const officeDay = activity.data.staff.find((s: { email: string }) => s.email === office);
    assert.equal(officeDay.role, "office");
    assert.ok(officeDay.counts.submitted >= 2 && officeDay.counts.opened === 2 && officeDay.counts.saved >= 1, JSON.stringify(officeDay.counts));
    const officerDay = activity.data.staff.find((s: { email: string }) => s.email === officer);
    assert.deepEqual([officerDay.role, officerDay.counts.published, officerDay.counts.returned, officerDay.counts.withdrawn], ["exam officer", 1, 1, 1]);
    assert.ok(officerDay.counts.opened >= 1, "the exam officer's own visit to a paper is recorded");
    assert.ok(officerDay.events.some((e: { label: string; examTitle: string }) => e.label === "Published to students" && e.examTitle === `${marker} Algebra`));
    assert.equal((await call("/exam-officer/activity?from=2026-01-01&to=2026-12-31", officer)).status, 400, "at most three months at a time");
  } finally {
    server.close();
    const exams = classIds.length ? await db.select({ id: portalExams.id }).from(portalExams).where(inArray(portalExams.classId, classIds)) : [];
    if (classIds.length) await db.delete(portalExams).where(inArray(portalExams.classId, classIds));
    for (const e of exams) await db.delete(portalAuditLog).where(eq(portalAuditLog.action, `POST /portal/exams/${e.id}/access`));
    await db.delete(portalAuditLog).where(like(portalAuditLog.actorLabel, `%${lower}%`));
    if (classIds.length) await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    for (const [k, v] of [["SCHOOL_ADMIN_EMAILS", saved.admins], ["SCHOOL_SUPER_ADMIN_EMAILS", saved.supers], ["SCHOOL_EXAM_OFFICER_EMAILS", saved.officers]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    await pool.end();
  }
});
