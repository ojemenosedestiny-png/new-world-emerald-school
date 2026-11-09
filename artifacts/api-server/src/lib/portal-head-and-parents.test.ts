import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";
import { db, pool, portalAttendance, portalClasses, portalStudents, portalTeachers, schoolMessageRecipients, schoolMessages } from "@workspace/db";
import portalRouter from "../routes/portal";
import { setApprovedIdentitiesForTest } from "./approved-identities";
import { hashPassword } from "./portal-auth";
import { setParentEmailResolverForTest } from "../routes/portal-parent";
import { sendPendingSchoolEmails, setSchoolEmailSenderForTest } from "../routes/portal-school-email";

// Database checks for the Head of School and Director's private emails, parent links, and a child's progress for parents.
test("head of school and parents: private emails to teachers and parents, two parents per child, a child's progress", async () => {
  const marker = `QA-HOS-${randomUUID().slice(0, 8)}`.toUpperCase();
  const lower = marker.toLowerCase();
  const head = `head-${lower}@example.test`, director = `director-${lower}@example.test`, office = `office-${lower}@example.test`;
  const mum = `mum-${lower}@example.test`, dad = `dad-${lower}@example.test`, stranger = `stranger-${lower}@example.test`;
  const saved = Object.fromEntries(["SCHOOL_ADMIN_EMAILS", "SCHOOL_SUPER_ADMIN_EMAILS", "SCHOOL_HEAD_EMAILS", "SCHOOL_DIRECTOR_EMAILS", "RESEND_API_KEY", "EMAIL_FROM", "SCHOOL_EMAIL_DAILY_LIMIT"].map((k) => [k, process.env[k]]));
  process.env.SCHOOL_ADMIN_EMAILS = [office, director].join(",");
  process.env.SCHOOL_SUPER_ADMIN_EMAILS = office;
  process.env.SCHOOL_HEAD_EMAILS = head; // the Head of School counts as an administrator without being listed
  process.env.SCHOOL_DIRECTOR_EMAILS = director;
  process.env.RESEND_API_KEY = "re_test_only";
  process.env.EMAIL_FROM = "New World Emerald <portal@example.test>";
  setApprovedIdentitiesForTest([head, director, office].map((e) => [`id-${e}`, { email: e, mfa: true }]));
  const delivered: { to: string; replyTo?: string; subject: string; text: string }[] = [];
  setSchoolEmailSenderForTest(async (m) => { delivered.push(m); return m.to.startsWith("bounce") ? { sent: false, reason: "rejected", detail: "Mailbox full" } : { sent: true }; });
  let parentEmail: string | null = null;
  setParentEmailResolverForTest(async () => parentEmail);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error() {}, warn() {}, info() {} } as unknown as typeof req.log;
    const who = req.headers["x-test-user"];
    if (typeof who === "string") {
      req.dbUser = { id: `id-${who}`, firstName: who === head ? "Grace" : "Ade", lastName: who === head ? "Okafor" : "Bello" } as NonNullable<typeof req.dbUser>;
      req.identity = { email: who, emailVerified: true, mfa: true };
    }
    next();
  });
  app.use("/api/portal", portalRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/portal`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (path: string, who: string | null, body?: unknown): Promise<{ status: number; data: any }> => {
    const r = await fetch(root + path, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...(who ? { "X-Test-User": who } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  const classIds: number[] = [];
  const messageIds: number[] = [];
  try {
    const [jss1] = await db.insert(portalClasses).values({ name: `${marker} JSS 1` }).returning();
    const [year3] = await db.insert(portalClasses).values({ name: `${marker} Year 3` }).returning();
    classIds.push(jss1.id, year3.id);
    await db.insert(portalTeachers).values([
      { email: `musa-${lower}@example.test`, name: `${marker} Mr Musa`, classIds: [jss1.id], active: true },
      { email: `bounce-${lower}@example.test`, name: `${marker} Mrs Bounce`, classIds: [], active: true },
    ]);
    const pw = await hashPassword("Head-Test-1");
    const [ada] = await db.insert(portalStudents).values({ studentId: `${marker}-1`, name: "Ada Obi", classId: jss1.id, passwordHash: pw, guardianEmail: mum }).returning();
    const [chi] = await db.insert(portalStudents).values({ studentId: `${marker}-2`, name: "Chi Obi", classId: year3.id, passwordHash: pw }).returning();
    const [other] = await db.insert(portalStudents).values({ studentId: `${marker}-3`, name: "Not Theirs", classId: jss1.id, passwordHash: pw, guardianEmail: stranger }).returning();

    // The office links parents: Chi gets mum, Ada gets dad as her second parent.
    assert.equal((await call("/parent-links", head)).status, 200, "the Head of School is an administrator");
    const link = (action: string, email: string, studentId: number) => call("/parent-links", office, { action, email, studentId });
    assert.equal((await link("link", mum, chi.id)).status, 200);
    assert.equal((await link("link", dad, ada.id)).status, 200);
    assert.equal((await link("link", dad, ada.id)).status, 409, "already linked");
    assert.equal((await link("link", stranger, ada.id)).status, 409, "two parents at most");
    assert.equal((await link("link", "not-an-email", chi.id)).status, 400);
    const links = await call("/parent-links", office);
    assert.deepEqual(links.data.parents.find((p: { email: string }) => p.email === mum).children.map((c: { name: string }) => c.name), ["Ada Obi", "Chi Obi"]);
    assert.deepEqual(links.data.parents.find((p: { email: string }) => p.email === dad).children.map((c: { slot: string }) => c.slot), ["second"]);

    // Parents see their own children (through either link) and their progress; never another family's child.
    parentEmail = dad;
    const dadView = await call("/parent", "parent");
    assert.deepEqual(dadView.data.children.map((c: { name: string }) => c.name), ["Ada Obi"]);
    await db.insert(portalAttendance).values([{ classId: jss1.id, studentId: ada.id, date: new Date().toISOString().slice(0, 10), status: "present" }]);
    const progress = await call(`/parent/children/${ada.id}`, "parent");
    assert.equal(progress.status, 200, JSON.stringify(progress.data));
    assert.deepEqual([progress.data.child.name, progress.data.attendance.totals.present, progress.data.reports, progress.data.results, progress.data.homework], ["Ada Obi", 1, [], [], []]);
    assert.equal((await call(`/parent/children/${chi.id}`, "parent")).status, 404, "dad is not linked to Chi");
    assert.equal((await call(`/parent/children/${other.id}`, "parent")).status, 404);
    parentEmail = mum;
    assert.deepEqual((await call("/parent", "parent")).data.children.map((c: { name: string }) => c.name), ["Ada Obi", "Chi Obi"]);
    // Unlinking the first parent moves the second up.
    assert.equal((await link("unlink", mum, ada.id)).status, 200);
    const [ada2] = await db.select().from(portalStudents).where(eq(portalStudents.id, ada.id));
    assert.deepEqual([ada2.guardianEmail, ada2.secondGuardianEmail], [dad, null]);

    // Who may send: the Director and the Head of School, not the office.
    assert.equal((await call("/school-email", office)).status, 403);
    assert.equal((await call("/school-email", null)).status, 401);
    const hosView = await call("/school-email", head);
    assert.equal(hosView.status, 200, JSON.stringify(hosView.data));
    assert.deepEqual([hosView.data.sender.role, hosView.data.sender.name], ["head", "Grace Okafor"]);
    const mine = hosView.data.people.filter((p: { email: string }) => p.email.includes(lower));
    assert.deepEqual(mine.map((p: { kind: string; name: string }) => `${p.kind}:${p.name}`).sort(), [
      `parent:Parent of Ada Obi`, `parent:Parent of Chi Obi`, `parent:Parent of Not Theirs`, `teacher:${marker} Mr Musa`, `teacher:${marker} Mrs Bounce`,
    ].sort());
    assert.equal((await call("/school-email", director)).data.sender.role, "director");
    // Someone listed as both Director and Head of School is the Head of School here.
    process.env.SCHOOL_DIRECTOR_EMAILS = `${director},"${head}"`;
    assert.equal((await call("/school-email", head)).data.sender.role, "head");
    process.env.SCHOOL_DIRECTOR_EMAILS = director;

    // Only real teachers and parents can be chosen.
    const send = (who: string, recipients: object[], extra = {}) => call("/school-email", who, { subject: "PTA meeting", message: "Dear all\n\nWe meet on Friday.", recipients, ...extra });
    assert.equal((await send(head, [{ kind: "parent", email: "random@example.test" }])).status, 400);
    assert.equal((await send(head, [{ kind: "teacher", email: mum }])).status, 400, "a parent cannot be emailed as a teacher");
    process.env.SCHOOL_EMAIL_DAILY_LIMIT = "2";
    assert.equal((await send(head, [{ kind: "teacher", email: `musa-${lower}@example.test` }, { kind: "parent", email: mum }, { kind: "parent", email: dad }])).status, 429);
    delete process.env.SCHOOL_EMAIL_DAILY_LIMIT;

    const sent = await send(head, [{ kind: "teacher", email: `musa-${lower}@example.test` }, { kind: "teacher", email: `bounce-${lower}@example.test` }, { kind: "parent", email: dad }, { kind: "parent", email: dad }]);
    assert.equal(sent.status, 200, JSON.stringify(sent.data));
    messageIds.push(sent.data.id);
    assert.equal(sent.data.recipients, 3, "the same person is emailed once");
    await sendPendingSchoolEmails(0);
    for (let i = 0; i < 50 && (await db.select().from(schoolMessages).where(eq(schoolMessages.id, sent.data.id)))[0].status !== "done"; i++) await new Promise((r) => setTimeout(r, 100));
    const mineSent = delivered.filter((d) => d.to.includes(lower));
    assert.equal(mineSent.length, 3, "one private email each");
    assert.ok(mineSent.every((d) => d.replyTo === head && d.subject === "PTA meeting"), "replies go to the Head of School");
    assert.match(mineSent.find((d) => d.to === dad)!.text, /^Dear Parent of Ada Obi,\n\nDear all/);
    assert.match(mineSent.find((d) => d.to.startsWith("musa"))!.text, new RegExp(`^Dear ${marker} Mr Musa,`));
    assert.match(mineSent[0].text, /Grace Okafor\nHead of School, New World Emerald Private School/);
    const detail = await call(`/school-email/${sent.data.id}`, head);
    assert.deepEqual([detail.data.message.status, detail.data.message.sent, detail.data.message.failed], ["done", 2, 1]);
    assert.equal(detail.data.recipients.find((r: { email: string }) => r.email.startsWith("bounce")).detail, "Mailbox full");
    // The Director sees the Head of School's email in the shared history.
    assert.ok((await call("/school-email", director)).data.history.some((h: { id: number; senderRole: string }) => h.id === sent.data.id && h.senderRole === "head"));
    // The parent's sign-in link fills in their email; inviting needs a valid email.
    assert.equal((await call("/parent-links", office, { action: "invite", email: "nope" })).status, 400);
    setSchoolEmailSenderForTest(async () => ({ sent: true }));
  } finally {
    await new Promise((r) => setTimeout(r, 900));
    server.close();
    setSchoolEmailSenderForTest(async () => ({ sent: false, reason: "not_configured" }));
    if (messageIds.length) { await db.delete(schoolMessageRecipients).where(inArray(schoolMessageRecipients.messageId, messageIds)); await db.delete(schoolMessages).where(inArray(schoolMessages.id, messageIds)); }
    if (classIds.length) await db.delete(portalAttendance).where(inArray(portalAttendance.classId, classIds));
    await db.delete(portalStudents).where(like(portalStudents.studentId, `${marker}%`));
    await db.delete(portalTeachers).where(like(portalTeachers.name, `${marker}%`));
    if (classIds.length) await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await pool.end();
  }
});
