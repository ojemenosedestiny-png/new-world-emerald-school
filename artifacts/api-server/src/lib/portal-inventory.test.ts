import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { db, pool, portalClasses, portalInventoryItems, portalSessions, portalStudents } from "@workspace/db";
import portalRouter from "../routes/portal";
import { hashPassword } from "./portal-auth";

// Database checks for the school inventory: stock only moves through recorded, checked movements.
test("inventory: the office adds stock, records movements with history, and students cannot see it", async () => {
  const saved = process.env.SCHOOL_ADMIN_EMAILS;
  const marker = `QA-INV-${randomUUID().slice(0, 8)}`.toUpperCase();
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
  async function call(path: string, method = "GET", body?: unknown, opts: { cookie?: string; admin?: boolean } = {}): Promise<{ status: number; data: any }> {
    const r = await fetch(root + path, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(opts.cookie ? { Cookie: opts.cookie } : {}), ...(opts.admin ? { "X-Test-Admin": marker } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: r.status === 204 ? null : await r.json() };
  }
  const admin = { admin: true };
  let itemId = 0;
  try {
    const [cls] = await db.insert(portalClasses).values({ name: marker }).returning();
    classIds.push(cls.id);
    const [ada] = await db.insert(portalStudents).values({ studentId: marker + "-1", name: "Ada Obi", classId: cls.id, passwordHash: await hashPassword("Inv-Pass-12345"), mustChangePassword: false }).returning();
    const adaS = { cookie: (await fetch(root + "/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: ada.studentId, password: "Inv-Pass-12345" }) })).headers.get("set-cookie")!.split(";")[0] };

    const chairs = { name: ` Plastic chairs ${marker} `, category: "Furniture", location: "Block A", unit: "", quantity: 30, reorderLevel: 10, condition: "good", classId: cls.id, notes: "" };
    assert.equal((await call("/inventory", "POST", { ...chairs, name: " " }, admin)).status, 400);
    const created = await call("/inventory", "POST", chairs, admin);
    assert.equal(created.status, 200, JSON.stringify(created.data));
    itemId = created.data.id;
    assert.deepEqual([created.data.name, created.data.unit, created.data.quantity, created.data.status, created.data.className, created.data.canEdit], [`Plastic chairs ${marker}`, "pieces", 30, "ok", marker, true]);

    // Movements change stock and are checked; you cannot take away more than is there.
    const move = (body: object) => call(`/inventory/${itemId}/moves`, "POST", { note: "", ...body }, admin);
    assert.equal((await move({ kind: "issued", quantity: 31 })).status, 400);
    assert.equal((await move({ kind: "issued", quantity: 21, note: "To JSS 1 hall" })).data.status, "low");
    assert.equal((await move({ kind: "received", quantity: 5 })).data.quantity, 14);
    assert.equal((await move({ kind: "condition", quantity: 0 })).status, 400, "a condition report names the condition");
    const repaired = await move({ kind: "condition", quantity: 0, condition: "needs_repair", note: "Two legs cracked" });
    assert.deepEqual([repaired.data.quantity, repaired.data.condition], [14, "needs_repair"]);
    assert.equal((await move({ kind: "count", quantity: 12 })).data.quantity, 12);

    // Editing details never changes the quantity; stock only moves through the history.
    const edited = await call("/inventory", "POST", { ...chairs, id: itemId, quantity: 999, location: "Block B" }, admin);
    assert.deepEqual([edited.data.quantity, edited.data.location, edited.data.condition], [12, "Block B", "good"]);

    const history = (await call(`/inventory/${itemId}/moves`, "GET", undefined, admin)).data as { kind: string; change: number; quantityAfter: number; note: string }[];
    assert.deepEqual(history.map((m) => [m.kind, m.change, m.quantityAfter]), [["condition", 0, 12], ["count", -2, 12], ["condition", 0, 14], ["received", 5, 14], ["issued", -21, 9], ["count", 30, 30]]);
    assert.equal(history[history.length - 1].note, "Opening stock");
    assert.match(history[2].note, /Two legs cracked · Condition: needs repair/);

    const list = (await call("/inventory", "GET", undefined, admin)).data;
    assert.equal(list.canDelete, true);
    assert.ok(list.categories.includes("Furniture") && list.categories.includes("Science lab"));
    assert.equal(list.items.find((i: { id: number }) => i.id === itemId).status, "ok", "12 is above the reorder level of 10");

    // Students and signed-out visitors see nothing and change nothing.
    assert.equal((await call("/inventory", "GET", undefined, adaS)).status, 403);
    assert.equal((await call(`/inventory/${itemId}/moves`, "POST", { kind: "lost", quantity: 1, note: "" }, adaS)).status, 403);
    assert.equal((await call("/inventory")).status, 401);
    assert.equal((await call(`/inventory/${itemId}`, "DELETE", undefined, adaS)).status, 403);

    assert.equal((await call(`/inventory/${itemId}`, "DELETE", undefined, admin)).status, 204);
    assert.equal((await call(`/inventory/${itemId}/moves`, "GET", undefined, admin)).status, 404);
    itemId = 0;
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    if (itemId) await db.delete(portalInventoryItems).where(eq(portalInventoryItems.id, itemId));
    if (classIds.length) {
      const ids = (await db.select({ id: portalStudents.id }).from(portalStudents).where(inArray(portalStudents.classId, classIds))).map((s) => s.id);
      if (ids.length) await db.delete(portalSessions).where(inArray(portalSessions.studentId, ids));
      await db.delete(portalInventoryItems).where(inArray(portalInventoryItems.classId, classIds));
      await db.delete(portalStudents).where(inArray(portalStudents.classId, classIds));
      await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    }
    if (saved === undefined) delete process.env.SCHOOL_ADMIN_EMAILS; else process.env.SCHOOL_ADMIN_EMAILS = saved;
    await pool.end();
  }
});
