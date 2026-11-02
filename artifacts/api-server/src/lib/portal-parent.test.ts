import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";
import { classFeeSchedulesTable, db, parentPayments, parentWalletEntries, parentWallets, pool, portalClasses, portalStudents } from "@workspace/db";
import portalRouter from "../routes/portal";
import { setParentEmailResolverForTest } from "../routes/portal-parent";
import { hashPassword } from "./portal-auth";

// Database checks for the parent portal: who sees which child, Paystack payments, part payments,
// overpayment into the wallet, wallet-only payments, tampering, and the office's receipts.
test("parents: children, Paystack payments, wallet and office receipts", async () => {
  const saved = { admins: process.env.SCHOOL_ADMIN_EMAILS, key: process.env.PAYSTACK_SECRET_KEY, resend: process.env.RESEND_API_KEY };
  const marker = `QA-PAR-${randomUUID().slice(0, 8)}`.toUpperCase();
  const lower = marker.toLowerCase();
  process.env.SCHOOL_ADMIN_EMAILS = `admin-${lower}@example.test`;
  process.env.PAYSTACK_SECRET_KEY = "sk_test_fakeschoolkey123";
  delete process.env.RESEND_API_KEY;
  const mum = `mum-${lower}@example.test`;
  const other = `other-${lower}@example.test`;

  // A stand-in for Paystack: remembers what was started and answers verification as the test decides.
  const paystack = new Map<string, { amount: number; status: string; currency?: string }>();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://api.paystack.co/")) return realFetch(input, init);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer sk_test_fakeschoolkey123");
    if (url.endsWith("/transaction/initialize")) {
      const b = JSON.parse(String(init?.body));
      assert.equal(b.currency, "NGN");
      paystack.set(b.reference, { amount: b.amount, status: "abandoned" });
      return new Response(JSON.stringify({ status: true, data: { authorization_url: `https://checkout.paystack.com/${b.reference}`, reference: b.reference } }), { status: 200 });
    }
    const ref = decodeURIComponent(url.split("/transaction/verify/")[1]);
    const t = paystack.get(ref);
    if (!t) return new Response(JSON.stringify({ status: false, message: "Transaction reference not found" }), { status: 400 });
    return new Response(JSON.stringify({ status: true, data: { status: t.status, amount: t.amount, currency: t.currency ?? "NGN", reference: ref, channel: "card", paid_at: new Date().toISOString(), gateway_response: "Successful" } }), { status: 200 });
  }) as typeof fetch;

  setParentEmailResolverForTest(async (req) => {
    const e = req.headers["x-test-parent"];
    return typeof e === "string" ? e : null;
  });
  const classIds: number[] = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error() {}, warn() {}, info() {} } as unknown as typeof req.log;
    if (req.headers["x-test-admin"] === marker) {
      req.dbUser = { id: `synthetic-${marker}` } as NonNullable<typeof req.dbUser>;
      req.identity = { email: `admin-${lower}@example.test`, emailVerified: true, mfa: true };
    }
    next();
  });
  app.use("/api/portal", portalRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/portal`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function call(path: string, opts: { parent?: string; admin?: boolean; body?: unknown } = {}): Promise<{ status: number; data: any }> {
    const r = await realFetch(root + path, {
      method: opts.body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...(opts.parent ? { "X-Test-Parent": opts.parent } : {}), ...(opts.admin ? { "X-Test-Admin": marker } : {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    return { status: r.status, data: await r.json() };
  }
  const pay = (parent: string, items: { studentId: number; itemKey: string }[], amountKobo: number) => call("/parent/payments", { parent, body: { items, amountKobo } });
  const verify = (parent: string, ref: string) => call(`/parent/payments/${ref}/verify`, { parent, body: {} });

  try {
    const [jss] = await db.insert(portalClasses).values({ name: `${marker} JSS 1` }).returning();
    const [ss1] = await db.insert(portalClasses).values({ name: `${marker} SS 1` }).returning();
    classIds.push(jss.id, ss1.id);
    const pw = await hashPassword("Parent-Test-1");
    const [ada] = await db.insert(portalStudents).values({ studentId: `${marker}-1`, name: "Ada Obi", classId: jss.id, passwordHash: pw, guardianEmail: ` ${mum.toUpperCase()} ` }).returning();
    const [ben] = await db.insert(portalStudents).values({ studentId: `${marker}-2`, name: "Ben Obi", classId: ss1.id, passwordHash: pw, guardianEmail: mum }).returning();
    await db.insert(portalStudents).values({ studentId: `${marker}-3`, name: "Not Hers", classId: jss.id, passwordHash: pw, guardianEmail: other });
    const [jssFee] = await db.insert(classFeeSchedulesTable).values({ className: `${marker} JSS 1`, term: "First Term", academicYear: "2026/2027", amountKobo: 80_000_00, description: "Tuition" }).returning();
    const [ssFee] = await db.insert(classFeeSchedulesTable).values({ className: `${marker} SS 1`, term: "First Term", academicYear: "2026/2027", amountKobo: 100_000_00, description: "Tuition" }).returning();
    const adaFee = { studentId: ada.id, itemKey: `class-${jssFee.id}` };
    const benFee = { studentId: ben.id, itemKey: `class-${ssFee.id}` };

    // Signed out, or an email with no children: no access to anyone's details.
    assert.equal((await call("/parent")).status, 401);
    const nobody = await call("/parent", { parent: `nobody-${lower}@example.test` });
    assert.equal(nobody.status, 200);
    assert.deepEqual(nobody.data.children, []);
    assert.equal((await pay(`nobody-${lower}@example.test`, [adaFee], 10_000_00)).status, 403);

    // The parent sees exactly her two children (email matched regardless of case and spaces), with names and IDs.
    const home = await call("/parent", { parent: mum });
    assert.equal(home.status, 200, JSON.stringify(home.data));
    assert.deepEqual(home.data.children.map((c: { name: string; studentId: string }) => [c.name, c.studentId]), [["Ada Obi", `${marker}-1`], ["Ben Obi", `${marker}-2`]]);
    assert.equal(home.data.paystackReady, true);
    assert.equal(home.data.wallet.balanceKobo, 0);
    assert.equal(home.data.outstanding.length, 2);

    // She cannot pay another family's fee, the same fee twice, or a tiny amount.
    const theirs = (await call("/parent", { parent: other })).data.outstanding[0];
    assert.equal((await pay(mum, [{ studentId: theirs.studentId, itemKey: theirs.itemKey }], 10_000_00)).status, 400);
    assert.equal((await pay(mum, [adaFee, adaFee], 10_000_00)).status, 400);
    assert.equal((await pay(mum, [adaFee], 50_00)).status, 400);
    assert.equal((await pay(mum, [adaFee], 0)).status, 400, "zero needs a wallet balance");

    // 1. Part payment by card: 30,000 towards Ada's 80,000. Nothing is applied until Paystack confirms.
    const part = await pay(mum, [adaFee], 30_000_00);
    assert.equal(part.status, 200, JSON.stringify(part.data));
    assert.match(part.data.authorizationUrl, /^https:\/\/checkout\.paystack\.com\//);
    assert.equal((await verify(mum, part.data.reference)).data.status, "pending", "the parent has not paid yet");
    assert.equal((await verify(other, part.data.reference)).status, 404, "another parent cannot see this payment");
    paystack.get(part.data.reference)!.status = "success";
    const partDone = await verify(mum, part.data.reference);
    assert.equal(partDone.data.status, "success");
    assert.deepEqual(partDone.data.allocations.map((a: { itemKey: string; amountKobo: number }) => [a.itemKey, a.amountKobo]), [[adaFee.itemKey, 30_000_00]]);
    assert.equal(partDone.data.walletCreditKobo, 0);
    // Verifying again changes nothing.
    assert.equal((await verify(mum, part.data.reference)).data.appliedKobo, 30_000_00);
    let after = await call("/parent", { parent: mum });
    const adaItem = after.data.children[0].statement.items[0];
    assert.deepEqual([adaItem.paidKobo, adaItem.status], [30_000_00, "due"]);
    assert.equal(after.data.outstanding.find((o: { itemKey: string }) => o.itemKey === adaFee.itemKey).outstandingKobo, 50_000_00);

    // 2. Overpayment: 200,000 for Ada's remaining 50,000 and Ben's 100,000; the extra 50,000 goes to the wallet.
    const big = await pay(mum, [adaFee, benFee], 200_000_00);
    paystack.get(big.data.reference)!.status = "success";
    const bigDone = await verify(mum, big.data.reference);
    assert.equal(bigDone.data.appliedKobo, 150_000_00);
    assert.equal(bigDone.data.walletCreditKobo, 50_000_00);
    after = await call("/parent", { parent: mum });
    assert.equal(after.data.wallet.balanceKobo, 50_000_00);
    assert.deepEqual(after.data.children.map((c: { statement: { items: { status: string }[] } }) => c.statement.items[0].status), ["paid", "paid"]);
    assert.equal(after.data.outstanding.length, 0);
    assert.equal((await pay(mum, [adaFee], 10_000_00)).status, 400, "a paid fee cannot be paid again");

    // 3. Next term: the wallet completes a smaller card payment.
    const [term2] = await db.insert(classFeeSchedulesTable).values({ className: `${marker} JSS 1`, term: "Second Term", academicYear: "2026/2027", amountKobo: 80_000_00, description: "Tuition" }).returning();
    const next = { studentId: ada.id, itemKey: `class-${term2.id}` };
    const topUp = await pay(mum, [next], 30_000_00);
    paystack.get(topUp.data.reference)!.status = "success";
    const topUpDone = await verify(mum, topUp.data.reference);
    assert.deepEqual([topUpDone.data.walletUsedKobo, topUpDone.data.appliedKobo, topUpDone.data.walletCreditKobo], [50_000_00, 80_000_00, 0]);
    after = await call("/parent", { parent: mum });
    assert.equal(after.data.wallet.balanceKobo, 0);
    assert.deepEqual(after.data.wallet.entries.map((e: { kind: string; amountKobo: number }) => [e.kind, e.amountKobo]), [["used", -50_000_00], ["overpayment", 50_000_00]]);

    // 4. Tampering: Paystack reports a different amount from the one started: nothing is applied.
    const [term3] = await db.insert(classFeeSchedulesTable).values({ className: `${marker} SS 1`, term: "Second Term", academicYear: "2026/2027", amountKobo: 100_000_00, description: "Tuition" }).returning();
    const bad = await pay(mum, [{ studentId: ben.id, itemKey: `class-${term3.id}` }], 100_000_00);
    paystack.set(bad.data.reference, { amount: 100_00, status: "success" });
    assert.equal((await verify(mum, bad.data.reference)).data.status, "failed");
    after = await call("/parent", { parent: mum });
    assert.equal(after.data.outstanding.find((o: { studentId: number }) => o.studentId === ben.id).outstandingKobo, 100_000_00);
    // A declined card closes the payment without applying anything.
    const declined = await pay(mum, [{ studentId: ben.id, itemKey: `class-${term3.id}` }], 100_000_00);
    paystack.get(declined.data.reference)!.status = "failed";
    assert.equal((await verify(mum, declined.data.reference)).data.status, "failed");

    // 5. The student's own statement shows the online payments.
    const office = await call(`/students/${ada.id}/fees`, { admin: true });
    assert.equal(office.data.totals.outstandingKobo, 0);
    assert.ok(office.data.payments.some((p: { description: string }) => p.description === "Online payment (Paystack)"));

    // 6. The office sees every receipt and can record a refund; nobody else can.
    assert.equal((await call("/parent-payments", { parent: mum })).status, 401);
    const receipts = await call("/parent-payments", { admin: true });
    assert.equal(receipts.status, 200);
    const ours = receipts.data.payments.filter((p: { parentEmail: string }) => p.parentEmail === mum);
    assert.deepEqual(ours.filter((p: { status: string }) => p.status === "success").length, 3);
    await db.update(parentWallets).set({ balanceKobo: 10_000_00 }).where(eq(parentWallets.email, mum));
    assert.equal((await call("/parent-wallets/adjust", { admin: true, body: { email: mum, amountKobo: -20_000_00, note: "Refunded in cash" } })).status, 400, "a wallet cannot go below zero");
    const refund = await call("/parent-wallets/adjust", { admin: true, body: { email: mum, amountKobo: -10_000_00, note: "Refunded in cash" } });
    assert.equal(refund.status, 200, JSON.stringify(refund.data));
    assert.equal((await call("/parent", { parent: mum })).data.wallet.balanceKobo, 0);
    assert.equal((await call("/parent-wallets/adjust", { parent: mum, body: { email: mum, amountKobo: 10_000_00, note: "Free money" } })).status, 401);
  } finally {
    globalThis.fetch = realFetch;
    setParentEmailResolverForTest(async () => null);
    server.close();
    await db.delete(parentPayments).where(inArray(parentPayments.parentEmail, [mum, other]));
    await db.delete(parentWalletEntries).where(inArray(parentWalletEntries.email, [mum, other]));
    await db.delete(parentWallets).where(inArray(parentWallets.email, [mum, other]));
    await db.delete(classFeeSchedulesTable).where(like(classFeeSchedulesTable.className, `${marker}%`));
    await db.delete(portalStudents).where(like(portalStudents.studentId, `${marker}%`));
    if (classIds.length) await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    for (const [k, v] of [["SCHOOL_ADMIN_EMAILS", saved.admins], ["PAYSTACK_SECRET_KEY", saved.key], ["RESEND_API_KEY", saved.resend]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    await pool.end();
  }
});
