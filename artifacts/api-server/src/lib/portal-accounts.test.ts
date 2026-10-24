import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { db, pool, portalAccountTokens, portalClasses, portalIdSequences, portalSessions, portalStudents } from "@workspace/db";
import portalRouter from "../routes/portal";
import { formatStudentId } from "./accounts";
import { hashPassword } from "./portal-auth";

// Database-only account lifecycle checks: automatic IDs, activation links, resets.
test("student accounts: automatic IDs, activation links, resets and forgot password", async () => {
  const saved = { admins: process.env.SCHOOL_ADMIN_EMAILS, site: process.env.PUBLIC_SITE_URL, key: process.env.RESEND_API_KEY };
  const marker = `QA-ACC-${randomUUID().slice(0, 8)}`.toUpperCase();
  process.env.SCHOOL_ADMIN_EMAILS = `admin-${marker}@example.test`.toLowerCase();
  process.env.PUBLIC_SITE_URL = "https://school.example";
  delete process.env.RESEND_API_KEY; // never send real email from tests
  const classIds: number[] = [];
  const year = new Date().getFullYear();
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
  async function call(path: string, method = "GET", body?: unknown, opts: { cookie?: string; admin?: boolean } = {}): Promise<{ status: number; cookie: string; data: any }> {
    const r = await fetch(root + path, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(opts.cookie ? { Cookie: opts.cookie } : {}), ...(opts.admin ? { "X-Test-Admin": marker } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "", data: r.status === 204 ? {} : await r.json() };
  }
  const tokenOf = (url: string) => new URL(url).searchParams.get("t")!;
  try {
    const [cls] = await db.insert(portalClasses).values({ name: marker }).returning(); classIds.push(cls.id);

    // Only administrators enrol; IDs are automatic and sequential, skipping numbers taken by hand.
    assert.equal((await call("/accounts/enrol", "POST", { name: "Nobody", classId: cls.id })).status, 401);
    const [seq] = await db.select().from(portalIdSequences).where(eq(portalIdSequences.year, year));
    const next = (seq?.last ?? 0) + 1;
    await db.insert(portalStudents).values({ studentId: formatStudentId(year, next), name: "Hand-made ID", classId: cls.id, passwordHash: await hashPassword("Placeholder-123") });
    assert.equal((await call("/accounts/enrol", "POST", { name: "Bad Email", classId: cls.id, guardianEmail: "not-an-email" }, { admin: true })).status, 400);
    const first = await call("/accounts/enrol", "POST", { name: "  Ada   Obi ", classId: cls.id, guardianEmail: "Parent@Example.TEST" }, { admin: true });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.student.studentId, formatStudentId(year, next + 1), "skips the number already taken");
    assert.equal(first.data.student.name, "Ada Obi");
    assert.equal(first.data.student.guardianEmail, "parent@example.test");
    assert.equal(first.data.emailed, false);
    assert.match(first.data.emailNote, /email is not set up/);
    assert.match(first.data.url, /^https:\/\/school\.example\/portal\/activate\?t=[a-f0-9]{64}$/, "links use the configured site address");
    const second = await call("/accounts/enrol", "POST", { name: "Bayo Ade", classId: cls.id }, { admin: true });
    assert.equal(second.data.student.studentId, formatStudentId(year, next + 2));
    assert.match(second.data.emailNote, /no parent email/);
    const legacy = await call("/accounts/enrol", "POST", { name: "Legacy Kid", classId: cls.id, studentId: `${marker}-OLD` }, { admin: true });
    assert.equal(legacy.data.student.studentId, `${marker}-OLD`);
    assert.equal((await call("/accounts/enrol", "POST", { name: "Dup", classId: cls.id, studentId: `${marker}-OLD` }, { admin: true })).status, 409);
    const [stored] = await db.select().from(portalAccountTokens).where(eq(portalAccountTokens.studentId, first.data.student.id));
    assert.notEqual(stored.tokenHash, tokenOf(first.data.url), "only a hash of the token is stored");

    // A pending account cannot sign in.
    const adaId = first.data.student.studentId;
    assert.equal((await call("/session", "POST", { studentId: adaId, password: "Anything-123" })).status, 401);

    // Emails go to a stand-in for Resend; nothing real is sent.
    const mails: { to: string[]; subject: string; text: string; html: string }[] = [];
    const realFetch = globalThis.fetch;
    const savedFrom = process.env.EMAIL_FROM;
    const emailOn = () => {
      process.env.RESEND_API_KEY = "re_test_fake";
      process.env.EMAIL_FROM = "New World Emerald <noreply@school.example>";
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        if (!String(input).startsWith("https://api.resend.com/")) return realFetch(input, init);
        mails.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
      }) as typeof fetch;
    };
    const emailOff = () => {
      delete process.env.RESEND_API_KEY;
      if (savedFrom === undefined) delete process.env.EMAIL_FROM; else process.env.EMAIL_FROM = savedFrom;
      globalThis.fetch = realFetch;
    };

    // Activation: details check, password rules, sign-in, single use.
    const t1 = tokenOf(first.data.url);
    assert.equal((await call("/accounts/token/check", "POST", { token: "x".repeat(64) })).status, 410);
    const info = await call("/accounts/token/check", "POST", { token: t1 });
    assert.deepEqual([info.data.purpose, info.data.studentName, info.data.studentId, info.data.className], ["activate", "Ada Obi", adaId, marker]);
    assert.equal((await call("/accounts/token/complete", "POST", { token: t1, password: "short1" })).status, 400);
    assert.equal((await call("/accounts/token/complete", "POST", { token: t1, password: "onlyletterslong" })).status, 400);
    emailOn();
    const done = await call("/accounts/token/complete", "POST", { token: t1, password: "Ada-Chosen-2026" });
    emailOff();
    assert.equal(done.status, 200);
    // The family is told the account is ready, with the sign-in details but never the password.
    assert.equal(mails.length, 1);
    assert.deepEqual(mails[0].to, ["parent@example.test"]);
    assert.match(mails[0].subject, /account is ready/);
    assert.ok(mails[0].text.includes(adaId) && mails[0].html.includes(adaId), "Student ID included");
    assert.ok(mails[0].text.includes("https://school.example/portal"), "sign-in link included");
    assert.ok(!mails[0].text.includes("Ada-Chosen-2026") && !mails[0].html.includes("Ada-Chosen-2026"), "the password is never emailed");
    assert.equal(done.data.role, "student");
    assert.equal((await call("/session", "GET", undefined, { cookie: done.cookie })).data.studentId, adaId, "activation signs the student in");
    assert.equal((await call("/accounts/token/complete", "POST", { token: t1, password: "Ada-Again-2026" })).status, 410, "links work once");
    assert.equal((await call("/session", "POST", { studentId: adaId.toLowerCase(), password: "Ada-Chosen-2026" })).status, 200);
    const [ada] = await db.select().from(portalStudents).where(eq(portalStudents.studentId, adaId));
    assert.equal(ada.accountStatus, "active");
    assert.ok(ada.activatedAt);

    // Link rules by status; a fresh link replaces the old one; expired links fail.
    assert.equal((await call(`/accounts/${ada.id}/link`, "POST", { purpose: "activate" }, { admin: true })).status, 409);
    const bayo = second.data.student.id;
    const again = await call(`/accounts/${bayo}/link`, "POST", { purpose: "activate", send: false }, { admin: true });
    assert.equal(again.status, 200);
    assert.equal((await call("/accounts/token/check", "POST", { token: tokenOf(second.data.url) })).status, 410, "earlier link replaced");
    await db.update(portalAccountTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(portalAccountTokens.studentId, bayo));
    assert.equal((await call("/accounts/token/check", "POST", { token: tokenOf(again.data.url) })).status, 410, "expired");

    // Reset link: signs out other devices; existing password stops working.
    const reset = await call(`/accounts/${ada.id}/link`, "POST", { purpose: "reset" }, { admin: true });
    assert.equal(reset.status, 200);
    assert.equal((await call("/accounts/token/check", "POST", { token: tokenOf(reset.data.url) })).data.purpose, "reset");
    emailOn();
    assert.equal((await call("/accounts/token/complete", "POST", { token: tokenOf(reset.data.url), password: "Ada-Reset-2027" })).status, 200);
    emailOff();
    assert.match(mails.at(-1)!.subject, /password was changed/, "a reset sends a security notice");
    assert.equal((await call("/session", "GET", undefined, { cookie: done.cookie })).data.role, "guest", "other devices signed out");
    assert.equal((await call("/session", "POST", { studentId: adaId, password: "Ada-Chosen-2026" })).status, 401);

    // Forgot password: identical reply whether or not the ID exists; a link is created only when possible.
    const real = await call("/accounts/forgot", "POST", { studentId: adaId });
    const fake = await call("/accounts/forgot", "POST", { studentId: `${marker}-NOBODY` });
    assert.equal(real.status, 200);
    assert.deepEqual(real.data, fake.data);

    // Existing accounts keep working; parent email can be edited through saveStudent.
    const existing = await call("/manage", "POST", { action: "saveStudent", student: { studentId: `${marker}-EX`, name: "Existing Kid", classId: cls.id, active: true, password: "Temporary-Pass-123" } }, { admin: true });
    assert.equal(existing.status, 200);
    assert.equal((await call("/session", "POST", { studentId: `${marker}-EX`, password: "Temporary-Pass-123" })).status, 200);
    const [ex] = await db.select().from(portalStudents).where(eq(portalStudents.studentId, `${marker}-EX`));
    assert.equal(ex.accountStatus, "active");
    assert.equal((await call("/manage", "POST", { action: "saveStudent", student: { id: ex.id, studentId: ex.studentId, name: ex.name, classId: cls.id, active: true, guardianEmail: "mum@example.test" } }, { admin: true })).status, 200);
    const mgmt = await call("/manage", "GET", undefined, { admin: true });
    const listed = mgmt.data.students.find((s: { id: number }) => s.id === ex.id);
    assert.deepEqual([listed.guardianEmail, listed.accountStatus], ["mum@example.test", "active"]);
    assert.equal(mgmt.data.students.find((s: { id: number }) => s.id === bayo).accountStatus, "pending");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    if (classIds.length) {
      const ids = (await db.select({ id: portalStudents.id }).from(portalStudents).where(inArray(portalStudents.classId, classIds))).map((s) => s.id);
      if (ids.length) {
        await db.delete(portalSessions).where(inArray(portalSessions.studentId, ids));
        await db.delete(portalAccountTokens).where(inArray(portalAccountTokens.studentId, ids));
      }
      await db.delete(portalStudents).where(inArray(portalStudents.classId, classIds));
      await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    }
    for (const [k, v] of [["SCHOOL_ADMIN_EMAILS", saved.admins], ["PUBLIC_SITE_URL", saved.site], ["RESEND_API_KEY", saved.key]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    await pool.end();
  }
});
