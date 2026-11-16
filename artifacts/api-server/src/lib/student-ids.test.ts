import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";
import { db, feePaymentReportsTable, individualFeeChargesTable, pool, portalAttendance, portalClasses, portalSessions, portalStudents, studentProfiles } from "@workspace/db";
import portalRouter from "../routes/portal";
import { setApprovedIdentitiesForTest } from "./approved-identities";
import { hashPassword } from "./portal-auth";
import { idSectionForClass, nameWords, parseIdList, planIdChanges } from "./student-ids";

test("admission number list: read from a pasted PDF or Excel list, paired with students by name", () => {
  const rows = parseIdList([
    "ENROLLMENT LIST - SECONDARY SCHOOL",
    "S/N ADMISSION NUMBER NAMES OF STUDENTS STATE OF ORIGIN RELIGION DoB YEAR OF ADMISSION",
    "1 NW/SEC/26/00001 Abdulkarim Salami",
    "NW/SEC/26/00002\tAnnabel Igwe\t\t\t",
    "\"NW/PRY/24/00062\",\"Adegbola AnjolaOluwa\"",
    "12 nw/pry/26/00012 Ariel .O. Oluwaseyi",
    "5 NW/SEC/26/00001 Someone Else",
    "7 NW/SEC/26/00007",
  ].join("\r\n"));
  assert.deepEqual(rows.map((r) => [r.newId, r.name, r.problem]), [
    ["NW/SEC/26/00001", "Abdulkarim Salami", null],
    ["NW/SEC/26/00002", "Annabel Igwe", null],
    ["NW/PRY/24/00062", "Adegbola AnjolaOluwa", null],
    ["NW/PRY/26/00012", "Ariel .O. Oluwaseyi", null],
    ["NW/SEC/26/00001", "Someone Else", "This admission number is also on line 3."],
    ["NW/SEC/26/00007", "", "No name after the admission number."],
  ]);
  assert.deepEqual(nameWords("Adegbola  AnjolaOluwa"), nameWords("anjolaoluwa ADEGBOLA"));
  assert.equal(idSectionForClass("JSS 2 Amber"), "secondary");
  assert.equal(idSectionForClass("SS 3"), "secondary");
  assert.equal(idSectionForClass("Year 4 Ruby"), "primary");
  assert.equal(idSectionForClass("Nursery 2"), "primary");

  const s = (id: number, name: string, className: string, studentId = `OLD-${id}`) => ({ id, studentId, name, className, active: true });
  const students = [
    s(1, "Abdulkarim Salami", "JSS 1"), s(2, "Annabel Igwe", "JSS 2"), s(3, "AnjolaOluwa Adegbola", "Year 3"),
    s(4, "Ariel Oluwaseyi", "Year 1"), s(5, "David Bello", "JSS 3"), s(6, "David Bello", "SS 1"), s(7, "Kemi Ade", "SS 2", "NW/SEC/25/00099"),
  ];
  const plan = planIdChanges(parseIdList([
    "NW/SEC/26/00001 Abdulkarim Salami", "NW/SEC/26/00002 Annabel Igwe", "NW/PRY/24/00062 Adegbola AnjolaOluwa",
    "NW/PRY/26/00012 Ariel .O. Oluwaseyi", "NW/SEC/24/00072 David Bello", "NW/SEC/25/00099 Kemi Ade", "NW/SEC/25/00098 Nobody Known",
    "NW/SEC/25/00097 Annabel Igwe", "NW/SEC/25/00099 Abdulkarim Salami",
  ].join("\n")), students);
  assert.deepEqual(plan.map((p) => [p.newId, p.status, p.student?.id ?? null]), [
    ["NW/SEC/26/00001", "match", 1], // the last line repeats this student but is refused as a duplicate number
    ["NW/SEC/26/00002", "ambiguous", null],
    ["NW/PRY/24/00062", "match", 3],
    ["NW/PRY/26/00012", "close", 4],
    ["NW/SEC/24/00072", "ambiguous", null],
    ["NW/SEC/25/00099", "already", 7],
    ["NW/SEC/25/00098", "unmatched", null],
    ["NW/SEC/25/00097", "ambiguous", null],
    ["NW/SEC/25/00099", "problem", null],
  ]);
});

test("changing to admission numbers: office only; sign in with the new number; fee records move with the student", async () => {
  const tag = randomUUID().replace(/[^a-f]/g, "").slice(0, 6).padEnd(6, "x");
  const marker = `QA-SID-${tag}`.toUpperCase();
  const surname = `Zq${tag}`;
  const office = `office-${tag}@example.test`;
  const saved = Object.fromEntries(["SCHOOL_ADMIN_EMAILS"].map((k) => [k, process.env[k]]));
  process.env.SCHOOL_ADMIN_EMAILS = office;
  setApprovedIdentitiesForTest([[`id-${office}`, { email: office, mfa: true }]]);
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
  const post = async (path: string, body: unknown, who?: string, cookie?: string): Promise<{ status: number; data: any }> => {
    const r = await fetch(root + path, { method: "POST", headers: { "Content-Type": "application/json", ...(who ? { "X-Test-User": who } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const num = (n: number) => String(900000 + Math.floor(Math.random() * 90000) + n);
  const secA = `NW/SEC/26/${num(1)}`, secB = `NW/SEC/26/${num(2)}`, pry = `NW/PRY/24/${num(3)}`;
  const classIds: number[] = [];
  try {
    const [jss, y3] = await db.insert(portalClasses).values([{ name: `${marker} JSS 1` }, { name: `${marker} Year 3` }]).returning();
    classIds.push(jss.id, y3.id);
    const passwordHash = await hashPassword("Ids-Test-1234");
    const [ada, bayo, tolu] = await db.insert(portalStudents).values([
      { studentId: `${marker}-1`, name: `Ada ${surname}`, classId: jss.id, passwordHash },
      { studentId: `${marker}-2`, name: `Bayo Tunde ${surname}`, classId: jss.id, passwordHash },
      { studentId: `${marker}-3`, name: `Tolu ${surname}`, classId: y3.id, passwordHash },
    ]).returning();
    await db.insert(individualFeeChargesTable).values({ reference: `${marker}-FEE`, studentName: "Ada", studentIdentifier: ` ${marker.toLowerCase()}-1 `, className: "JSS 1", term: "First Term", academicYear: "2026/2027", description: "Bus", amountKobo: 1000 });
    await db.insert(feePaymentReportsTable).values({ reference: `${marker}-RPT`, feeType: "school_fees", studentName: "Ada", studentIdentifier: `${marker}-1`, className: "JSS 1", term: "First Term", academicYear: "2026/2027", amountKobo: 1000, guardianName: "Mum", guardianEmail: `mum-${tag}@example.test`, guardianPhone: "08030000000" });

    const list = [`1 ${secA} Ada ${surname}`, `2 ${secB} Bayo ${surname}`, `3 ${pry} Tolu ${surname}`].join("\n");
    // Only the office: not a stranger, not a signed-in student.
    const student = (await fetch(root + "/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: `${marker}-3`, password: "Ids-Test-1234" }) })).headers.get("set-cookie")!.split(";")[0];
    assert.equal((await post("/student-ids/preview", { text: list })).status, 401);
    assert.equal((await post("/student-ids/preview", { text: list }, undefined, student)).status, 403);
    const pre = await post("/student-ids/preview", { text: list }, office);
    assert.equal(pre.status, 200, JSON.stringify(pre.data));
    assert.deepEqual(pre.data.rows.map((r: { status: string; student: { id: number } | null }) => [r.status, r.student?.id]), [["match", ada.id], ["close", bayo.id], ["match", tolu.id]]);
    assert.equal((await post("/student-ids/preview", { text: "no numbers here" }, office)).status, 400);

    // Refused: not an admission number, the same number twice, or a number someone else has.
    assert.equal((await post("/student-ids/apply", { changes: [{ id: ada.id, newId: "NWE/2026/00001" }] }, office)).status, 400);
    assert.equal((await post("/student-ids/apply", { changes: [{ id: ada.id, newId: secA }, { id: bayo.id, newId: secA }] }, office)).status, 400);
    assert.equal((await post("/student-ids/apply", { changes: [{ id: ada.id, newId: secA }] }, undefined, student)).status, 403);

    // Apply.
    const done = await post("/student-ids/apply", { changes: [{ id: ada.id, newId: secA.toLowerCase() }, { id: bayo.id, newId: secB }, { id: tolu.id, newId: pry }] }, office);
    assert.equal(done.status, 200, JSON.stringify(done.data));
    assert.equal(done.data.changed, 3);
    const after = await db.select().from(portalStudents).where(inArray(portalStudents.id, [ada.id, bayo.id, tolu.id]));
    assert.deepEqual(after.map((s) => s.studentId).sort(), [pry, secA, secB].sort());
    const [charge] = await db.select().from(individualFeeChargesTable).where(eq(individualFeeChargesTable.reference, `${marker}-FEE`));
    assert.equal(charge.studentIdentifier, secA, "fee charge moved with the student");
    const [report] = await db.select().from(feePaymentReportsTable).where(eq(feePaymentReportsTable.reference, `${marker}-RPT`));
    assert.equal(report.studentIdentifier, secA, "payment report moved with the student");

    // Sign in with the new number (any case); the old ID no longer works.
    const signIn = (studentId: string) => fetch(root + "/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId, password: "Ids-Test-1234" }) });
    const ok = await signIn(secA.toLowerCase());
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { studentId: string }).studentId, secA);
    assert.equal((await signIn(`${marker}-1`)).status, 401);

    // Another student cannot be given a number already in use; two students can swap.
    assert.equal((await post("/student-ids/apply", { changes: [{ id: tolu.id, newId: secA }] }, office)).status, 409);
    assert.equal((await post("/student-ids/apply", { changes: [{ id: ada.id, newId: secB }, { id: bayo.id, newId: secA }] }, office)).status, 200);
    const [adaNow] = await db.select().from(portalStudents).where(eq(portalStudents.id, ada.id));
    assert.equal(adaNow.studentId, secB);
    // Running it again changes nothing.
    assert.equal((await post("/student-ids/apply", { changes: [{ id: ada.id, newId: secB }] }, office)).data.changed, 0);
    const again = await post("/student-ids/preview", { text: `${secB} Ada ${surname}` }, office);
    assert.equal(again.data.rows[0].status, "already");
  } finally {
    server.close();
    await db.delete(individualFeeChargesTable).where(like(individualFeeChargesTable.reference, `${marker}%`));
    await db.delete(feePaymentReportsTable).where(like(feePaymentReportsTable.reference, `${marker}%`));
    if (classIds.length) {
      const ids = (await db.select({ id: portalStudents.id }).from(portalStudents).where(inArray(portalStudents.classId, classIds))).map((s) => s.id);
      if (ids.length) await db.delete(portalSessions).where(inArray(portalSessions.studentId, ids));
      await db.delete(portalStudents).where(inArray(portalStudents.classId, classIds));
      await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    }
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

after(() => pool.end());

test("old IDs: each old record keeps its history and takes the new ID and password; empty old records go", async () => {
  const tag = randomUUID().replace(/[^a-f]/g, "").slice(0, 6).padEnd(6, "y");
  const marker = `QA-OLD-${tag}`.toUpperCase();
  const surname = `Zv${tag}`;
  const office = `office-${tag}@example.test`;
  const saved = process.env.SCHOOL_ADMIN_EMAILS;
  process.env.SCHOOL_ADMIN_EMAILS = office;
  setApprovedIdentitiesForTest([[`id-${office}`, { email: office, mfa: true }]]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error() {}, warn() {}, info() {} } as unknown as typeof req.log;
    if (req.headers["x-test-user"] === office) { req.dbUser = { id: `id-${office}` } as NonNullable<typeof req.dbUser>; req.identity = { email: office, emailVerified: true, mfa: true }; }
    next();
  });
  app.use("/api/portal", portalRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/portal`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const post = async (path: string, body: unknown, asOffice = true): Promise<{ status: number; data: any }> => {
    const r = await fetch(root + path, { method: "POST", headers: { "Content-Type": "application/json", ...(asOffice ? { "X-Test-User": office } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const n = () => String(900000 + Math.floor(Math.random() * 99999));
  const classIds: number[] = [];
  try {
    const [oldClass, newClass] = await db.insert(portalClasses).values([{ name: `${marker} Year 7 Amber` }, { name: `${marker} JSS 1 Amber` }]).returning();
    classIds.push(oldClass.id, newClass.id);
    const oldHash = await hashPassword("Old-Password-123"), newHash = await hashPassword("New-Password-456");
    const [adaOld, adaNew, bayoOld, bayoNew, emptyOld, keptOld] = await db.insert(portalStudents).values([
      { studentId: `${marker}-1`, name: `ADA ${surname}`, classId: oldClass.id, passwordHash: oldHash, mustChangePassword: false, guardianEmail: `mum-${tag}@example.test` },
      { studentId: `NW/SEC/26/${n()}`, name: `Ada ${surname}`, classId: newClass.id, passwordHash: newHash, mustChangePassword: false },
      { studentId: `${marker}-2`, name: `Bayo ${surname}`, classId: oldClass.id, passwordHash: oldHash },
      { studentId: `NW/SEC/26/${n()}`, name: `Bayo ${surname}`, classId: newClass.id, passwordHash: newHash },
      { studentId: `${marker}-3`, name: `Empty ${surname}`, classId: oldClass.id, passwordHash: oldHash },
      { studentId: `${marker}-4`, name: `Kept ${surname}`, classId: oldClass.id, passwordHash: oldHash },
    ]).returning();
    // Names that differ: a middle name added (paired as close), and a short name the office joins by hand.
    const [kaylaOld, kaylaNew, runorOld, runorNew] = await db.insert(portalStudents).values([
      { studentId: `${marker}-5`, name: `KAYLA ${surname}`, classId: oldClass.id, passwordHash: oldHash },
      { studentId: `NW/SEC/26/${n()}`, name: `Kayla Enyo-ojo ${surname}`, classId: newClass.id, passwordHash: newHash },
      { studentId: `${marker}-6`, name: `RUNOR Zw${tag}`, classId: oldClass.id, passwordHash: oldHash },
      { studentId: `NW/SEC/26/${n()}`, name: `Oghenerunor Zw${tag}`, classId: newClass.id, passwordHash: newHash },
    ]).returning();
    await db.insert(portalAttendance).values({ classId: oldClass.id, studentId: runorOld.id, date: "2026-11-04", status: "present" });
    await db.insert(portalAttendance).values([
      { classId: oldClass.id, studentId: adaOld.id, date: "2026-11-02", status: "present" },
      { classId: newClass.id, studentId: bayoNew.id, date: "2026-11-03", status: "present" },
      { classId: oldClass.id, studentId: keptOld.id, date: "2026-11-02", status: "late" },
    ]);
    await db.insert(studentProfiles).values({ studentId: adaOld.id, address: "4 Unity Close" });

    assert.equal((await post("/student-ids/old/preview", {}, false)).status, 401);
    const pre = await post("/student-ids/old/preview", {});
    assert.equal(pre.status, 200, JSON.stringify(pre.data));
    const pair = (id: number) => pre.data.pairs.find((p: { old: { id: number } }) => p.old.id === id);
    assert.equal(pair(adaOld.id).status, "ready");
    assert.equal(pair(adaOld.id).new.id, adaNew.id);
    assert.deepEqual(pair(adaOld.id).oldRecords.sort(), ["attendance", "profile details"]);
    assert.equal(pair(bayoOld.id).status, "new_has_records", "the new record already has attendance: a person decides");
    const lone = (id: number) => pre.data.unpaired.find((u: { student: { id: number } }) => u.student.id === id);
    assert.deepEqual(lone(emptyOld.id).records, []);
    assert.deepEqual(lone(keptOld.id).records, ["attendance"]);
    assert.equal(pair(kaylaOld.id).new.id, kaylaNew.id, "a middle name missing still pairs");
    assert.equal(pair(kaylaOld.id).status, "ready");
    assert.ok(lone(runorOld.id), "a different short name does not pair by itself");
    assert.ok(pre.data.newOptions.some((o: { id: number }) => o.id === runorNew.id), "but its new record can be chosen");
    assert.ok(!pre.data.newOptions.some((o: { id: number }) => o.id === kaylaNew.id || o.id === bayoNew.id), "paired or used new records are not offered");
    // A new record cannot stand in as an old one.
    assert.equal((await post("/student-ids/old/apply", { join: [{ oldId: kaylaNew.id, newId: runorNew.id }], remove: [] })).status, 409);

    // Not allowed: joining a pair that is not ready, or removing an old record that has history.
    assert.equal((await post("/student-ids/old/apply", { join: [{ oldId: bayoOld.id, newId: bayoNew.id }], remove: [] })).status, 409);
    assert.equal((await post("/student-ids/old/apply", { join: [], remove: [keptOld.id] })).status, 409);

    const done = await post("/student-ids/old/apply", { join: [{ oldId: adaOld.id, newId: adaNew.id }, { oldId: kaylaOld.id, newId: kaylaNew.id }, { oldId: runorOld.id, newId: runorNew.id }], remove: [emptyOld.id] });
    assert.equal(done.status, 200, JSON.stringify(done.data));
    assert.deepEqual([done.data.joined, done.data.removed], [3, 1]);
    const [runor] = await db.select().from(portalStudents).where(eq(portalStudents.id, runorOld.id));
    assert.equal(runor.studentId, runorNew.studentId);
    assert.equal(runor.name, `Oghenerunor Zw${tag}`, "the new record's spelling of the name is kept");

    // Removing what is left: an old record with attendance goes with its records only when the office chooses that.
    assert.equal((await post("/student-ids/old/apply", { join: [], remove: [keptOld.id] })).status, 409, "plain remove refuses records");
    assert.equal((await post("/student-ids/old/apply", { join: [], remove: [], purge: [adaOld.id] })).status, 409, "a student with an admission number is not an old record");
    const purged = await post("/student-ids/old/apply", { join: [], remove: [], purge: [keptOld.id] });
    assert.equal(purged.status, 200, JSON.stringify(purged.data));
    assert.match(purged.data.message, /removed with its records/);
    assert.equal((await db.select().from(portalStudents).where(eq(portalStudents.id, keptOld.id))).length, 0);
    assert.equal((await db.select().from(portalAttendance).where(eq(portalAttendance.studentId, keptOld.id))).length, 0);

    const [ada] = await db.select().from(portalStudents).where(eq(portalStudents.id, adaOld.id));
    assert.equal(ada.studentId, adaNew.studentId, "the old record now has the new ID");
    assert.equal(ada.name, `Ada ${surname}`);
    assert.equal(ada.classId, newClass.id);
    assert.equal(ada.guardianEmail, `mum-${tag}@example.test`);
    assert.equal((await db.select().from(portalStudents).where(eq(portalStudents.id, adaNew.id))).length, 0, "the empty new record is gone");
    assert.equal((await db.select().from(portalStudents).where(eq(portalStudents.id, emptyOld.id))).length, 0, "the empty old record is gone");
    assert.equal((await db.select().from(portalAttendance).where(eq(portalAttendance.studentId, adaOld.id))).length, 1, "attendance kept");
    assert.equal((await db.select().from(studentProfiles).where(eq(studentProfiles.studentId, adaOld.id)))[0].address, "4 Unity Close");
    const signIn = (studentId: string, password: string) => fetch(root + "/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId, password }) });
    assert.equal((await signIn(adaNew.studentId, "New-Password-456")).status, 200, "new ID and the new password");
    assert.equal((await signIn(adaNew.studentId, "Old-Password-123")).status, 401);
    assert.equal((await signIn(`${marker}-1`, "Old-Password-123")).status, 401, "the old ID is gone");
    void bayoOld;
  } finally {
    server.close();
    if (classIds.length) {
      const ids = (await db.select({ id: portalStudents.id }).from(portalStudents).where(inArray(portalStudents.classId, classIds))).map((s) => s.id);
      if (ids.length) {
        await db.delete(portalSessions).where(inArray(portalSessions.studentId, ids));
        await db.delete(portalAttendance).where(inArray(portalAttendance.studentId, ids));
      }
      await db.delete(portalStudents).where(inArray(portalStudents.classId, classIds));
      await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    }
    if (saved === undefined) delete process.env.SCHOOL_ADMIN_EMAILS; else process.env.SCHOOL_ADMIN_EMAILS = saved;
  }
});
