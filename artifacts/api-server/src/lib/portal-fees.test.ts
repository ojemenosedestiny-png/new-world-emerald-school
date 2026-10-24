import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { inArray, like } from "drizzle-orm";
import { classFeeSchedulesTable, db, feePaymentReportsTable, individualFeeChargesTable, pool, portalClasses, portalSessions, portalStudents } from "@workspace/db";
import portalRouter from "../routes/portal";
import { hashPassword } from "./portal-auth";

// Database checks for per-student fee statements: matching, isolation and office access.
test("fees: student statement and office view", async () => {
  const saved = process.env.SCHOOL_ADMIN_EMAILS;
  const marker = `QA-FEE-${randomUUID().slice(0, 8)}`.toUpperCase();
  process.env.SCHOOL_ADMIN_EMAILS = `admin-${marker}@example.test`.toLowerCase();
  const classIds: number[] = [];
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
  async function call(path: string, opts: { cookie?: string; admin?: boolean } = {}): Promise<{ status: number; data: any }> {
    const r = await fetch(root + path, { headers: { ...(opts.cookie ? { Cookie: opts.cookie } : {}), ...(opts.admin ? { "X-Test-Admin": marker } : {}) } });
    return { status: r.status, data: await r.json() };
  }
  try {
    const className = `${marker} JSS 1`;
    const [cls] = await db.insert(portalClasses).values({ name: className }).returning();
    classIds.push(cls.id);
    const pw = await hashPassword("Fees-Pass-1");
    const [ada, bayo] = await db.insert(portalStudents).values([
      { studentId: marker + "/1", name: "Ada Obi", classId: cls.id, passwordHash: pw, mustChangePassword: false },
      { studentId: marker + "/2", name: "Bayo Ade", classId: cls.id, passwordHash: pw, mustChangePassword: false },
    ]).returning();
    // The office typed the class name and student ID with different spacing and case.
    const [sched] = await db.insert(classFeeSchedulesTable).values({ className: className.toLowerCase().replace(/ /g, "  "), term: "First Term", academicYear: "2099/2100", amountKobo: 150_000_00, description: "Tuition" }).returning();
    const [chg] = await db.insert(individualFeeChargesTable).values({ reference: `${marker}-C1`, studentName: "Ada Obi", studentIdentifier: ` ${ada.studentId.toLowerCase()} `, className, term: "First Term", academicYear: "2099/2100", description: "Excursion", amountKobo: 10_000_00 }).returning();
    await db.insert(feePaymentReportsTable).values({ reference: `${marker}-P1`, feeType: "class", scheduleId: sched.id, studentName: "Ada Obi", studentIdentifier: ada.studentId, className, term: "First Term", academicYear: "2099/2100", amountKobo: 150_000_00, guardianName: "Mrs Obi", guardianEmail: "parent@example.test", guardianPhone: "08000000000", status: "confirmed" });
    const login = async (id: string) => ({ cookie: (await fetch(root + "/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: id, password: "Fees-Pass-1" }) })).headers.get("set-cookie")!.split(";")[0] });
    const adaS = await login(ada.studentId), bayoS = await login(bayo.studentId);

    assert.equal((await call("/my-fees")).status, 401);
    const mine = await call("/my-fees", adaS);
    assert.equal(mine.status, 200, JSON.stringify(mine.data));
    const items = mine.data.items.filter((i: { academicYear: string }) => i.academicYear === "2099/2100");
    assert.deepEqual(items.map((i: { key: string; status: string }) => [i.key, i.status]).sort(), [[`charge-${chg.id}`, "due"], [`class-${sched.id}`, "paid"]]);
    assert.equal(mine.data.payments.length, 1);

    // Bayo shares the class fee but not Ada's charge or payment.
    const his = await call("/my-fees", bayoS);
    const hisItems = his.data.items.filter((i: { academicYear: string }) => i.academicYear === "2099/2100");
    assert.deepEqual(hisItems.map((i: { key: string; status: string }) => [i.key, i.status]), [[`class-${sched.id}`, "due"]]);
    assert.equal(his.data.payments.length, 0);

    // The office can open any statement; students cannot open someone else's.
    assert.equal((await call(`/students/${ada.id}/fees`, bayoS)).status, 403);
    assert.equal((await call(`/students/999999999/fees`, { admin: true })).status, 404);
    const office = await call(`/students/${ada.id}/fees`, { admin: true });
    assert.deepEqual([office.data.studentName, office.data.className], ["Ada Obi", className]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    await db.delete(feePaymentReportsTable).where(like(feePaymentReportsTable.reference, `${marker}%`));
    await db.delete(individualFeeChargesTable).where(like(individualFeeChargesTable.reference, `${marker}%`));
    await db.delete(classFeeSchedulesTable).where(like(classFeeSchedulesTable.className, `${marker.toLowerCase()}%`));
    if (classIds.length) {
      const ids = (await db.select({ id: portalStudents.id }).from(portalStudents).where(inArray(portalStudents.classId, classIds))).map((s) => s.id);
      if (ids.length) await db.delete(portalSessions).where(inArray(portalSessions.studentId, ids));
      await db.delete(portalStudents).where(inArray(portalStudents.classId, classIds));
      await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    }
    if (saved === undefined) delete process.env.SCHOOL_ADMIN_EMAILS; else process.env.SCHOOL_ADMIN_EMAILS = saved;
    await pool.end();
  }
});
