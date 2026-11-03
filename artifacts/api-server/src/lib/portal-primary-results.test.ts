import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";
import { db, pool, portalClasses, portalScores, portalStudents, portalSubjects, portalTerms } from "@workspace/db";
import portalRouter from "../routes/portal";
import { setApprovedIdentitiesForTest } from "./approved-identities";
import { hashPassword } from "./portal-auth";

// Database checks for primary results (Year 1 to 6): Mid-term and End-term out of 100, final = average, no positions.
test("primary results: two marks out of 100, averaged, no positions; secondary unchanged", async () => {
  const marker = `QA-PRI-${randomUUID().slice(0, 8)}`.toUpperCase();
  const office = `office-${marker.toLowerCase()}@example.test`;
  const saved = { admins: process.env.SCHOOL_ADMIN_EMAILS, supers: process.env.SCHOOL_SUPER_ADMIN_EMAILS };
  process.env.SCHOOL_ADMIN_EMAILS = office;
  process.env.SCHOOL_SUPER_ADMIN_EMAILS = office;
  setApprovedIdentitiesForTest([[`id-${office}`, { email: office, mfa: true }]]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error() {}, warn() {}, info() {} } as unknown as typeof req.log;
    req.dbUser = { id: `id-${office}` } as NonNullable<typeof req.dbUser>;
    req.identity = { email: office, emailVerified: true, mfa: true };
    next();
  });
  app.use("/api/portal", portalRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/portal`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (path: string, body?: unknown): Promise<{ status: number; data: any }> => {
    const r = await fetch(root + path, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  const classIds: number[] = [];
  let termId = 0;
  try {
    const [year2] = await db.insert(portalClasses).values({ name: `${marker} Year 2` }).returning();
    const [jss1] = await db.insert(portalClasses).values({ name: `${marker} JSS 1` }).returning();
    classIds.push(year2.id, jss1.id);
    const [term] = await db.insert(portalTerms).values({ session: "2093/2094", term: marker, caMax: 20, ca2Max: 20, examMax: 60 }).returning();
    termId = term.id;
    const [maths] = await db.insert(portalSubjects).values({ classId: year2.id, name: "Mathematics" }).returning();
    const [english] = await db.insert(portalSubjects).values({ classId: year2.id, name: "English" }).returning();
    const [jssMaths] = await db.insert(portalSubjects).values({ classId: jss1.id, name: "Mathematics" }).returning();
    const pw = await hashPassword("Primary-Test-1");
    const [ada] = await db.insert(portalStudents).values({ studentId: `${marker}-1`, name: "Ada Obi", classId: year2.id, passwordHash: pw }).returning();
    const [ben] = await db.insert(portalStudents).values({ studentId: `${marker}-2`, name: "Ben Uche", classId: year2.id, passwordHash: pw }).returning();
    const [kemi] = await db.insert(portalStudents).values({ studentId: `${marker}-3`, name: "Kemi Ade", classId: jss1.id, passwordHash: pw }).returning();
    const scores = (entries: object[]) => call("/reports/manage", { action: "saveScores", scores: { termId, entries } });

    // Primary marks are out of 100 even though the term's CA is out of 20 and its exam out of 60.
    const ok = await scores([
      { studentId: ada.id, subjectId: maths.id, ca: 80, exam: 90 }, { studentId: ada.id, subjectId: english.id, ca: 60, exam: 71 },
      { studentId: ben.id, subjectId: maths.id, ca: 90, exam: 95 },
    ]);
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal((await scores([{ studentId: ada.id, subjectId: maths.id, ca: 100.5, exam: 90 }])).status, 400);
    assert.equal((await scores([{ studentId: ada.id, subjectId: maths.id, ca: 80, ca2: 10, exam: 90 }])).status, 400, "primary has no CA 2");
    // Secondary keeps the term's maxima.
    assert.equal((await scores([{ studentId: kemi.id, subjectId: jssMaths.id, ca: 80, exam: 50 }])).status, 400);
    assert.equal((await scores([{ studentId: kemi.id, subjectId: jssMaths.id, ca: 18, ca2: 15, exam: 50 }])).status, 200);

    const ws = await call(`/reports/manage?termId=${termId}&classId=${year2.id}`);
    assert.equal(ws.status, 200, JSON.stringify(ws.data));
    assert.equal(ws.data.scheme, "primary");
    const adaResult = ws.data.results.find((r: { studentId: number }) => r.studentId === ada.id);
    assert.deepEqual(adaResult.subjects.map((x: { total: number }) => x.total).sort(), [65.5, 85]);
    assert.deepEqual([adaResult.average, adaResult.position], [75.3, null]);
    assert.equal(ws.data.results.find((r: { studentId: number }) => r.studentId === ben.id).position, null);
    const jssWs = await call(`/reports/manage?termId=${termId}&classId=${jss1.id}`);
    assert.deepEqual([jssWs.data.scheme, jssWs.data.results.find((r: { studentId: number }) => r.studentId === kemi.id).position], ["secondary", 1]);

    // Editing the term's maxima is checked against secondary marks only.
    const edit = (caMax: number) => call("/reports/manage", { action: "saveTerm", term: { id: termId, session: "2093/2094", term: marker, caMax, ca2Max: 20, examMax: 60 } });
    assert.equal((await edit(18)).status, 200, "primary marks of 80 do not block a CA of 18");
    assert.equal((await edit(10)).status, 409, "a secondary CA of 18 does block a CA of 10");
  } finally {
    server.close();
    if (termId) { await db.delete(portalScores).where(eq(portalScores.termId, termId)); await db.delete(portalTerms).where(eq(portalTerms.id, termId)); }
    await db.delete(portalStudents).where(like(portalStudents.studentId, `${marker}%`));
    if (classIds.length) { await db.delete(portalSubjects).where(inArray(portalSubjects.classId, classIds)); await db.delete(portalClasses).where(inArray(portalClasses.id, classIds)); }
    for (const [k, v] of [["SCHOOL_ADMIN_EMAILS", saved.admins], ["SCHOOL_SUPER_ADMIN_EMAILS", saved.supers]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    await pool.end();
  }
});
