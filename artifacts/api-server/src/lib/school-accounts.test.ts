import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { inArray, like } from "drizzle-orm";
import { db, feePaymentReportsTable, pool, portalImages, schoolTransactions, storeOrdersTable } from "@workspace/db";
import portalRouter from "../routes/portal";
import chairmanRouter from "../routes/chairman";
import { setApprovedIdentitiesForTest } from "./approved-identities";

// Database checks for the school accounts: the bursar records income and spending, spending waits for the school
// owner, fee transfers and store orders appear on their own, and nobody else can open the accounts.
test("school accounts: bursar records, the owner approves spending, portal income appears by itself", async () => {
  const marker = `QA-ACC-${randomUUID().slice(0, 8)}`.toUpperCase();
  const lower = marker.toLowerCase();
  const owner = `owner-${lower}@example.test`, bursar = `bursar-${lower}@example.test`, head = `head-${lower}@example.test`;
  const chair = `chair-${lower}@example.test`, outsider = `outsider-${lower}@example.test`;
  const keys = ["SCHOOL_ADMIN_EMAILS", "SCHOOL_SUPER_ADMIN_EMAILS", "SCHOOL_HEAD_EMAILS", "SCHOOL_CHAIRMAN_EMAILS", "SCHOOL_BURSAR_EMAILS"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.SCHOOL_ADMIN_EMAILS = owner;
  process.env.SCHOOL_SUPER_ADMIN_EMAILS = owner;
  process.env.SCHOOL_HEAD_EMAILS = head;
  process.env.SCHOOL_CHAIRMAN_EMAILS = chair;
  process.env.SCHOOL_BURSAR_EMAILS = bursar;
  setApprovedIdentitiesForTest([owner, head, bursar, chair].map((e) => [`id-${e}`, { email: e, mfa: true }]));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error() {}, warn() {}, info() {} } as unknown as typeof req.log;
    const who = req.headers["x-test-user"];
    if (typeof who === "string") {
      req.dbUser = { id: `id-${who}` } as NonNullable<typeof req.dbUser>;
      req.identity = { email: who, emailVerified: true, mfa: true };
    }
    next();
  });
  app.use("/api/portal", portalRouter);
  app.use("/api", chairmanRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (path: string, who: string | null, body?: unknown): Promise<{ status: number; data: any }> => {
    const r = await fetch(base + "/portal" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...(who ? { "X-Test-User": who } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: r.headers.get("content-type")?.includes("json") ? await r.json() : null };
  };
  const proofIds: string[] = [];
  const proof = async () => { const id = randomUUID(); proofIds.push(id); await db.insert(portalImages).values({ id, objectName: `proof-${id}`, contentType: "image/png", size: 10, purpose: "payment" }); return id; };
  const today = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
  const range = `?from=${today.slice(0, 8)}01&to=${today}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mine = (list: any[]) => list.filter((e) => String(e.description).includes(marker));
  try {
    // Only the bursar and the school owner. The Head of School and the Chairman are kept out.
    assert.equal((await call("/accounts", null)).status, 401);
    for (const who of [head, chair, outsider]) assert.equal((await call("/accounts", who)).status, 403, who);
    const first = await call("/accounts" + range, bursar);
    assert.equal(first.status, 200);
    assert.equal(first.data.role, "bursar");
    assert.equal(first.data.canApprove, false);
    const balanceBefore: number = first.data.totals.balanceKobo;

    // Recording checks.
    const spend = (b: object) => call("/accounts/transactions", bursar, { direction: "out", category: "Electricity and diesel", description: `${marker} diesel for the generator`, counterparty: "Total filling station", amountKobo: 85_000_00, date: today, method: "transfer", ...b });
    assert.equal((await spend({ category: "Holiday" })).status, 400, "category from the list");
    assert.equal((await spend({ amountKobo: 0 })).status, 400);
    assert.equal((await spend({ date: "2999-01-01" })).status, 400, "no future dates");
    assert.equal((await spend({ date: "2026-02-30" })).status, 400, "real dates only");
    assert.equal((await spend({ counterparty: "" })).status, 400, "who was paid");
    assert.equal((await spend({ receiptId: randomUUID() })).status, 400, "unknown receipt");

    // Income counts at once.
    const receipt = await proof();
    const gift = await call("/accounts/transactions", bursar, { direction: "in", category: "Donation", description: `${marker} PTA donation for chairs`, counterparty: "PTA", amountKobo: 200_000_00, date: today, method: "cash", receiptId: receipt });
    assert.equal(gift.status, 200);
    assert.equal(gift.data.status, "approved");
    assert.equal((await spend({ receiptId: receipt })).status, 400, "a receipt photo belongs to one entry");

    // Spending waits for the owner.
    const diesel = await spend({ receiptId: await proof() });
    assert.equal(diesel.status, 200);
    assert.equal(diesel.data.status, "pending");
    const salary = await spend({ category: "Salaries and wages", description: `${marker} cleaner's wage`, counterparty: "Mrs Bello", amountKobo: 40_000_00 });
    const mistake = await spend({ description: `${marker} typed twice`, amountKobo: 1_000_00 });
    let view = await call("/accounts" + range, bursar);
    assert.equal(mine(view.data.pending).length, 3);
    assert.equal(view.data.totals.balanceKobo, balanceBefore + 200_000_00, "waiting spending is not counted");

    // The bursar cannot approve; can withdraw their own waiting entry.
    assert.equal((await call(`/accounts/transactions/${diesel.data.id}`, bursar, { action: "approve" })).status, 403);
    assert.equal((await call(`/accounts/transactions/${mistake.data.id}`, bursar, { action: "cancel" })).data.status, "void");
    assert.equal((await call(`/accounts/transactions/${mistake.data.id}`, bursar, { action: "cancel" })).status, 409);
    assert.equal((await call(`/accounts/transactions/${gift.data.id}`, bursar, { action: "void", note: "wrong" })).status, 403);

    // The owner approves or rejects (with a reason).
    const ownerView = await call("/accounts" + range, owner);
    assert.equal(ownerView.data.role, "owner");
    assert.equal(ownerView.data.canApprove, true);
    assert.equal((await call(`/accounts/transactions/${salary.data.id}`, owner, { action: "reject" })).status, 400, "a reason is needed");
    assert.equal((await call(`/accounts/transactions/${salary.data.id}`, owner, { action: "reject", note: "Paid already in October" })).data.status, "rejected");
    const ok = await call(`/accounts/transactions/${diesel.data.id}`, owner, { action: "approve" });
    assert.equal(ok.data.status, "approved");
    assert.equal(ok.data.decidedBy, owner);
    assert.equal((await call(`/accounts/transactions/${diesel.data.id}`, owner, { action: "approve" })).status, 409);
    assert.equal((await call(`/accounts/transactions/${gift.data.id}`, owner, { action: "approve" })).status, 409, "income needs no approval");

    // Spending the owner records counts at once.
    const own = await call("/accounts/transactions", owner, { direction: "out", category: "Bank charges", description: `${marker} SMS alerts`, counterparty: "Zenith Bank", amountKobo: 500_00, date: today, method: "transfer" });
    assert.equal(own.data.status, "approved");

    // Portal income appears by itself: a confirmed fee transfer and a paid store order.
    await db.insert(feePaymentReportsTable).values({
      reference: `${marker}-FEE`, feeType: "class", studentName: `${marker} Tolu`, studentIdentifier: `${marker}-1`, className: "JSS 1", term: "Autumn Term",
      academicYear: "2026/2027", description: `${marker} tuition`, amountKobo: 150_000_00, guardianName: "Mrs Ade", guardianEmail: "mum@example.test",
      guardianPhone: "08000000000", status: "confirmed", confirmedAt: new Date(), confirmedBy: owner,
    });
    await db.insert(storeOrdersTable).values({
      reference: `${marker}-ORD`, guardianName: "Mr Ade", guardianEmail: "dad@example.test", guardianPhone: "08000000001", studentName: `${marker} Kemi`, studentClass: "Year 3",
      items: [{ productId: 1, title: "Sweater", variant: "", quantity: 1, unitPriceKobo: 12_000_00, lineTotalKobo: 12_000_00 }], totalKobo: 12_000_00, paymentStatus: "confirmed",
    });
    view = await call("/accounts" + range, bursar);
    const entries = mine(view.data.entries);
    const fee = entries.find((e: { key: string; source: string }) => e.source === "fee_transfer");
    assert.equal(fee.category, "School fees");
    assert.match(fee.reference, /^NWE\/RCT\/\d{4}\/\d{5}$/);
    assert.ok(entries.some((e: { source: string }) => e.source === "store"));
    assert.equal(entries.find((e: { id: number }) => e.id === mistake.data.id).status, "void");
    assert.equal(view.data.totals.balanceKobo, balanceBefore + 200_000_00 - 85_000_00 - 500_00 + 150_000_00 + 12_000_00);
    assert.equal(mine(view.data.pending).length, 0);
    assert.ok(view.data.categories.some((c: { direction: string; category: string }) => c.direction === "out" && c.category === "Electricity and diesel"));
    assert.ok(view.data.months.length >= 1);

    // The owner can cancel a counted entry, with a reason.
    assert.equal((await call(`/accounts/transactions/${gift.data.id}`, owner, { action: "void", note: "Recorded in the wrong month" })).data.status, "void");
    view = await call("/accounts" + range, bursar);
    assert.equal(view.data.totals.balanceKobo, balanceBefore - 85_000_00 - 500_00 + 150_000_00 + 12_000_00);

    // Receipt photos: only for something in the accounts, only for the bursar and owner.
    assert.equal((await fetch(`${base}/portal/accounts/receipts/${receipt}`, { headers: { "X-Test-User": head } })).status, 403);
    assert.equal((await fetch(`${base}/portal/accounts/receipts/${randomUUID()}`, { headers: { "X-Test-User": bursar } })).status, 404);

    // The Chairman's board never shows money from the accounts.
    const board = await fetch(`${base}/chairman/board`, { headers: { "X-Test-User": chair } });
    assert.equal(board.status, 200);
    assert.doesNotMatch(await board.text(), /Kobo|diesel/i);
  } finally {
    server.close();
    await db.delete(schoolTransactions).where(like(schoolTransactions.description, `${marker}%`));
    await db.delete(feePaymentReportsTable).where(like(feePaymentReportsTable.reference, `${marker}%`));
    await db.delete(storeOrdersTable).where(like(storeOrdersTable.reference, `${marker}%`));
    if (proofIds.length) await db.delete(portalImages).where(inArray(portalImages.id, proofIds));
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await pool.end();
  }
});
