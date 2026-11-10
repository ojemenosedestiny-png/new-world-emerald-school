import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";
import { db, pool, portalAttempts, portalClasses, portalExams, portalFiles, portalScores, portalStudents, portalSubjects, portalTeachers, portalTerms } from "@workspace/db";
import portalRouter from "../routes/portal";
import { setApprovedIdentitiesForTest } from "./approved-identities";

// Database checks: one exam set for several classes at once (each its own copy, files included), and deleting
// classes and teachers without losing students, attempts or results.
test("exams for many classes; deleting classes and teachers", async () => {
  const marker = `QA-DEL-${randomUUID().slice(0, 8)}`.toUpperCase();
  const admin = `admin-${marker.toLowerCase()}@example.test`;
  const principal = `principal-${marker.toLowerCase()}@example.test`;
  const saved = Object.fromEntries(["SCHOOL_ADMIN_EMAILS", "SCHOOL_SUPER_ADMIN_EMAILS", "SCHOOL_EXAM_OFFICER_EMAILS", "SCHOOL_PRINCIPAL_EMAILS"].map((k) => [k, process.env[k]]));
  process.env.SCHOOL_ADMIN_EMAILS = admin;
  process.env.SCHOOL_SUPER_ADMIN_EMAILS = admin;
  delete process.env.SCHOOL_EXAM_OFFICER_EMAILS;
  process.env.SCHOOL_PRINCIPAL_EMAILS = principal;
  setApprovedIdentitiesForTest([[`id-${admin}`, { email: admin, mfa: true }], [`id-${principal}`, { email: principal, mfa: true }]]);
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
  const manage = async (body: unknown): Promise<{ status: number; data: any }> => {
    const r = await fetch(root + "/manage", { method: "POST", headers: { "Content-Type": "application/json", "X-Test-User": admin }, body: JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const classIds: number[] = [];
  const termIds: number[] = [];
  try {
    const made = await db.insert(portalClasses).values([`${marker} Year 11 Gold`, `${marker} Year 11 Blue`, `${marker} Year 12 Gold`, `${marker} Empty`, `${marker} Results`, `${marker} Year 3 Ruby`].map((name) => ({ name }))).returning();
    classIds.push(...made.map((c) => c.id));
    const [y11g, y11b, y12, empty, results, y3] = made;

    // Moving a child: the office moves anyone; a principal moves only within their own school.
    const [mover] = await db.insert(portalStudents).values({ studentId: `${marker}-9`, name: "Chidi", classId: y11g.id, passwordHash: "x" }).returning();
    const moved = await manage({ action: "moveStudent", target: { id: mover.id }, toClassId: y12.id });
    assert.equal(moved.status, 200, JSON.stringify(moved.data));
    assert.match(moved.data.message, /Year 11 Gold to .*Year 12 Gold/);
    assert.equal((await manage({ action: "moveStudent", target: { id: mover.id }, toClassId: y12.id })).status, 409, "already there");
    const asPrincipal = (body: unknown) => fetch(root + "/principal", { method: "POST", headers: { "Content-Type": "application/json", "X-Test-User": principal }, body: JSON.stringify(body) });
    assert.equal((await asPrincipal({ action: "moveStudent", classId: y11g.id, studentId: mover.id })).status, 200);
    assert.equal((await asPrincipal({ action: "moveStudent", classId: y3.id, studentId: mover.id })).status, 403, "primary is not the secondary principal's");
    assert.equal((await db.select().from(portalStudents).where(eq(portalStudents.id, mover.id)))[0].classId, y11g.id);
    const overview = await (await fetch(root + "/principal?section=secondary", { headers: { "X-Test-User": principal } })).json() as { students: { id: number }[] };
    assert.ok(overview.students.some((s: { id: number }) => s.id === mover.id));
    await db.delete(portalStudents).where(eq(portalStudents.id, mover.id));

    // One exam, three classes: each gets its own copy, and the PDF record is copied for each class.
    const fileId = randomUUID();
    await db.insert(portalFiles).values({ id: fileId, classId: y11g.id, objectName: `${marker}-paper.pdf` });
    const start = new Date(Date.now() + 3_600_000), end = new Date(Date.now() + 7_200_000);
    const exam = { title: `${marker} SST mid-term`, subject: "Social Studies", classId: y11g.id, durationMinutes: 40, startsAt: start.toISOString(), endsAt: end.toISOString(), mode: "pdf", fileId, instructions: "", questions: [{ id: "q1", type: "mcq", text: "1", options: ["A", "B"], correctAnswer: 0, marks: 1 }], published: false, resultsReleased: false };
    const saved3 = await manage({ action: "saveExam", exam, alsoClassIds: [y11b.id, y12.id, y11g.id] });
    assert.equal(saved3.status, 200, JSON.stringify(saved3.data));
    assert.match(saved3.data.message, /3 classes/);
    const copies = await db.select().from(portalExams).where(like(portalExams.title, `${marker}%`));
    assert.deepEqual(copies.map((e) => e.classId).sort(), [y11g.id, y11b.id, y12.id].sort());
    const files = await db.select().from(portalFiles).where(inArray(portalFiles.id, copies.map((e) => e.fileId!)));
    assert.equal(new Set(files.map((f) => f.id)).size, 3);
    for (const e of copies) assert.equal(files.find((f) => f.id === e.fileId)?.classId, e.classId, "each copy's PDF belongs to its class");
    assert.ok(files.every((f) => f.objectName === `${marker}-paper.pdf`));

    // A class with students cannot be deleted.
    await db.insert(portalStudents).values({ studentId: `${marker}-1`, name: "Ada", classId: y11b.id, passwordHash: "x", active: false });
    assert.equal((await manage({ action: "deleteClass", target: { id: y11b.id } })).status, 409);
    // A class whose exam was taken cannot be deleted.
    await db.delete(portalStudents).where(eq(portalStudents.studentId, `${marker}-1`));
    const [taker] = await db.insert(portalStudents).values({ studentId: `${marker}-2`, name: "Bayo", classId: y12.id, passwordHash: "x" }).returning();
    const y12exam = copies.find((e) => e.classId === y12.id)!;
    await db.insert(portalAttempts).values({ examId: y12exam.id, studentId: taker.id, questions: [], answers: {}, deadline: end, status: "submitted" } as typeof portalAttempts.$inferInsert);
    await db.update(portalStudents).set({ classId: y11g.id }).where(eq(portalStudents.id, taker.id));
    assert.equal((await manage({ action: "deleteClass", target: { id: y12.id } })).status, 409);
    // A class with saved results cannot be deleted.
    const [term] = await db.insert(portalTerms).values({ session: `${marker}`, term: "First Term" }).returning();
    termIds.push(term.id);
    const [subject] = await db.insert(portalSubjects).values({ classId: results.id, name: "Maths" }).returning();
    await db.insert(portalScores).values({ termId: term.id, studentId: taker.id, subjectId: subject.id, ca: 10 });
    assert.equal((await manage({ action: "deleteClass", target: { id: results.id } })).status, 409);

    // An empty class (and one whose exam nobody took) goes, with its set-up, and leaves teachers' lists.
    const [teacher] = await db.insert(portalTeachers).values({ email: `t-${marker.toLowerCase()}@example.test`, name: `${marker} Teacher`, classIds: [y11b.id, empty.id, y11g.id] }).returning();
    await db.insert(portalSubjects).values({ classId: empty.id, name: "English", teacherId: teacher.id });
    assert.equal((await manage({ action: "deleteClass", target: { id: empty.id } })).status, 200);
    assert.equal((await manage({ action: "deleteClass", target: { id: y11b.id } })).status, 200);
    assert.equal((await db.select().from(portalClasses).where(inArray(portalClasses.id, [empty.id, y11b.id]))).length, 0);
    assert.equal((await db.select().from(portalExams).where(eq(portalExams.classId, y11b.id))).length, 0);
    assert.deepEqual((await db.select().from(portalTeachers).where(eq(portalTeachers.id, teacher.id)))[0].classIds, [y11g.id]);
    assert.equal((await manage({ action: "deleteClass", target: { id: empty.id } })).status, 404);

    // Deleting a teacher removes their access and frees the subjects they taught.
    await db.update(portalSubjects).set({ teacherId: teacher.id }).where(eq(portalSubjects.id, subject.id));
    assert.equal((await manage({ action: "deleteTeacher", target: { id: teacher.id } })).status, 200);
    assert.equal((await db.select().from(portalTeachers).where(eq(portalTeachers.id, teacher.id))).length, 0);
    assert.equal((await db.select().from(portalSubjects).where(eq(portalSubjects.id, subject.id)))[0].teacherId, null);
    assert.equal((await manage({ action: "deleteTeacher", target: { id: teacher.id } })).status, 404);
  } finally {
    server.close();
    const studs = await db.select({ id: portalStudents.id }).from(portalStudents).where(like(portalStudents.studentId, `${marker}%`));
    const exams = await db.select({ id: portalExams.id }).from(portalExams).where(like(portalExams.title, `${marker}%`));
    if (exams.length) await db.delete(portalAttempts).where(inArray(portalAttempts.examId, exams.map((e) => e.id)));
    if (studs.length) await db.delete(portalScores).where(inArray(portalScores.studentId, studs.map((s) => s.id)));
    if (exams.length) await db.delete(portalExams).where(inArray(portalExams.id, exams.map((e) => e.id)));
    if (classIds.length) {
      await db.delete(portalSubjects).where(inArray(portalSubjects.classId, classIds));
      await db.delete(portalFiles).where(inArray(portalFiles.classId, classIds));
    }
    await db.delete(portalStudents).where(like(portalStudents.studentId, `${marker}%`));
    await db.delete(portalTeachers).where(like(portalTeachers.name, `${marker}%`));
    if (termIds.length) await db.delete(portalTerms).where(inArray(portalTerms.id, termIds));
    if (classIds.length) await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await pool.end();
  }
});
