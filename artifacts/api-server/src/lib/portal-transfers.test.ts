import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";
import {
  classFeeSchedulesTable, db, examRegistrationSettings, examRegistrations, feePaymentReportsTable, paymentAccounts, pool, portalClasses,
  portalImages, portalSessions, portalStudents,
} from "@workspace/db";
import portalRouter from "../routes/portal";
import chairmanRouter from "../routes/chairman";
import { setApprovedIdentitiesForTest } from "./approved-identities";
import { hashPassword } from "./portal-auth";
import { setParentEmailResolverForTest } from "../routes/portal-parent";
import { formProblem } from "../routes/portal-exam-registration";

// Database checks for bank-transfer fees (accounts per purpose and session, screenshots, confirmation and receipts)
// and SS 3 WAEC/NECO registration (the form can be submitted only once the fee is confirmed).
test("transfers and WAEC/NECO: parents report transfers, the office or Head of School confirms, students submit after paying", async () => {
  const marker = `QA-TRF-${randomUUID().slice(0, 8)}`.toUpperCase();
  const lower = marker.toLowerCase();
  const office = `office-${lower}@example.test`, head = `head-${lower}@example.test`, mum = `mum-${lower}@example.test`, stranger = `stranger-${lower}@example.test`;
  const year = `29${String(Math.floor(Math.random() * 90) + 10)}/29${String(Math.floor(Math.random() * 90) + 11)}`.replace(/^(\d{4})\/(\d{4})$/, (_m, a) => `${a}/${Number(a) + 1}`);
  const chair = `chair-${lower}@example.test`;
  const saved = Object.fromEntries(["SCHOOL_ADMIN_EMAILS", "SCHOOL_SUPER_ADMIN_EMAILS", "SCHOOL_HEAD_EMAILS", "SCHOOL_CHAIRMAN_EMAILS"].map((k) => [k, process.env[k]]));
  process.env.SCHOOL_CHAIRMAN_EMAILS = chair;
  process.env.SCHOOL_ADMIN_EMAILS = office;
  process.env.SCHOOL_SUPER_ADMIN_EMAILS = office;
  process.env.SCHOOL_HEAD_EMAILS = head;
  setApprovedIdentitiesForTest([office, head].map((e) => [`id-${e}`, { email: e, mfa: true }]));
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
  app.use("/api", chairmanRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/portal`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (path: string, who: string | null, body?: unknown, opts: { cookie?: string; method?: string } = {}): Promise<{ status: number; data: any }> => {
    const r = await fetch(root + path, {
      method: opts.method ?? (body === undefined ? "GET" : "POST"),
      headers: { "Content-Type": "application/json", ...(who ? { "X-Test-User": who } : {}), ...(opts.cookie ? { Cookie: opts.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const classIds: number[] = [];
  const studentIds: number[] = [];
  const proofIds: string[] = [];
  const proof = async () => { const id = randomUUID(); proofIds.push(id); await db.insert(portalImages).values({ id, objectName: `proof-${id}`, contentType: "image/png", size: 10, purpose: "payment" }); return id; };
  try {
    const [ss3] = await db.insert(portalClasses).values({ name: `${marker} SS 3 Amber` }).returning();
    const [jss1] = await db.insert(portalClasses).values({ name: `${marker} JSS 1` }).returning();
    classIds.push(ss3.id, jss1.id);
    const pw = await hashPassword("Transfer-Test-1");
    const [tolu, kemi] = await db.insert(portalStudents).values([
      { studentId: `${marker}-1`, name: "Tolu Ade", classId: ss3.id, passwordHash: pw, mustChangePassword: false, guardianEmail: mum },
      { studentId: `${marker}-2`, name: "Kemi Ade", classId: jss1.id, passwordHash: pw, mustChangePassword: false, secondGuardianEmail: mum },
    ]).returning();
    studentIds.push(tolu.id, kemi.id);
    const [fee] = await db.insert(classFeeSchedulesTable).values({ className: jss1.name, term: "Autumn Term", academicYear: year, amountKobo: 150_000_00, description: `${marker} tuition` }).returning();
    const toluS = (await fetch(root + "/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: tolu.studentId, password: "Transfer-Test-1" }) })).headers.get("set-cookie")!.split(";")[0];

    // Accounts: school fees and WAEC/NECO go to different accounts, and a session can have its own.
    const account = (a: object) => call("/payment-accounts", office, { action: "save", account: { purpose: "school_fees", academicYear: "", bankName: "Zenith Bank", accountName: "New World Emerald", accountNumber: "1234567890", note: "", active: true, ...a } });
    assert.equal((await account({ accountNumber: "12345" })).status, 400, "ten digits");
    assert.equal((await account({ academicYear: "2026-27" })).status, 400);
    assert.equal((await account({ bankName: `${marker} Zenith`, accountNumber: "1111111111" })).status, 200);
    assert.equal((await account({ bankName: `${marker} GTBank`, academicYear: year, accountNumber: "2222222222" })).status, 200);
    assert.equal((await account({ bankName: `${marker} Access`, purpose: "exam_registration", accountNumber: "3333333333" })).status, 200);
    assert.equal((await call("/payment-accounts", null)).status, 401);
    const workspace = await call("/payment-accounts", head);
    assert.equal(workspace.status, 200, "the Head of School manages payments too");
    assert.ok(workspace.data.sessions.includes(year));

    // Card payment is switched off.
    parentEmail = mum;
    assert.equal((await call("/parent/payments", "parent", { items: [{ studentId: kemi.id, itemKey: `class-${fee.id}` }], amountKobo: 150_000_00 })).status, 410);

    // A parent reports a transfer for a school fee, with a screenshot; the session's own account is recorded.
    const overview = await call("/parent", "parent");
    assert.equal(overview.status, 200, JSON.stringify(overview.data));
    assert.ok(overview.data.accounts.some((a: { bankName: string }) => a.bankName === `${marker} GTBank`));
    assert.ok(overview.data.outstanding.some((o: { itemKey: string }) => o.itemKey === `class-${fee.id}`));
    assert.equal((await call("/parent/transfers", "parent", { studentId: kemi.id, itemKey: `class-${fee.id}`, proofId: randomUUID() })).status, 400, "the screenshot must exist");
    parentEmail = stranger;
    assert.equal((await call("/parent/transfers", "parent", { studentId: kemi.id, itemKey: `class-${fee.id}`, proofId: await proof() })).status, 404, "not their child");
    parentEmail = mum;
    const sent = await call("/parent/transfers", "parent", { studentId: kemi.id, itemKey: `class-${fee.id}`, proofId: await proof(), transferReference: "FT123" });
    assert.equal(sent.status, 200, JSON.stringify(sent.data));
    assert.deepEqual([sent.data.status, sent.data.amountKobo, sent.data.account.bankName, sent.data.receiptNumber], ["reported", 150_000_00, `${marker} GTBank`, null]);
    assert.equal((await call("/parent/transfers", "parent", { studentId: kemi.id, itemKey: `class-${fee.id}`, proofId: await proof() })).status, 409, "already being checked");
    const pending = await call("/parent", "parent");
    assert.ok(!pending.data.outstanding.some((o: { itemKey: string }) => o.itemKey === `class-${fee.id}`), "no longer owed while checked");
    assert.equal(pending.data.transfers.find((t: { id: number }) => t.id === sent.data.id).status, "reported");

    // The office reviews: not received needs a reason; confirming issues a receipt and settles the fee.
    const list = await call("/fee-transfers", office);
    assert.ok(list.data.waiting >= 1);
    assert.equal((await call(`/fee-transfers/${sent.data.id}`, office, { action: "reject", note: "" })).status, 400);
    const confirmed = await call(`/fee-transfers/${sent.data.id}`, head, { action: "confirm" });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    assert.match(confirmed.data.receiptNumber, /^NWE\/RCT\/\d{4}\/\d{5}$/);
    assert.equal(confirmed.data.confirmedBy, head);
    assert.equal((await call(`/fee-transfers/${sent.data.id}`, office, { action: "reject", note: "Wrong" })).status, 409);
    const after = await call("/parent", "parent");
    const kemiStatement = after.data.children.find((c: { id: number }) => c.id === kemi.id).statement;
    assert.equal(kemiStatement.items.find((i: { key: string }) => i.key === `class-${fee.id}`).status, "paid");
    assert.equal(after.data.transfers.find((t: { id: number }) => t.id === sent.data.id).receiptNumber, confirmed.data.receiptNumber);

    // WAEC/NECO: the office opens registration for SS 3 with a fee.
    const settings = { academicYear: year, title: "WAEC and NECO registration", open: true, feeKobo: 45_000_00, compulsorySubjects: ["Mathematics", "English Language", "Civic Education", "Livestock Farming"], optionalSubjects: ["Biology", "Chemistry", "Physics", "Economics", "Geography", "Government", "Further Mathematics"], maxSubjects: 9, classIds: [ss3.id], deadline: "" };
    assert.equal((await call("/exam-registration", office, { ...settings, academicYear: "next year" })).status, 400);
    // A bad setting is named, not "some fields are invalid".
    const long = await call("/exam-registration", office, { ...settings, optionalSubjects: ["x".repeat(81)] });
    assert.equal(long.status, 400);
    assert.match(long.data.error, /up to 80 characters/);
    assert.match((await call("/exam-registration", office, { ...settings, feeKobo: 2_000_000_000 })).data.error, /fee in naira/);
    assert.match((await call("/exam-registration", office, { ...settings, maxSubjects: null })).data.error, /Most subjects/);
    // A school with many classes and long subject names saves.
    assert.equal((await call("/exam-registration", office, { ...settings, optionalSubjects: [...settings.optionalSubjects, "Technical Drawing and Engineering Graphics for SSS"], feeKobo: 150_000_00 })).status, 200);
    assert.equal((await call("/exam-registration", office, settings)).status, 200);
    const admin = await call(`/exam-registration?academicYear=${encodeURIComponent(year)}`, office);
    assert.deepEqual(admin.data.rows.map((r: { studentName: string; feeStatus: string }) => [r.studentName, r.feeStatus]), [["Tolu Ade", "due"]]);
    const fees = (await call("/parent", "parent")).data.examFees;
    assert.deepEqual(fees.map((f: { studentName: string; amountKobo: number; status: string }) => [f.studentName, f.amountKobo, f.status]), [["Tolu Ade", 45_000_00, "due"]]);

    // The student fills the form; it cannot be submitted until the fee is confirmed.
    const form = { surname: "Ade", firstName: "Tolu", middleName: "Grace", dateOfBirth: "2009-03-14", stateOfOrigin: "Ogun", lga: "Abeokuta South", gender: "Female", nin: "12345678901",
      subjects: [...settings.compulsorySubjects, "Biology", "Chemistry", "Physics", "Economics"], phone: "08031234567", email: "tolu@example.test", signatureName: "Tolu Grace Ade" };
    const mine = await call("/my-exam-registration", null, undefined, { cookie: toluS });
    assert.deepEqual([mine.data.eligible, mine.data.fee.status, mine.data.account.bankName], [true, "due", `${marker} Access`], "the WAEC/NECO account");
    assert.equal((await call("/my-exam-registration", null, { ...form, submit: false }, { cookie: toluS, method: "PUT" })).status, 200, "a draft saves");
    assert.equal((await call("/my-exam-registration", null, { ...form, submit: true }, { cookie: toluS, method: "PUT" })).status, 402, "not paid yet");
    assert.equal((await call("/my-exam-registration", null, { ...form, submit: false }, { cookie: toluS, method: "PUT" })).data.form.status, "draft");

    // The parent pays into the WAEC/NECO account; the office confirms.
    const exam = await call("/parent/transfers", "parent", { studentId: tolu.id, itemKey: `exam-${year}`, proofId: await proof() });
    assert.equal(exam.status, 200, JSON.stringify(exam.data));
    assert.deepEqual([exam.data.purpose, exam.data.amountKobo, exam.data.account.accountNumber], ["exam_registration", 45_000_00, "3333333333"]);
    assert.equal((await call("/my-exam-registration", null, undefined, { cookie: toluS })).data.fee.status, "pending");
    assert.equal((await call(`/fee-transfers/${exam.data.id}`, office, { action: "confirm" })).status, 200);

    // Now the form must be complete and correct to submit.
    assert.equal((await call("/my-exam-registration", null, { ...form, nin: "123", submit: true }, { cookie: toluS, method: "PUT" })).status, 400);
    const submitted = await call("/my-exam-registration", null, { ...form, submit: true }, { cookie: toluS, method: "PUT" });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
    assert.equal(submitted.data.form.status, "submitted");
    assert.equal((await call("/my-exam-registration", null, { ...form, submit: false }, { cookie: toluS, method: "PUT" })).status, 409, "locked once submitted");
    const row = (await call(`/exam-registration?academicYear=${encodeURIComponent(year)}`, office)).data.rows[0];
    assert.deepEqual([row.feeStatus, row.form.status, row.form.nin], ["paid", "submitted", "12345678901"]);
    // The school can send it back for a correction.
    assert.equal((await call(`/exam-registration/${row.form.id}`, office, { action: "return", note: "" })).status, 400);
    assert.equal((await call(`/exam-registration/${row.form.id}`, office, { action: "return", note: "Spell your LGA in full" })).status, 200);
    const back = await call("/my-exam-registration", null, undefined, { cookie: toluS });
    assert.deepEqual([back.data.form.status, back.data.form.officeNote], ["returned", "Spell your LGA in full"]);
    assert.equal((await call("/my-exam-registration", null, { ...form, lga: "Abeokuta South Local Government", submit: true }, { cookie: toluS, method: "PUT" })).data.form.status, "submitted");

    // The Chairman's board: numbers only, never money; the Chairman cannot reach the office's pages.
    const board = (who: string | null, days = 30) => call(`/../chairman/board?days=${days}`, who);
    assert.equal((await board(null)).status, 401);
    assert.equal((await board(head)).status, 403, "the Head of School is not the Chairman");
    const chairView = await board(chair, 90);
    assert.equal(chairView.status, 200, JSON.stringify(chairView.data));
    assert.equal(chairView.data.days, 90);
    assert.ok(!/kobo|money|confirmedKobo|awaitingKobo/i.test(JSON.stringify(chairView.data)), "no money on the board");
    const ss3Row = chairView.data.classes.find((c: { className: string }) => c.className === ss3.name);
    assert.deepEqual([ss3Row.students, ss3Row.section], [1, "secondary"]);
    if (chairView.data.waec?.academicYear === year) assert.equal(chairView.data.waec.submitted, 1);
    assert.equal((await board(office)).status, 200, "the owner can see what the Chairman sees");
    assert.notEqual((await call("/fee-transfers", chair)).status, 200, "the Chairman cannot see payments");
    assert.notEqual((await call("/exam-registration", chair)).status, 200);

    // Form rules in detail.
    const rules = { compulsorySubjects: settings.compulsorySubjects, optionalSubjects: settings.optionalSubjects, maxSubjects: 9 };
    assert.equal(formProblem(form, rules, "2026-11-09"), null);
    assert.match(formProblem({ ...form, subjects: form.subjects.slice(1) }, rules, "2026-11-09") ?? "", /Mathematics/);
    assert.match(formProblem({ ...form, subjects: [...form.subjects, "Dancing"] }, rules, "2026-11-09") ?? "", /Dancing/);
    assert.match(formProblem({ ...form, gender: "" }, rules, "2026-11-09") ?? "", /gender/);
    assert.match(formProblem({ ...form, signatureName: "Tolu" }, rules, "2026-11-09") ?? "", /surname/);
  } finally {
    server.close();
    if (studentIds.length) {
      await db.delete(examRegistrations).where(inArray(examRegistrations.studentId, studentIds));
      await db.delete(feePaymentReportsTable).where(inArray(feePaymentReportsTable.studentPortalId, studentIds));
      await db.delete(portalSessions).where(inArray(portalSessions.studentId, studentIds));
    }
    await db.delete(examRegistrationSettings).where(eq(examRegistrationSettings.academicYear, year));
    await db.delete(classFeeSchedulesTable).where(like(classFeeSchedulesTable.description, `${marker}%`));
    await db.delete(paymentAccounts).where(like(paymentAccounts.bankName, `${marker}%`));
    if (proofIds.length) await db.delete(portalImages).where(inArray(portalImages.id, proofIds));
    await db.delete(portalStudents).where(like(portalStudents.studentId, `${marker}%`));
    if (classIds.length) await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await pool.end();
  }
});
