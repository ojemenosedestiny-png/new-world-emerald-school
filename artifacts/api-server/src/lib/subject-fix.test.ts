import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";
import { db, pool, portalClasses, portalExams, portalScores, portalStudents, portalSubjects, portalTeachers, portalTerms } from "@workspace/db";
import portalRouter from "../routes/portal";
import { setApprovedIdentitiesForTest } from "./approved-identities";

// A subject misspelt in several classes ("Socail and Citizenship Studies"), already given teachers, and in one class
// next to the correct spelling: the principal fixes it everywhere at once without losing teachers or marks.
test("subject fix: rename everywhere, merge into the correct spelling, keep marks and teachers", async () => {
  const marker = `QA-SUB-${randomUUID().slice(0, 8)}`.toUpperCase();
  const m = marker.toLowerCase();
  const office = `office-${m}@example.test`, primary = `pp-${m}@example.test`;
  const keys = ["SCHOOL_ADMIN_EMAILS", "SCHOOL_SUPER_ADMIN_EMAILS", "SCHOOL_PRIMARY_PRINCIPAL_EMAILS"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.SCHOOL_ADMIN_EMAILS = office;
  process.env.SCHOOL_SUPER_ADMIN_EMAILS = office;
  process.env.SCHOOL_PRIMARY_PRINCIPAL_EMAILS = primary;
  setApprovedIdentitiesForTest([office, primary].map((e) => [`id-${e}`, { email: e, mfa: true }]));
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
  const post = async (path: string, who: string, body: unknown): Promise<{ status: number; data: any }> => {
    const r = await fetch(root + path, { method: "POST", headers: { "Content-Type": "application/json", "X-Test-User": who }, body: JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const WRONG = "Socail and Citizenship Studies", RIGHT = "Social and Citizenship Studies";
  const classIds: number[] = [];
  let termId = 0;
  try {
    const [y3a, y3b, y4, jss1] = await db.insert(portalClasses).values([`${marker} Year 3 Amber`, `${marker} Year 3 Jade`, `${marker} Year 4 Ruby`, `${marker} JSS 1 Gold`].map((name) => ({ name }))).returning();
    classIds.push(y3a.id, y3b.id, y4.id, jss1.id);
    const [mrs] = await db.insert(portalTeachers).values({ email: `t-${m}@example.test`, name: `${marker} Mrs Ade`, classIds: [] }).returning();
    const [aWrong, , bWrong, , sWrong] = await db.insert(portalSubjects).values([
      { classId: y3a.id, name: WRONG, teacherId: mrs.id }, { classId: y3a.id, name: RIGHT, teacherId: null },
      { classId: y3b.id, name: WRONG, teacherId: mrs.id }, { classId: y4.id, name: "Mathematics" },
      { classId: jss1.id, name: WRONG },
    ]).returning();
    const [kid] = await db.insert(portalStudents).values({ studentId: `${marker}-1`, name: "Ada", classId: y3b.id, passwordHash: "x" }).returning();
    const [term] = await db.insert(portalTerms).values({ session: marker, term: "First Term" }).returning();
    termId = term.id;
    await db.insert(portalScores).values({ termId, studentId: kid.id, subjectId: bWrong.id, ca: 70, exam: 80 });
    await db.insert(portalExams).values({ title: `${marker} test`, subject: "socail  and citizenship studies", classId: y3b.id, durationMinutes: 30, startsAt: new Date(), endsAt: new Date(Date.now() + 3_600_000), mode: "interactive", questions: [] } as typeof portalExams.$inferInsert);

    // Removing is refused where marks exist, and reported.
    const removeTry = await post("/principal", primary, { action: "removeSubject", classId: y3a.id, subjectName: WRONG });
    assert.equal(removeTry.status, 200);
    assert.match(removeTry.data.message, /removed from 1 class.*Not changed in .*Year 3 Jade \(marks have been entered for it\)/);
    // Put Year 3 Amber's back for the rename test.
    const [aWrong2] = await db.insert(portalSubjects).values({ classId: y3a.id, name: WRONG, teacherId: mrs.id }).returning();
    void aWrong;

    // The primary principal corrects the spelling everywhere in primary.
    assert.equal((await post("/principal", primary, { action: "renameSubject", classId: y3a.id, subjectName: WRONG, newSubjectName: "  " })).status, 400);
    const fixed = await post("/principal", primary, { action: "renameSubject", classId: y3a.id, subjectName: WRONG, newSubjectName: RIGHT });
    assert.equal(fixed.status, 200, JSON.stringify(fixed.data));
    assert.match(fixed.data.message, /renamed to Social and Citizenship Studies in 1 class; merged into Social and Citizenship Studies in 1 class/);
    const left = await db.select().from(portalSubjects).where(inArray(portalSubjects.classId, classIds));
    const inClass = (id: number) => left.filter((s) => s.classId === id).map((s) => s.name).sort();
    assert.deepEqual(inClass(y3a.id), [RIGHT], "merged: one subject left");
    assert.equal(left.find((s) => s.classId === y3a.id)!.teacherId, mrs.id, "the teacher moved to the correct subject");
    assert.ok(!left.some((s) => s.id === aWrong2.id));
    assert.deepEqual(inClass(y3b.id), [RIGHT], "renamed in place");
    assert.equal(left.find((s) => s.classId === y3b.id)!.id, bWrong.id, "same subject, so its marks stay");
    assert.equal((await db.select().from(portalScores).where(eq(portalScores.subjectId, bWrong.id))).length, 1);
    assert.equal((await db.select().from(portalExams).where(like(portalExams.title, `${marker}%`)))[0].subject, RIGHT, "CBT exams relabelled");
    assert.deepEqual(inClass(jss1.id), [WRONG], "secondary is the other principal's");
    void sWrong;

    // The office renaming onto an existing subject in one class merges instead of refusing.
    const [dup] = await db.insert(portalSubjects).values({ classId: y4.id, name: "Mathmatics" }).returning();
    const merged = await post("/reports/manage", office, { action: "saveSubject", subject: { id: dup.id, classId: y4.id, name: "Mathematics" } });
    assert.equal(merged.status, 200, JSON.stringify(merged.data));
    assert.deepEqual((await db.select().from(portalSubjects).where(eq(portalSubjects.classId, y4.id))).map((s) => s.name), ["Mathematics"]);
  } finally {
    server.close();
    if (termId) { await db.delete(portalScores).where(eq(portalScores.termId, termId)); await db.delete(portalTerms).where(eq(portalTerms.id, termId)); }
    await db.delete(portalExams).where(like(portalExams.title, `${marker}%`));
    await db.delete(portalStudents).where(like(portalStudents.studentId, `${marker}%`));
    if (classIds.length) { await db.delete(portalSubjects).where(inArray(portalSubjects.classId, classIds)); await db.delete(portalClasses).where(inArray(portalClasses.id, classIds)); }
    await db.delete(portalTeachers).where(like(portalTeachers.name, `${marker}%`));
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await pool.end();
  }
});
