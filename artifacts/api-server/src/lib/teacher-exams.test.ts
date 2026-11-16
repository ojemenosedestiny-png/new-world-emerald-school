import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";
import { db, pool, portalClasses, portalExams, portalTeachers } from "@workspace/db";
import portalRouter from "../routes/portal";
import { setStaffEmailResolverForTest } from "./portal-auth";

// A teacher may set an exam for any class (not only the ones the principal assigned them) and manage the exams they
// set; another teacher's exam in a class they do not teach stays out of reach.
test("teachers set exams for any class and manage the ones they set", async () => {
  const marker = `QA-TEX-${randomUUID().slice(0, 8)}`.toUpperCase();
  const m = marker.toLowerCase();
  const musa = `musa-${m}@example.test`, ngozi = `ngozi-${m}@example.test`;
  setStaffEmailResolverForTest(async (req) => (typeof req.headers["x-test-teacher"] === "string" ? req.headers["x-test-teacher"] : null));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error() {}, warn() {}, info() {} } as unknown as typeof req.log;
    if (typeof req.headers["x-test-teacher"] === "string") req.dbUser = { id: `id-${req.headers["x-test-teacher"]}` } as NonNullable<typeof req.dbUser>;
    next();
  });
  app.use("/api/portal", portalRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/portal`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (who: string, body?: unknown): Promise<{ status: number; data: any }> => {
    const r = await fetch(root + "/manage", { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", "X-Test-Teacher": who }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const classIds: number[] = [];
  try {
    const [own, other, other2] = await db.insert(portalClasses).values([`${marker} JSS 1 Amber`, `${marker} JSS 2 Jade`, `${marker} JSS 2 Ruby`].map((name) => ({ name }))).returning();
    classIds.push(own.id, other.id, other2.id);
    await db.insert(portalTeachers).values([
      { email: musa, name: `${marker} Mr Musa`, classIds: [own.id] },
      { email: ngozi, name: `${marker} Mrs Ngozi`, classIds: [] },
    ]);
    const exam = (classId: number, title: string) => ({
      title, subject: "Mathematics", classId, durationMinutes: 20,
      startsAt: new Date(Date.now() + 86_400_000).toISOString(), endsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      mode: "interactive", fileId: null, instructions: "", published: false, resultsReleased: false,
      questions: [{ id: "q1", type: "mcq", text: "2 + 2", options: ["3", "4"], correctAnswer: 1, marks: 1 }],
    });

    // Every class is offered for exams, not only the teacher's own.
    const before = await call(musa);
    assert.equal(before.status, 200, JSON.stringify(before.data));
    assert.deepEqual(before.data.classes.map((c: { id: number }) => c.id).filter((id: number) => classIds.includes(id)), [own.id], "their own classes stay as they are");
    assert.ok([own.id, other.id, other2.id].every((id) => before.data.examClasses.some((c: { id: number }) => c.id === id)), "every class for exams");

    // Mr Musa sets an exam for a class he does not teach, and for its year group at once.
    const saved = await call(musa, { action: "saveExam", exam: exam(other.id, `${marker} Musa`), alsoClassIds: [other2.id] });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const mine = await db.select().from(portalExams).where(like(portalExams.title, `${marker} Musa`));
    assert.deepEqual(mine.map((e) => e.classId).sort(), [other.id, other2.id].sort());
    const [teacher] = await db.select().from(portalTeachers).where(eq(portalTeachers.email, musa));
    assert.ok(mine.every((e) => e.createdByTeacherId === teacher.id));

    // He sees and manages the exams he set there.
    const after = await call(musa);
    assert.ok(mine.every((e) => after.data.exams.some((x: { id: number }) => x.id === e.id)), "his exams in other classes are listed");
    assert.equal((await call(musa, { action: "saveExam", exam: { ...exam(other.id, `${marker} Musa`), id: mine[0].id, classId: mine[0].classId, instructions: "Show working." } })).status, 200);
    assert.equal((await call(musa, { action: "examStatus", examStatus: { id: mine[0].id, published: true, resultsReleased: false } })).status, 200);

    // Mrs Ngozi's exam in that class is not his.
    assert.equal((await call(ngozi, { action: "saveExam", exam: exam(other.id, `${marker} Ngozi`) })).status, 200);
    const [hers] = await db.select().from(portalExams).where(eq(portalExams.title, `${marker} Ngozi`));
    assert.equal((await call(musa, { action: "examStatus", examStatus: { id: hers.id, published: true, resultsReleased: false } })).status, 403);
    assert.equal((await call(musa, { action: "deleteExam", target: { id: hers.id } })).status, 403);
    assert.ok(!(await call(musa)).data.exams.some((x: { id: number }) => x.id === hers.id), "not listed for him");
    assert.equal((await call(ngozi, { action: "deleteExam", target: { id: hers.id } })).status, 200, "she can remove her own");

    // A class that does not exist is refused.
    assert.equal((await call(musa, { action: "saveExam", exam: exam(2_000_000_000, `${marker} Nowhere`) })).status, 404);
  } finally {
    server.close();
    setStaffEmailResolverForTest(null);
    if (classIds.length) await db.delete(portalExams).where(inArray(portalExams.classId, classIds));
    await db.delete(portalTeachers).where(like(portalTeachers.name, `${marker}%`));
    if (classIds.length) await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    await pool.end();
  }
});
