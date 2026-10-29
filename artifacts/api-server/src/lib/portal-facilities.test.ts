import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { inArray, like } from "drizzle-orm";
import { db, pool, portalClasses, portalHostelBlocks, portalSessions, portalStudents, portalTransportRoutes } from "@workspace/db";
import portalRouter from "../routes/portal";
import { hashPassword } from "./portal-auth";

// Database checks for hostels and transport: capacity, allocation, routes and what students see.
test("facilities: the office allocates rooms and routes within capacity; each student sees only their own", async () => {
  const saved = process.env.SCHOOL_ADMIN_EMAILS;
  const marker = `QA-FAC-${randomUUID().slice(0, 8)}`.toUpperCase();
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
  const call = async (path: string, method = "GET", body?: unknown, opts: { admin?: boolean; cookie?: string } = {}): Promise<{ status: number; data: any }> => {
    const r = await fetch(root + path, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(opts.admin ? { "X-Test-Admin": marker } : {}), ...(opts.cookie ? { Cookie: opts.cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, data: await r.json() };
  };
  const cmd = (body: unknown) => call("/facilities", "POST", body, { admin: true });
  try {
    const [cls] = await db.insert(portalClasses).values({ name: `${marker} SS 1` }).returning();
    classIds.push(cls.id);
    const pw = await hashPassword("Fac-Pass-12345");
    const [ada, bayo, chi] = await db.insert(portalStudents).values(["Ada Obi", "Bayo Ade", "Chi Eze"].map((name, i) => ({ studentId: `${marker}-${i + 1}`, name, classId: cls.id, passwordHash: pw, mustChangePassword: false }))).returning();
    const login = async (id: string) => ({ cookie: (await fetch(root + "/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: id, password: "Fac-Pass-12345" }) })).headers.get("set-cookie")!.split(";")[0] });
    const adaS = await login(ada.studentId);

    // Only the office manages; students cannot.
    assert.equal((await call("/facilities", "GET", undefined, adaS)).status, 403);
    assert.equal((await call("/facilities", "POST", { action: "deleteBlock", id: 1 }, adaS)).status, 403);

    assert.equal((await cmd({ action: "saveBlock", block: { name: `${marker} Block`, gender: "girls", description: "", imageUrl: "javascript:alert(1)" } })).status, 400);
    assert.equal((await cmd({ action: "saveBlock", block: { name: `${marker} Block`, gender: "girls", description: "Near the chapel", imageUrl: "" } })).status, 200);
    let data = (await call("/facilities", "GET", undefined, { admin: true })).data;
    const block = data.blocks.find((b: { name: string }) => b.name === `${marker} Block`);
    assert.equal((await cmd({ action: "saveRoom", room: { blockId: block.id, name: "Room 1", beds: 2, priceKobo: 15_000_000, imageUrl: "", notes: "" } })).status, 200);
    data = (await call("/facilities", "GET", undefined, { admin: true })).data;
    const room = data.blocks.find((b: { id: number }) => b.id === block.id).rooms[0];
    assert.deepEqual([room.beds, room.status, room.occupants.length], [2, "available", 0]);

    // Allocation: within capacity, unique beds, and the room shows full.
    assert.equal((await cmd({ action: "allocate", allocation: { studentId: ada.id, roomId: room.id, bed: "Bed 1" } })).status, 200);
    assert.equal((await cmd({ action: "allocate", allocation: { studentId: bayo.id, roomId: room.id, bed: "bed 1" } })).status, 409);
    assert.equal((await cmd({ action: "allocate", allocation: { studentId: bayo.id, roomId: room.id, bed: "Bed 2" } })).status, 200);
    assert.equal((await cmd({ action: "allocate", allocation: { studentId: chi.id, roomId: room.id, bed: "" } })).status, 409, "full");
    data = (await call("/facilities", "GET", undefined, { admin: true })).data;
    assert.equal(data.blocks.find((b: { id: number }) => b.id === block.id).rooms[0].status, "full");
    assert.equal((await cmd({ action: "saveRoom", room: { id: room.id, blockId: block.id, name: "Room 1", beds: 1, priceKobo: 0, imageUrl: "", notes: "" } })).status, 400, "cannot shrink below occupants");
    assert.equal((await cmd({ action: "deleteRoom", id: room.id })).status, 409);

    // Routes: stops and times are checked; students are assigned to a real stop.
    assert.equal((await cmd({ action: "saveRoute", route: { name: `${marker} Route`, stops: [{ name: "Ikeja", pickup: "6:45", dropoff: "" }], driverName: "", driverPhone: "", vehicle: "", plate: "", feeKobo: 0, notes: "", active: true } })).status, 400);
    assert.equal((await cmd({ action: "saveRoute", route: { name: `${marker} Route`, stops: [{ name: "Ikeja", pickup: "06:45", dropoff: "15:40" }, { name: "Ojota", pickup: "07:05", dropoff: "15:20" }], driverName: "Mr Musa", driverPhone: "0803 123 4567", vehicle: "Toyota Coaster", plate: "lag 123 xy", feeKobo: 4_000_000, notes: "", active: true } })).status, 200);
    data = (await call("/facilities", "GET", undefined, { admin: true })).data;
    const route = data.routes.find((r: { name: string }) => r.name === `${marker} Route`);
    assert.equal(route.plate, "LAG 123 XY");
    assert.equal((await cmd({ action: "assignRoute", assignment: { studentId: ada.id, routeId: route.id, stop: "Lekki" } })).status, 400);
    assert.equal((await cmd({ action: "assignRoute", assignment: { studentId: ada.id, routeId: route.id, stop: "ojota" } })).status, 200);

    // Ada sees her own room and route, not who else is in the room.
    const mine = (await call("/my-facilities", "GET", undefined, adaS)).data;
    assert.deepEqual([mine.hostel.block, mine.hostel.room, mine.hostel.bed, mine.hostel.roommates, mine.hostel.priceKobo], [`${marker} Block`, "Room 1", "Bed 1", 1, 15_000_000]);
    assert.deepEqual([mine.transport.route, mine.transport.stop, mine.transport.pickup, mine.transport.driverPhone], [`${marker} Route`, "Ojota", "07:05", "0803 123 4567"]);
    assert.equal(JSON.stringify(mine).includes("Bayo"), false);
    assert.equal((await call("/my-facilities", "GET", undefined, { admin: true })).status, 401);

    // Moving out frees the bed; removing a stop in use is refused.
    assert.equal((await cmd({ action: "unallocate", id: bayo.id })).status, 200);
    assert.equal((await cmd({ action: "allocate", allocation: { studentId: chi.id, roomId: room.id, bed: "Bed 2" } })).status, 200);
    assert.equal((await cmd({ action: "saveRoute", route: { id: route.id, name: `${marker} Route`, stops: [{ name: "Ikeja", pickup: "06:45", dropoff: "15:40" }], driverName: "", driverPhone: "", vehicle: "", plate: "", feeKobo: 0, notes: "", active: true } })).status, 409);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    await db.delete(portalHostelBlocks).where(like(portalHostelBlocks.name, `${marker}%`));
    await db.delete(portalTransportRoutes).where(like(portalTransportRoutes.name, `${marker}%`));
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
