import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { inArray, like } from "drizzle-orm";
import { db, pool, portalAssignments, portalClasses, portalFiles, portalSessions, portalStudents, portalTimetables } from "@workspace/db";
import portalRouter from "../routes/portal";
import { setApprovedIdentitiesForTest } from "./approved-identities";
import { hashPassword } from "./portal-auth";
import { setParentEmailResolverForTest } from "../routes/portal-parent";

// Database checks for exam and class timetables, and question sheets (PDF) on assignments.
test("timetables and assignment sheets: who posts them, who sees them, who may open the file", async () => {
  const marker = `QA-TT-${randomUUID().slice(0, 8)}`.toUpperCase();
  const lower = marker.toLowerCase();
  const office = `office-${lower}@example.test`, officer = `officer-${lower}@example.test`, mum = `mum-${lower}@example.test`, stranger = `stranger-${lower}@example.test`;
  const saved = Object.fromEntries(["SCHOOL_ADMIN_EMAILS", "SCHOOL_SUPER_ADMIN_EMAILS", "SCHOOL_EXAM_OFFICER_EMAILS"].map((k) => [k, process.env[k]]));
  process.env.SCHOOL_ADMIN_EMAILS = office;
  process.env.SCHOOL_SUPER_ADMIN_EMAILS = office;
  process.env.SCHOOL_EXAM_OFFICER_EMAILS = officer;
  setApprovedIdentitiesForTest([office, officer].map((e) => [`id-${e}`, { email: e, mfa: true }]));
  let parentEmail: string | null = null;
  setParentEmailResolverForTest(async () => parentEmail);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error() {}, warn() {}, info() {} } as unknown as typeof req.log;
    const who = req.headers["x-test-user"];
    if (typeof who === "string" && who !== "parent") {
      req.dbUser = { id: `id-${who}` } as NonNullable<typeof req.dbUser>;
      req.identity = { email: who, emailVerified: true, mfa: true };
    }
    next();
  });
  app.use("/api/portal", portalRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/portal`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (path: string, who: string | null, body?: unknown, cookie?: string, method?: string): Promise<{ status: number; data: any }> => {
    const r = await fetch(root + path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { "Content-Type": "application/json", ...(who ? { "X-Test-User": who } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let data: unknown = text;
    try { data = JSON.parse(text); } catch { /* a file or an empty body */ }
    return { status: r.status, data };
  };
  const classIds: number[] = [];
  const fileIds: string[] = [];
  const studentIds: number[] = [];
  try {
    const [jss1] = await db.insert(portalClasses).values({ name: `${marker} JSS 1` }).returning();
    const [year3] = await db.insert(portalClasses).values({ name: `${marker} Year 3` }).returning();
    classIds.push(jss1.id, year3.id);
    const pw = await hashPassword("Timetable-Test-1");
    const [ada, chi] = await db.insert(portalStudents).values([
      { studentId: `${marker}-1`, name: "Ada Obi", classId: jss1.id, passwordHash: pw, mustChangePassword: false, guardianEmail: mum },
      { studentId: `${marker}-2`, name: "Chi Eze", classId: year3.id, passwordHash: pw, mustChangePassword: false },
    ]).returning();
    studentIds.push(ada.id, chi.id);
    const login = async (id: string) => (await fetch(root + "/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: id, password: "Timetable-Test-1" }) })).headers.get("set-cookie")!.split(";")[0];
    const adaS = await login(ada.studentId), chiS = await login(chi.studentId);

    // Files as the upload would store them: a whole-school PDF, a timetable photo for JSS 1, an assignment sheet for JSS 1, an exam diagram.
    const ids = { school: randomUUID(), photo: randomUUID(), sheet: randomUUID(), diagram: randomUUID(), year3Sheet: randomUUID() };
    await db.insert(portalFiles).values([
      { id: ids.school, classId: null, objectName: `${marker}-school` },
      { id: ids.photo, classId: jss1.id, objectName: `doc-${ids.photo}.png` },
      { id: ids.sheet, classId: jss1.id, objectName: `${marker}-sheet` },
      { id: ids.diagram, classId: jss1.id, objectName: `diagram-${ids.diagram}.png` },
      { id: ids.year3Sheet, classId: year3.id, objectName: `${marker}-y3` },
    ]);
    fileIds.push(...Object.values(ids));

    // Uploads: only staff and the exam officer; whole-school uploads only for the office and the exam officer; files are checked.
    const upload = async (who: string | null, query: string, body: Buffer, type = "application/pdf") =>
      (await fetch(root + "/documents" + query, { method: "POST", headers: { "Content-Type": type, ...(who ? { "X-Test-User": who } : {}) }, body })).status;
    assert.equal(await upload(null, "", Buffer.from("%PDF-1.4 test")), 401);
    assert.equal(await upload(office, "", Buffer.from("not a pdf at all")), 400);
    assert.equal(await upload(officer, "?classId=abc", Buffer.from("%PDF-1.4 test")), 400);
    assert.equal(await upload(officer, "", Buffer.from("plain words"), "image/png"), 400, "a picture must really be a picture");

    // Posting: the office and the exam officer, for the whole school or chosen classes.
    const manage = (who: string | null, body: object) => call("/timetables", who, body);
    assert.equal((await call("/timetables", null)).status, 401);
    assert.equal((await manage(null, { action: "save", timetable: { title: "x", kind: "exam", classIds: [], fileId: ids.school, published: true } })).status, 401);
    const officerView = await call("/timetables", officer);
    assert.equal(officerView.status, 200, JSON.stringify(officerView.data));
    assert.equal(officerView.data.canWholeSchool, true);
    assert.ok(officerView.data.classes.some((c: { id: number }) => c.id === jss1.id));
    assert.equal((await manage(officer, { action: "save", timetable: { title: "  ", kind: "exam", classIds: [], fileId: ids.school, published: true } })).status, 400);
    assert.equal((await manage(officer, { action: "save", timetable: { title: "Exams", kind: "exam", classIds: [], fileId: randomUUID(), published: true } })).status, 400, "the file must exist");
    assert.equal((await manage(officer, { action: "save", timetable: { title: "Exams", kind: "exam", classIds: [999999999], fileId: ids.school, published: true } })).status, 404);
    const posted = await manage(officer, { action: "save", timetable: { title: `${marker} Autumn Term exam timetable`, kind: "exam", classIds: [], fileId: ids.school, published: true } });
    assert.equal(posted.status, 200, JSON.stringify(posted.data));
    assert.match(posted.data.message, /is posted/);
    assert.equal((await manage(office, { action: "save", timetable: { title: `${marker} JSS 1 lessons`, kind: "class", classIds: [jss1.id], fileId: ids.photo, published: true } })).status, 200);
    assert.equal((await manage(office, { action: "save", timetable: { title: `${marker} Hidden draft`, kind: "class", classIds: [], fileId: ids.school, published: false } })).status, 200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mine = (rows: any[]) => rows.filter((t) => t.title.startsWith(marker));
    const all = mine((await call("/timetables", office)).data.timetables);
    assert.equal(all.length, 3);
    const lessons = all.find((t) => t.kind === "class" && t.classNames.length);
    assert.deepEqual([lessons.classNames, lessons.fileType], [[`${marker} JSS 1`], "image"]);
    assert.equal(all.find((t: { kind: string }) => t.kind === "exam").fileType, "pdf");

    // Students see the published timetables for their class and the whole school, exam timetables first.
    const adaList = mine((await call("/my-timetables", null, undefined, adaS)).data);
    assert.deepEqual(adaList.map((t: { title: string }) => t.title), [`${marker} Autumn Term exam timetable`, `${marker} JSS 1 lessons`]);
    const chiList = mine((await call("/my-timetables", null, undefined, chiS)).data);
    assert.deepEqual(chiList.map((t: { title: string }) => t.title), [`${marker} Autumn Term exam timetable`]);
    assert.equal((await call("/my-timetables", null)).status, 401);

    // Parents see them on each child's page.
    parentEmail = mum;
    const progress = await call(`/parent/children/${ada.id}`, "parent");
    assert.equal(progress.status, 200, JSON.stringify(progress.data));
    assert.deepEqual(mine(progress.data.timetables).map((t: { kind: string }) => t.kind), ["exam", "class"]);

    // Opening the files: a 404 means "not for you"; anything else means access was granted (no storage in tests).
    const open = async (fileId: string, who: string | null, cookie?: string) => (await call(`/files/${fileId}`, who, undefined, cookie)).status;
    assert.notEqual(await open(ids.school, null, chiS), 404, "the whole-school timetable is for every student");
    assert.notEqual(await open(ids.photo, null, adaS), 404, "JSS 1's timetable photo");
    assert.equal(await open(ids.photo, null, chiS), 404, "not Year 3's");
    assert.notEqual(await open(ids.photo, "parent"), 404, "a JSS 1 parent");
    assert.equal(await open(ids.diagram, office), 404, "exam diagrams are not served as documents");
    parentEmail = stranger;
    assert.equal(await open(ids.school, "parent"), 404, "someone with no children here");
    parentEmail = null;
    assert.equal(await open(ids.school, null), 404, "nobody signed in");
    assert.notEqual(await open(ids.school, officer), 404, "the exam officer");

    // Hiding and deleting.
    const lessonsId = lessons.id;
    assert.equal((await manage(office, { action: "save", timetable: { id: lessonsId, title: lessons.title, kind: "class", classIds: [jss1.id], fileId: ids.photo, published: false } })).status, 200);
    assert.equal(mine((await call("/my-timetables", null, undefined, adaS)).data).length, 1);
    assert.equal(await open(ids.photo, null, adaS), 404, "a hidden timetable's photo is closed to students");
    assert.equal((await manage(officer, { action: "delete", id: lessonsId })).status, 200);
    assert.equal((await manage(officer, { action: "delete", id: lessonsId })).status, 404);

    // Assignments: a question sheet must be a PDF uploaded for the same class.
    const assignment = { classId: jss1.id, subject: "Mathematics", title: `${marker} Fractions`, instructions: "Answer all questions.", dueAt: new Date(Date.now() + 86_400_000).toISOString(), maxScore: 10, published: true };
    assert.equal((await call("/assignments", office, { ...assignment, fileId: ids.year3Sheet })).status, 400, "another class's file");
    assert.equal((await call("/assignments", office, { ...assignment, fileId: ids.photo })).status, 400, "a picture is not a question sheet");
    assert.equal(await open(ids.sheet, null, chiS), 404, "before it is shared, Year 3 cannot open JSS 1's sheet");
    const made = await call("/assignments", office, { ...assignment, fileId: ids.sheet });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    assert.equal(made.data.fileId, ids.sheet);
    const adaWork = (await call("/my-assignments", null, undefined, adaS)).data.find((a: { title: string }) => a.title === assignment.title);
    assert.equal(adaWork.fileId, ids.sheet);
    assert.notEqual(await open(ids.sheet, null, adaS), 404, "the class opens its sheet");
    assert.equal(await open(ids.sheet, null, chiS), 404, "another class still cannot");
    parentEmail = mum;
    assert.notEqual(await open(ids.sheet, "parent"), 404, "the parent opens the homework sheet");
    assert.equal((await call(`/parent/children/${ada.id}`, "parent")).data.homework.find((h: { title: string }) => h.title === assignment.title).fileId, ids.sheet);
    // Removing the sheet.
    const cleared = await call(`/assignments/${made.data.id}`, office, { ...assignment, fileId: null }, undefined, "PUT");
    assert.equal(cleared.status, 200, JSON.stringify(cleared.data));
    assert.equal(cleared.data.fileId, null);
    assert.equal(await open(ids.sheet, "parent"), 404);
  } finally {
    server.close();
    if (classIds.length) await db.delete(portalAssignments).where(inArray(portalAssignments.classId, classIds));
    await db.delete(portalTimetables).where(like(portalTimetables.title, `${marker}%`));
    if (fileIds.length) await db.delete(portalFiles).where(inArray(portalFiles.id, fileIds));
    if (studentIds.length) await db.delete(portalSessions).where(inArray(portalSessions.studentId, studentIds));
    await db.delete(portalStudents).where(like(portalStudents.studentId, `${marker}%`));
    if (classIds.length) await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await pool.end();
  }
});
