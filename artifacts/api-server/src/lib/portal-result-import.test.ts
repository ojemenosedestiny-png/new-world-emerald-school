import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool, portalClasses, portalReportCards, portalReportReleases, portalReportWorkflow, portalResultImports, portalScores,
  portalSessions, portalStudents, portalSubjects, portalTerms,
} from "@workspace/db";
import portalRouter from "../routes/portal";
import { hashPassword } from "./portal-auth";

// Database checks for importing old results: preview, save, audit log and the student's view.
test("result import: old results are checked, saved to the right student, class and term, logged, and shown to students", async () => {
  const saved = process.env.SCHOOL_ADMIN_EMAILS;
  const marker = `QA-IMP-${randomUUID().slice(0, 8)}`.toUpperCase();
  process.env.SCHOOL_ADMIN_EMAILS = `admin-${marker}@example.test`.toLowerCase();
  const classIds: number[] = [];
  const termIds: number[] = [];
  const importIds: number[] = [];
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
  const send = async (path: string, csv: string, opts: { admin?: boolean; cookie?: string; json?: boolean } = {}): Promise<{ status: number; data: any }> => {
    const r = await fetch(root + path, { method: "POST", headers: { "Content-Type": "text/csv", ...(opts.admin ? { "X-Test-Admin": marker } : {}), ...(opts.cookie ? { Cookie: opts.cookie } : {}) }, body: opts.json ? JSON.stringify(csv) : csv });
    return { status: r.status, data: await r.json() };
  };
  try {
    // Ada was in the old class; she has moved up since.
    const [old, current] = await db.insert(portalClasses).values([{ name: `${marker} JSS 1` }, { name: `${marker} JSS 2` }]).returning();
    classIds.push(old.id, current.id);
    const pw = await hashPassword("Imp-Pass-12345");
    const [ada, bayo] = await db.insert(portalStudents).values([
      { studentId: `${marker}-1`, name: "Ada Obi", classId: current.id, passwordHash: pw, mustChangePassword: false },
      { studentId: `${marker}-2`, name: "Bayo Ade", classId: current.id, passwordHash: pw, mustChangePassword: false },
    ]).returning();
    const login = async (id: string) => (await fetch(root + "/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: id, password: "Imp-Pass-12345" }) })).headers.get("set-cookie")!.split(";")[0];
    const adaCookie = await login(ada.studentId);
    const year = 1900 + Math.floor(Math.random() * 90);
    const session = `${year}/${year + 1}`;

    const csv = [
      "Student ID,Student name,Class,Session,Term,Subject,CA,Exam,Total,Grade,Teacher comment,Principal comment,Days present,Days open",
      `${ada.studentId},Ada Obi,${old.name},${session},1st,Mathematics,30,55,85,A1,Hardworking.,Excellent.,58,60`,
      `${ada.studentId},Ada Obi,${old.name},${session},1st,English Language,25,45,70,B2,,,,`,
      `${bayo.studentId},Bayo Ade,${old.name},${session},1st,Mathematics,20,40,60,C4,Can do better.,,50,60`,
      `${marker}-404,Nobody,${old.name},${session},1st,Mathematics,10,10,20,F9,,,,`,
      `${ada.studentId},Ada Obi,${old.name},${session},1st,Mathematics,1,1,2,F9,,,,`,
    ].join("\n");

    // Only the office may import; students and signed-out visitors cannot.
    assert.equal((await send("/results-import/preview", csv, { cookie: adaCookie })).status, 403);
    assert.equal((await send("/results-import/preview", csv)).status, 401);

    // Preview saves nothing and explains every problem.
    const preview = await send("/results-import/preview", csv, { admin: true });
    assert.equal(preview.status, 200, JSON.stringify(preview.data));
    assert.deepEqual([preview.data.total, preview.data.errors, preview.data.students], [5, 2, 2]);
    assert.deepEqual(preview.data.newTerms, [`First Term, ${session}`]);
    assert.deepEqual(preview.data.newSubjects.sort(), [`English Language in ${old.name}`, `Mathematics in ${old.name}`]);
    assert.ok(preview.data.problems.some((p: { line: number; messages: string[] }) => p.line === 5 && /No student/.test(p.messages.join())));
    assert.ok(preview.data.problems.some((p: { line: number; messages: string[] }) => p.line === 6 && /Duplicate/.test(p.messages.join())));
    assert.equal((await db.select().from(portalTerms).where(eq(portalTerms.session, session))).length, 0, "preview saves nothing");
    assert.equal((await send("/results-import/preview", "Name,Class\nx,y", { admin: true })).data.missingColumns.includes("Student ID"), true);

    // Saving imports the good rows (sent the way the portal's client sends them) and publishes them.
    const commit = await send(`/results-import/commit?publish=true&caMax=40&examMax=60&fileName=${encodeURIComponent("old-portal-2019.csv")}`, csv, { admin: true, json: true });
    assert.equal(commit.status, 200, JSON.stringify(commit.data));
    importIds.push(commit.data.id);
    assert.deepEqual([commit.data.rows, commit.data.imported, commit.data.skipped, commit.data.published, commit.data.fileName], [5, 3, 2, 1, "old-portal-2019.csv"]);
    const [term] = await db.select().from(portalTerms).where(eq(portalTerms.session, session));
    termIds.push(term.id);
    const subjects = await db.select().from(portalSubjects).where(eq(portalSubjects.classId, old.id));
    assert.deepEqual(subjects.map((s) => s.name).sort(), ["English Language", "Mathematics"]);
    const scores = await db.select().from(portalScores).where(eq(portalScores.termId, term.id));
    assert.equal(scores.length, 3);
    const adaMaths = scores.find((s) => s.studentId === ada.id && s.subjectId === subjects.find((x) => x.name === "Mathematics")!.id)!;
    assert.deepEqual([adaMaths.ca, adaMaths.exam, adaMaths.total, adaMaths.grade], [30, 55, 85, "A1"], "the duplicate row was not saved");
    const [card] = await db.select().from(portalReportCards).where(eq(portalReportCards.studentId, ada.id));
    assert.deepEqual([card.teacherRemark, card.principalRemark, card.daysPresent, card.daysOpen], ["Hardworking.", "Excellent.", 58, 60]);

    // Ada sees the old result in the same template, in the class she was in then, with the old grades and her position.
    const mine = await fetch(root + "/reports", { headers: { Cookie: adaCookie } }).then((r) => r.json() as Promise<any>); // eslint-disable-line @typescript-eslint/no-explicit-any
    const old1 = mine.reports.find((r: { term: { id: number } }) => r.term.id === term.id);
    assert.ok(old1, "the imported result is visible");
    assert.equal(old1.className, old.name);
    assert.equal(old1.result.subjects.length, 2);
    assert.ok(old1.result.subjects.some((s: { total: number; grade: string }) => s.total === 70 && s.grade === "B2"));
    assert.ok(old1.result.subjects.some((s: { total: number; grade: string }) => s.total === 85 && s.grade === "A1"));
    assert.equal(old1.result.position, 1);
    assert.equal(old1.classSize, 2, "Bayo, also moved up, is ranked in the old class");
    assert.equal(old1.card.teacherRemark, "Hardworking.");

    // Every import is in the history; once published, importing into that class and term again is refused.
    const history = await fetch(root + "/results-import/history", { headers: { "X-Test-Admin": marker } }).then((r) => r.json() as Promise<any>); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(history[0].id, commit.data.id);
    assert.equal(history[0].importedBy, `admin-${marker}@example.test`.toLowerCase());
    const again = await send("/results-import/preview", csv, { admin: true });
    assert.ok(again.data.problems.some((p: { messages: string[] }) => /are published. Return them to draft/.test(p.messages.join())));
    const template = await fetch(root + "/results-import/template", { headers: { "X-Test-Admin": marker } });
    assert.match(await template.text(), /Student ID,Student name,Class,Session,Term,Subject/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    if (importIds.length) await db.delete(portalResultImports).where(inArray(portalResultImports.id, importIds));
    if (termIds.length) {
      await db.delete(portalReportReleases).where(inArray(portalReportReleases.termId, termIds));
      await db.delete(portalReportWorkflow).where(inArray(portalReportWorkflow.termId, termIds));
      await db.delete(portalScores).where(inArray(portalScores.termId, termIds));
      await db.delete(portalReportCards).where(inArray(portalReportCards.termId, termIds));
      await db.delete(portalTerms).where(inArray(portalTerms.id, termIds));
    }
    if (classIds.length) {
      const ids = (await db.select({ id: portalStudents.id }).from(portalStudents).where(inArray(portalStudents.classId, classIds))).map((s) => s.id);
      if (ids.length) await db.delete(portalSessions).where(inArray(portalSessions.studentId, ids));
      await db.delete(portalSubjects).where(inArray(portalSubjects.classId, classIds));
      await db.delete(portalStudents).where(inArray(portalStudents.classId, classIds));
      await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    }
    if (saved === undefined) delete process.env.SCHOOL_ADMIN_EMAILS; else process.env.SCHOOL_ADMIN_EMAILS = saved;
    await pool.end();
  }
});
