import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { db, mediaObjects, pool } from "@workspace/db";
import storageRouter from "../routes/storage";
import { signUploadGrant } from "./cloudinary";

// Fake credentials: nothing here needs a real Cloudinary account.
const FAKE = "cloudinary://123456789012345:fake-secret-for-tests@demo-school";

test("website uploads with Cloudinary: signed links, checks, CDN delivery and admin-only status", async () => {
  const saved = { url: process.env.CLOUDINARY_URL, admins: process.env.SCHOOL_ADMIN_EMAILS };
  process.env.CLOUDINARY_URL = FAKE;
  const marker = randomUUID().slice(0, 8);
  process.env.SCHOOL_ADMIN_EMAILS = `admin-${marker}@example.test`;
  const ids: string[] = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // Unexpected server errors are printed so a failing run explains itself.
    req.log = { error: (o: { err?: Error }) => { if (!/Cloudinary upload failed/.test(String(o))) console.error("server error:", o.err?.message ?? o); }, warn() {}, info() {} } as unknown as typeof req.log;
    const who = req.headers["x-test-user"];
    if (who) {
      req.dbUser = { id: `synthetic-${who}` } as NonNullable<typeof req.dbUser>;
      req.identity = { email: `${who}-${marker}@example.test`, emailVerified: true, mfa: true };
    }
    next();
  });
  app.use("/api", storageRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, init: RequestInit & { user?: string } = {}) =>
    fetch(root + path, { redirect: "manual", ...init, headers: { ...(init.headers ?? {}), ...(init.user ? { "X-Test-User": init.user } : {}) } });
  try {
    // Only signed-in staff can ask for an upload link; it points back at our own server.
    const body = JSON.stringify({ name: "sports.mp4", size: 2048, contentType: "video/mp4" });
    assert.equal((await call("/api/storage/uploads/request-url", { method: "POST", headers: { "Content-Type": "application/json" }, body })).status, 401);
    const granted = await call("/api/storage/uploads/request-url", { method: "POST", headers: { "Content-Type": "application/json" }, body, user: "admin" });
    assert.equal(granted.status, 200);
    const link = await granted.json() as { uploadURL: string; objectPath: string };
    assert.match(link.uploadURL, /^\/api\/storage\/uploads\/[\w-]+\.[\w-]+$/);
    assert.match(link.objectPath, /^\/objects\/uploads\/[0-9a-f-]{36}$/);
    const tooBig = JSON.stringify({ name: "huge.mp4", size: 101 * 1024 * 1024, contentType: "video/mp4" });
    assert.equal((await call("/api/storage/uploads/request-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: tooBig, user: "admin" })).status, 413);

    // The upload address itself is the permission: tampered, expired or mismatched uploads are refused.
    const put = (url: string, type: string) => call(url, { method: "PUT", headers: { "Content-Type": type }, body: new Uint8Array(16) });
    assert.equal((await put(link.uploadURL.replace(/\.[\w-]+$/, ".AAAA"), "video/mp4")).status, 403);
    assert.equal((await put(link.uploadURL, "text/html")).status, 400, "file type must match the request");
    const expired = signUploadGrant({ id: randomUUID(), contentType: "video/mp4", size: 16, expires: Date.now() - 1 });
    assert.equal((await put(`/api/storage/uploads/${expired}`, "video/mp4")).status, 403);
    // With fake credentials Cloudinary refuses the file; nothing is recorded.
    const failed = await put(link.uploadURL, "video/mp4");
    assert.ok(failed.status >= 400, `upload to Cloudinary should fail with fake keys, got ${failed.status}`);
    const objectId = link.objectPath.split("/").pop()!;
    assert.equal((await db.select().from(mediaObjects).where(eq(mediaObjects.id, objectId))).length, 0);

    // Stored photos and videos are served from Cloudinary's CDN.
    const photo = randomUUID();
    ids.push(photo);
    await db.insert(mediaObjects).values({ id: photo, publicId: `nwe/site/${photo}`, resourceType: "image", contentType: "image/jpeg", size: 10 });
    const served = await call(`/api/storage/objects/uploads/${photo}`);
    assert.equal(served.status, 302);
    assert.equal(served.headers.get("location"), `https://res.cloudinary.com/demo-school/image/upload/v1/nwe/site/${photo}`);

    // A used upload link cannot be replayed.
    const reused = signUploadGrant({ id: photo, contentType: "image/jpeg", size: 16, expires: Date.now() + 60_000 });
    assert.equal((await put(`/api/storage/uploads/${reused}`, "image/jpeg")).status, 409);

    // Big videos: the browser uploads straight to Cloudinary with per-piece signatures.
    const json = (r: Response) => r.json() as Promise<Record<string, unknown>>;
    const start = (payload: unknown, user?: string) => call("/api/storage/direct-uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), user });
    assert.equal((await start({ name: "a.mp4", size: 10, contentType: "video/mp4" })).status, 401);
    assert.equal((await start({ name: "a.mp4", size: 10, contentType: "video/mp4" }, "teacher")).status, 403);
    assert.equal((await start({ name: "a.pdf", size: 10, contentType: "application/pdf" }, "admin")).status, 400, "videos only");
    assert.equal((await start({ name: "huge.mp4", size: 501 * 1024 * 1024, contentType: "video/mp4" }, "admin")).status, 413);
    const big = await json(await start({ name: "sports.mp4", size: 431 * 1024 * 1024, contentType: "video/mp4" }, "admin"));
    assert.equal(big.uploadUrl, "https://api.cloudinary.com/v1_1/demo-school/video/upload");
    assert.equal(big.chunkSize, 6 * 1024 * 1024);
    assert.match(String(big.objectPath), /^\/objects\/uploads\/[0-9a-f-]{36}$/);
    const sign = (token: unknown) => call("/api/storage/direct-uploads/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), user: "admin" });
    assert.equal((await sign("forged.token")).status, 403);
    const signed = await json(await sign(big.token));
    assert.equal(signed.apiKey, "123456789012345");
    assert.equal(signed.publicId, `nwe/site/${String(big.objectPath).split("/").pop()}`);
    assert.match(String(signed.signature), /^[0-9a-f]{40}$/);
    assert.ok(!JSON.stringify(signed).includes("fake-secret"), "the secret never reaches the browser");
    // Finishing asks Cloudinary whether the video arrived; with fake keys it cannot confirm and nothing is recorded.
    const complete = (token: unknown) => call("/api/storage/direct-uploads/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), user: "admin" });
    const unconfirmed = await complete(big.token);
    assert.ok([409, 502].includes(unconfirmed.status), `got ${unconfirmed.status}`);
    const bigId = String(big.objectPath).split("/").pop()!;
    assert.equal((await db.select().from(mediaObjects).where(eq(mediaObjects.id, bigId))).length, 0);
    // Once recorded, finishing again just returns the same video (safe to retry).
    ids.push(bigId);
    await db.insert(mediaObjects).values({ id: bigId, publicId: `nwe/site/${bigId}`, resourceType: "video", contentType: "video/mp4", size: 1234 });
    assert.deepEqual(await json(await complete(big.token)), { objectPath: big.objectPath, bytes: 1234 });

    // Status is for website administrators only.
    assert.equal((await call("/api/storage/status")).status, 401);
    assert.equal((await call("/api/storage/status", { user: "teacher" })).status, 403);
    const status = await (await call("/api/storage/status", { user: "admin" })).json();
    assert.deepEqual(status, { provider: "cloudinary", ready: true, cloudName: "demo-school" });
    assert.ok(!JSON.stringify(status).includes("fake-secret"), "the secret is never sent to the browser");
    delete process.env.CLOUDINARY_URL;
    assert.equal(((await (await call("/api/storage/status", { user: "admin" })).json()) as { provider: string }).provider, process.env.PRIVATE_OBJECT_DIR ? "bucket" : "none");
    assert.equal((await put(link.uploadURL, "video/mp4")).status, 404, "Cloudinary upload address is off without CLOUDINARY_URL");
    // With no storage at all, asking to upload explains what to fix instead of failing with a server error.
    const savedDir = process.env.PRIVATE_OBJECT_DIR;
    delete process.env.PRIVATE_OBJECT_DIR;
    process.env.CLOUDINARY_URL = "cloudinary://<your_api_key>:123456789012345<your_api_secret>abc@demo-school";
    const noStorage = await call("/api/storage/uploads/request-url", { method: "POST", headers: { "Content-Type": "application/json" }, body, user: "admin" });
    assert.equal(noStorage.status, 503);
    assert.match((await noStorage.json() as { error: string }).error, /placeholders/);
    delete process.env.CLOUDINARY_URL;
    if (savedDir !== undefined) process.env.PRIVATE_OBJECT_DIR = savedDir;
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    for (const id of ids) await db.delete(mediaObjects).where(eq(mediaObjects.id, id));
    for (const [k, v] of [["CLOUDINARY_URL", saved.url], ["SCHOOL_ADMIN_EMAILS", saved.admins]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    await pool.end();
  }
});
