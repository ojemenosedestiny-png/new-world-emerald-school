import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { db, pool, portalAlbums, portalClasses, portalImages, portalSessions, portalStudents, portalTeachers } from "@workspace/db";
import portalRouter from "../routes/portal";
import { hashPassword } from "./portal-auth";
import { detectImage, useMemoryImageStore } from "./images";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);

test("photo type comes from the file bytes", () => {
  assert.equal(detectImage(PNG), "image/png");
  assert.equal(detectImage(JPEG), "image/jpeg");
  assert.equal(detectImage(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(8)])), "image/webp");
  assert.equal(detectImage(Buffer.from("<svg onload=alert(1)></svg>")), null);
});

// Database-only checks for the gallery, profile photos and staff portraits.
test("media: uploads need storage, albums follow class rules, student photos need approval and stay private", async () => {
  const saved = { admins: process.env.SCHOOL_ADMIN_EMAILS, dir: process.env.PRIVATE_OBJECT_DIR };
  const marker = `QA-MED-${randomUUID().slice(0, 8)}`.toUpperCase();
  process.env.SCHOOL_ADMIN_EMAILS = `admin-${marker}@example.test`.toLowerCase();
  delete process.env.PRIVATE_OBJECT_DIR;
  const classIds: number[] = [];
  let teacherId = 0;
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
  async function call(path: string, method = "GET", body?: unknown, opts: { cookie?: string; admin?: boolean } = {}): Promise<{ status: number; cookie: string; data: any; type: string }> {
    const raw = Buffer.isBuffer(body);
    const r = await fetch(root + path, {
      method,
      headers: { ...(body ? { "Content-Type": raw ? "image/jpeg" : "application/json" } : {}), ...(opts.cookie ? { Cookie: opts.cookie } : {}), ...(opts.admin ? { "X-Test-Admin": marker } : {}) },
      ...(body ? { body: raw ? new Uint8Array(body) : JSON.stringify(body) } : {}),
    });
    const type = r.headers.get("content-type") ?? "";
    return { status: r.status, cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "", type, data: type.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  }
  const admin = { admin: true };
  try {
    const [mine] = await db.insert(portalClasses).values({ name: marker + " A" }).returning();
    const [other] = await db.insert(portalClasses).values({ name: marker + " B" }).returning();
    classIds.push(mine.id, other.id);
    const pw = await hashPassword("Media-Pass-12");
    await db.insert(portalStudents).values([
      { studentId: marker, name: "Ada Obi", classId: mine.id, passwordHash: pw, mustChangePassword: false },
      { studentId: marker + "-2", name: "Bayo Ade", classId: other.id, passwordHash: pw, mustChangePassword: false },
    ]);
    const login = async (id: string) => ({ cookie: (await call("/session", "POST", { studentId: id, password: "Media-Pass-12" })).cookie });
    const ada = await login(marker), bayo = await login(marker + "-2");
    const [adaRow] = await db.select().from(portalStudents).where(eq(portalStudents.studentId, marker));

    // Without storage configured, uploads explain themselves instead of failing.
    const off = await call("/me/photo", "POST", PNG, ada);
    assert.equal(off.status, 503);
    assert.match(off.data.error, /not set up yet/);
    assert.equal((await call("/me/photo", "GET", undefined, ada)).data.uploadsEnabled, false);
    useMemoryImageStore();

    // Albums: admin-only writes; students see published school-wide and own-class albums.
    assert.equal((await call("/albums", "POST", { title: "Nope", published: true }, ada)).status, 403);
    const school = (await call("/albums", "POST", { title: `${marker} Sports day`, description: "Fun", published: true }, admin)).data;
    const ours = (await call("/albums", "POST", { title: `${marker} Class A trip`, classId: mine.id, published: true }, admin)).data;
    const draft = (await call("/albums", "POST", { title: `${marker} Draft`, published: false }, admin)).data;
    assert.equal(ours.className, marker + " A");
    assert.equal((await call(`/albums/${school.id}/photos`, "POST", PNG, ada)).status, 403);
    assert.equal((await call(`/albums/${school.id}/photos`, "POST", Buffer.from("<svg></svg>"), admin)).status, 400, "only real images");
    assert.equal((await call(`/albums/${school.id}/photos`, "POST", Buffer.alloc(6 * 1024 * 1024, 0xff), admin)).status, 413);
    const p1 = await call(`/albums/${school.id}/photos`, "POST", PNG, admin);
    assert.equal(p1.status, 200, JSON.stringify(p1.data));
    const captioned = await call(`/album-photos/${p1.data.id}`, "PUT", { caption: "  Relay race " }, admin);
    assert.equal(captioned.data.caption, "Relay race");
    const p2 = (await call(`/albums/${ours.id}/photos`, "POST", JPEG, admin)).data;
    const p3 = (await call(`/albums/${draft.id}/photos`, "POST", JPEG, admin)).data;
    const titles = (who: { cookie?: string; admin?: boolean }) => call("/albums", "GET", undefined, who).then((r) => r.data.filter((a: { title: string }) => a.title.startsWith(marker)).map((a: { title: string }) => a.title).sort());
    assert.deepEqual(await titles(ada), [`${marker} Class A trip`, `${marker} Sports day`]);
    assert.deepEqual(await titles(bayo), [`${marker} Sports day`]);
    assert.equal((await titles(admin)).length, 3);

    // Photos are served only to people who may see their album.
    const img = await call(`/images/${p1.data.imageId}`, "GET", undefined, ada);
    assert.equal(img.status, 200);
    assert.equal(img.type, "image/png");
    assert.ok(img.data.equals(PNG));
    assert.equal((await call(`/images/${p2.imageId}`, "GET", undefined, bayo)).status, 404, "other class");
    assert.equal((await call(`/images/${p3.imageId}`, "GET", undefined, ada)).status, 404, "draft album");
    assert.equal((await call(`/images/${p1.data.imageId}`)).status, 401);

    // Student photo: pending until staff approve; replacing a pending photo removes the old one.
    const up1 = await call("/me/photo", "POST", PNG, ada);
    assert.equal(up1.status, 200);
    assert.equal(up1.data.photoId, null);
    const up2 = (await call("/me/photo", "POST", JPEG, ada)).data;
    assert.equal((await db.select().from(portalImages).where(eq(portalImages.id, up1.data.pendingPhotoId))).length, 0, "old pending photo deleted");
    assert.equal((await call(`/images/${up2.pendingPhotoId}`, "GET", undefined, ada)).status, 200, "students see their own pending photo");
    assert.equal((await call(`/images/${up2.pendingPhotoId}`, "GET", undefined, bayo)).status, 404, "but nobody else's");
    const reviews = (await call("/photo-reviews", "GET", undefined, admin)).data.filter((r: { studentId: string }) => r.studentId.startsWith(marker));
    assert.deepEqual(reviews.map((r: { name: string; pendingPhotoId: string }) => [r.name, r.pendingPhotoId]), [["Ada Obi", up2.pendingPhotoId]]);
    assert.equal((await call("/photo-reviews", "GET", undefined, ada)).status, 403);
    assert.equal((await call(`/photo-reviews/${adaRow.id}`, "POST", { approve: true }, ada)).status, 403);
    assert.equal((await call(`/photo-reviews/${adaRow.id}`, "POST", { approve: true }, admin)).status, 200);
    assert.equal((await call(`/photo-reviews/${adaRow.id}`, "POST", { approve: true }, admin)).status, 409);
    const mine2 = (await call("/me/photo", "GET", undefined, ada)).data;
    assert.deepEqual([mine2.photoId, mine2.pendingPhotoId, mine2.uploadsEnabled], [up2.pendingPhotoId, null, true]);
    const up3 = (await call("/me/photo", "POST", PNG, ada)).data;
    await call(`/photo-reviews/${adaRow.id}`, "POST", { approve: false }, admin);
    assert.equal((await db.select().from(portalImages).where(eq(portalImages.id, up3.pendingPhotoId))).length, 0, "declined photo deleted");
    assert.equal((await call("/me/photo", "GET", undefined, ada)).data.photoId, up2.pendingPhotoId, "approved photo kept");

    // Staff can set or remove a student's photo directly.
    assert.equal((await call(`/students/${adaRow.id}/photo`, "POST", PNG, admin)).status, 200);
    const [after] = await db.select().from(portalStudents).where(eq(portalStudents.id, adaRow.id));
    assert.notEqual(after.photoImageId, up2.pendingPhotoId);
    assert.equal((await db.select().from(portalImages).where(eq(portalImages.id, up2.pendingPhotoId!))).length, 0, "replaced photo deleted");
    assert.equal((await call(`/students/${adaRow.id}/photo`, "DELETE", undefined, admin)).status, 200);
    assert.equal((await call(`/students/${adaRow.id}/photo`, "POST", PNG, ada)).status, 403, "students cannot set photos for others");

    // Staff portraits appear in the directory for any signed-in person.
    const [t] = await db.insert(portalTeachers).values({ email: `t-${marker}@example.test`.toLowerCase(), name: "Mrs Bello", classIds: [mine.id] }).returning();
    teacherId = t.id;
    assert.equal((await call(`/teachers/${t.id}/photo`, "POST", PNG, ada)).status, 403);
    assert.equal((await call(`/teachers/${t.id}/photo`, "POST", PNG, admin)).status, 200);
    const entry = (await call("/staff-directory", "GET", undefined, bayo)).data.find((x: { id: number }) => x.id === t.id);
    assert.ok(entry.photoId);
    assert.equal((await call(`/images/${entry.photoId}`, "GET", undefined, bayo)).status, 200);
    assert.equal((await call(`/teachers/${t.id}/photo`, "DELETE", undefined, admin)).status, 200);
    assert.equal((await call(`/images/${entry.photoId}`, "GET", undefined, bayo)).status, 404);

    // Deleting a photo or album removes the files too.
    assert.equal((await call(`/album-photos/${p1.data.id}`, "DELETE", undefined, admin)).status, 200);
    assert.equal((await db.select().from(portalImages).where(eq(portalImages.id, p1.data.imageId))).length, 0);
    assert.equal((await call(`/albums/${ours.id}`, "DELETE", undefined, admin)).status, 200);
    assert.equal((await db.select().from(portalImages).where(eq(portalImages.id, p2.imageId))).length, 0);
    assert.equal((await call(`/albums/${ours.id}`, "DELETE", undefined, admin)).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    if (teacherId) await db.delete(portalTeachers).where(eq(portalTeachers.id, teacherId));
    const albums = (await db.select().from(portalAlbums)).filter((a) => a.title.startsWith(marker)).map((a) => a.id);
    if (albums.length) await db.delete(portalAlbums).where(inArray(portalAlbums.id, albums));
    if (classIds.length) {
      const ids = (await db.select({ id: portalStudents.id }).from(portalStudents).where(inArray(portalStudents.classId, classIds))).map((s) => s.id);
      if (ids.length) await db.delete(portalSessions).where(inArray(portalSessions.studentId, ids));
      await db.delete(portalStudents).where(inArray(portalStudents.classId, classIds));
      await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    }
    for (const [k, v] of [["SCHOOL_ADMIN_EMAILS", saved.admins], ["PRIVATE_OBJECT_DIR", saved.dir]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    await pool.end();
  }
});
