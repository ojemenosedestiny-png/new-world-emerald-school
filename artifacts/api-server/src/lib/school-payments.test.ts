import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { db, pool, portalImages, schoolCommerceSettingsTable, storeOrdersTable, storeProductsTable } from "@workspace/db";
import apiRouter from "../routes";
import { useMemoryImageStore } from "./images";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);

// Database checks for paying by transfer: bank accounts, payment screenshots, privacy.
test("payments: bank accounts, screenshots on orders, attach later, admin-only viewing", async () => {
  const saved = { admins: process.env.SCHOOL_ADMIN_EMAILS };
  const marker = randomUUID().slice(0, 8);
  process.env.SCHOOL_ADMIN_EMAILS = `admin-${marker}@example.test`;
  useMemoryImageStore();
  const [before] = await db.select().from(schoolCommerceSettingsTable).where(eq(schoolCommerceSettingsTable.id, "school"));
  const productIds: number[] = [];
  const orderRefs: string[] = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error() {}, warn() {}, info() {} } as unknown as typeof req.log;
    if (req.headers["x-test-admin"] === marker) {
      req.dbUser = { id: `synthetic-${marker}` } as NonNullable<typeof req.dbUser>;
      req.identity = { email: `admin-${marker}@example.test`, emailVerified: true, mfa: true };
    }
    next();
  });
  app.use("/api", apiRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function call(path: string, method = "GET", body?: unknown, opts: { admin?: boolean; ip?: string } = {}): Promise<{ status: number; data: any; type: string }> {
    const raw = Buffer.isBuffer(body);
    const r = await fetch(root + path, {
      method,
      headers: { ...(body ? { "Content-Type": raw ? "image/png" : "application/json" } : {}), ...(opts.admin ? { "X-Test-Admin": marker } : {}), ...(opts.ip ? { "X-Forwarded-For": opts.ip } : {}) },
      ...(body ? { body: raw ? new Uint8Array(body) : JSON.stringify(body) } : {}),
    });
    const type = r.headers.get("content-type") ?? "";
    return { status: r.status, type, data: type.includes("json") ? await r.json() : await r.arrayBuffer() };
  }
  try {
    // The office posts up to three labelled accounts; families see them.
    const accounts = [{ label: "School fees", bankName: "First Bank", accountName: "New World Emerald Private School", accountNumber: "0123456789" }];
    assert.equal((await call("/school-commerce/settings", "PUT", { paymentInstructions: "Pay", bankAccounts: accounts })).status, 401, "public cannot edit");
    assert.equal((await call("/school-commerce/settings", "PUT", { paymentInstructions: "x", bankAccounts: [{ ...accounts[0], accountNumber: "12AB" }] }, { admin: true })).status, 400, "account numbers are digits");
    assert.equal((await call("/school-commerce/settings", "PUT", { paymentInstructions: "x", bankAccounts: [accounts[0], accounts[0], accounts[0], accounts[0]] }, { admin: true })).status, 400, "at most three");
    assert.equal((await call("/school-commerce/settings", "PUT", { paymentInstructions: "Pay to:", bankAccounts: accounts }, { admin: true })).status, 200);
    assert.deepEqual((await call("/school-commerce/settings")).data.bankAccounts, accounts);
    assert.equal((await call("/school-commerce/settings", "PUT", { paymentInstructions: "Updated text" }, { admin: true })).status, 200);
    assert.deepEqual((await call("/school-commerce/settings")).data.bankAccounts, accounts, "saving only the instructions keeps the accounts");

    // A parent uploads a screenshot (images only) and sends it with the order.
    assert.equal((await call("/school-commerce/payment-proofs", "POST", Buffer.from("<svg/>"), { ip: `10.1.${marker.length}.1` })).status, 400, "only real images");
    const proof = await call("/school-commerce/payment-proofs", "POST", PNG, { ip: "10.9.9.1" });
    assert.equal(proof.status, 200, JSON.stringify(proof.data));
    const [product] = await db.insert(storeProductsTable).values({ title: `Test blazer ${marker}`, category: "uniform", priceKobo: 500000, stock: 10 }).returning();
    productIds.push(product.id);
    const orderBody = { guardianName: "Mrs Obi", guardianEmail: "Parent@Example.test", guardianPhone: "+2348000000000", studentName: "Ada Obi", studentClass: "JSS 1", items: [{ productId: product.id, quantity: 1 }] };
    const order = await call("/school-commerce/orders", "POST", { ...orderBody, proofId: proof.data.proofId });
    assert.equal(order.status, 201, JSON.stringify(order.data));
    orderRefs.push(order.data.reference);
    assert.equal(order.data.paymentStatus, "reported", "a screenshot marks the payment as reported");
    const [stored] = await db.select().from(storeOrdersTable).where(eq(storeOrdersTable.reference, order.data.reference));
    assert.equal(stored.proofImageId, proof.data.proofId);
    assert.equal((await call("/school-commerce/orders", "POST", { ...orderBody, proofId: proof.data.proofId })).status, 400, "a screenshot cannot be reused");
    assert.equal((await call("/school-commerce/orders", "POST", { ...orderBody, proofId: randomUUID() })).status, 400, "unknown screenshot");

    // Ordering first and attaching the screenshot later; reference and email must match.
    const later = await call("/school-commerce/orders", "POST", orderBody);
    orderRefs.push(later.data.reference);
    assert.equal(later.data.paymentStatus, "awaiting_payment");
    const proof2 = (await call("/school-commerce/payment-proofs", "POST", PNG, { ip: "10.9.9.2" })).data.proofId;
    assert.equal((await call("/school-commerce/payment-proofs/attach", "POST", { reference: later.data.reference, email: "someone@else.test", proofId: proof2 })).status, 404);
    assert.equal((await call("/school-commerce/payment-proofs/attach", "POST", { reference: "NWE-ORD-NOPE", email: "parent@example.test", proofId: proof2 })).status, 404);
    const attached = await call("/school-commerce/payment-proofs/attach", "POST", { reference: later.data.reference.toLowerCase(), email: " PARENT@example.test ", proofId: proof2 });
    assert.equal(attached.status, 200, JSON.stringify(attached.data));
    const [laterRow] = await db.select().from(storeOrdersTable).where(eq(storeOrdersTable.reference, later.data.reference));
    assert.deepEqual([laterRow.proofImageId, laterRow.paymentStatus], [proof2, "reported"]);

    // Screenshots are private: only website administrators can open them.
    assert.equal((await call(`/portal/images/${proof.data.proofId}`)).status, 401);
    const view = await call(`/portal/images/${proof.data.proofId}`, "GET", undefined, { admin: true });
    assert.equal(view.status, 200);
    assert.equal(view.type, "image/png");
    const listed = (await call("/school-commerce/orders", "GET", undefined, { admin: true })).data;
    assert.ok(Array.isArray(listed) && listed.some((o: { reference: string; proofImageId: string }) => o.reference === order.data.reference && o.proofImageId === proof.data.proofId), "the office sees the screenshot on the order");

    // Too many uploads from one address are refused before the file is read.
    let limited = 0;
    for (let i = 0; i < 14; i++) if ((await call("/school-commerce/payment-proofs", "POST", PNG, { ip: "10.7.7.7" })).status === 429) limited++;
    assert.ok(limited >= 2, `expected the hourly limit to apply, got ${limited} refusals`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    if (orderRefs.length) await db.delete(storeOrdersTable).where(inArray(storeOrdersTable.reference, orderRefs));
    if (productIds.length) await db.delete(storeProductsTable).where(inArray(storeProductsTable.id, productIds));
    await db.delete(portalImages).where(eq(portalImages.purpose, "payment"));
    if (before) await db.update(schoolCommerceSettingsTable).set({ paymentInstructions: before.paymentInstructions, bankAccounts: before.bankAccounts }).where(eq(schoolCommerceSettingsTable.id, "school"));
    else await db.delete(schoolCommerceSettingsTable).where(eq(schoolCommerceSettingsTable.id, "school"));
    if (saved.admins === undefined) delete process.env.SCHOOL_ADMIN_EMAILS; else process.env.SCHOOL_ADMIN_EMAILS = saved.admins;
    await pool.end();
  }
});
