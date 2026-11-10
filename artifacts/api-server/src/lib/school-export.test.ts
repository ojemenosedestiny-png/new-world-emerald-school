import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import express from "express";
import type { AddressInfo } from "node:net";
import { inArray, like } from "drizzle-orm";
import { db, pool, portalClasses, portalImages, portalStudents, portalTeachers } from "@workspace/db";
import portalRouter from "../routes/portal";
import { setApprovedIdentitiesForTest } from "./approved-identities";
import { useMemoryImageStore } from "./images";

/** Reads every file in a ZIP (stored or deflated). */
function unzip(buf: Buffer) {
  const files = new Map<string, Buffer>();
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const method = buf.readUInt16LE(at + 8), size = buf.readUInt32LE(at + 18), nameLen = buf.readUInt16LE(at + 26), extra = buf.readUInt16LE(at + 28);
    const name = buf.subarray(at + 30, at + 30 + nameLen).toString("utf8");
    const data = buf.subarray(at + 30 + nameLen + extra, at + 30 + nameLen + extra + size);
    files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    at += 30 + nameLen + extra + size;
  }
  assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50, "ends with a central directory");
  assert.equal(buf.readUInt16LE(buf.length - 22 + 10), files.size, "every file is in the directory");
  return files;
}

// The school owner's full download: spreadsheets and photos in one ZIP, never passwords, for the owner only.
test("school export: owner downloads every student, teacher and photo; nobody else can", async () => {
  const marker = `QA-EXP-${randomUUID().slice(0, 8)}`.toUpperCase();
  const owner = `owner-${marker.toLowerCase()}@example.test`, office = `office-${marker.toLowerCase()}@example.test`;
  const saved = Object.fromEntries(["SCHOOL_ADMIN_EMAILS", "SCHOOL_SUPER_ADMIN_EMAILS"].map((k) => [k, process.env[k]]));
  process.env.SCHOOL_ADMIN_EMAILS = `${owner}, ${office}`;
  process.env.SCHOOL_SUPER_ADMIN_EMAILS = owner;
  setApprovedIdentitiesForTest([owner, office].map((e) => [`id-${e}`, { email: e, mfa: true }]));
  const store = useMemoryImageStore();
  const app = express();
  app.use((req, _res, next) => {
    req.log = { error() {}, warn() {}, info() {} } as unknown as typeof req.log;
    const who = req.headers["x-test-user"];
    if (typeof who === "string") { req.dbUser = { id: `id-${who}` } as NonNullable<typeof req.dbUser>; req.identity = { email: who, emailVerified: true, mfa: true }; }
    next();
  });
  app.use("/api/portal", portalRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/portal/export/everything`;
  const imageIds: string[] = [];
  const classIds: number[] = [];
  try {
    const photo = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const add = async () => { const id = randomUUID(); imageIds.push(id); store.set(`obj-${id}`, photo); await db.insert(portalImages).values({ id, objectName: `obj-${id}`, contentType: "image/jpeg", size: photo.length, purpose: "student" }); return id; };
    const [cls] = await db.insert(portalClasses).values({ name: `${marker} Year 4 Pearl` }).returning();
    classIds.push(cls.id);
    await db.insert(portalStudents).values({ studentId: `${marker}/1`, name: `${marker} Zainab Musa`, classId: cls.id, passwordHash: "SECRET-HASH-VALUE", guardianEmail: `mum-${marker.toLowerCase()}@example.test`, photoImageId: await add() });
    await db.insert(portalTeachers).values({ email: `t-${marker.toLowerCase()}@example.test`, name: `${marker} Mr Okon`, classIds: [cls.id], subjects: ["Mathematics"], photoFileId: await add() });

    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { "X-Test-User": office } })).status, 403, "office administrators cannot download everything");
    const r = await fetch(url, { headers: { "X-Test-User": owner } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/zip");
    assert.match(r.headers.get("content-disposition") ?? "", /attachment; filename="new-world-emerald-school-data-\d{4}-\d{2}-\d{2}\.zip"/);
    const raw = Buffer.from(await r.arrayBuffer());
    const files = unzip(raw);
    for (const f of ["students.csv", "teachers.csv", "staff-roles.csv", "parents.csv", "classes.csv", "results.csv", "cbt-scores.csv", "READ ME.txt"]) assert.ok(files.has(f), f);
    const students = files.get("students.csv")!.toString("utf8");
    assert.ok(students.startsWith("﻿"), "Excel reads UTF-8");
    assert.match(students, new RegExp(`${marker}/1,${marker} Zainab Musa,${marker} Year 4 Pearl,Primary,Yes`));
    assert.match(files.get("teachers.csv")!.toString("utf8"), new RegExp(`${marker} Mr Okon,t-${marker.toLowerCase()}@example.test`));
    assert.match(files.get("parents.csv")!.toString("utf8"), new RegExp(`mum-${marker.toLowerCase()}@example.test,${marker} Zainab Musa`));
    assert.match(files.get("staff-roles.csv")!.toString("utf8"), new RegExp(`School owner \\(super administrator\\),${owner}`));
    const photos = [...files.keys()].filter((k) => k.startsWith("photos/") && k.includes(marker));
    assert.equal(photos.length, 2);
    assert.ok(photos.every((k) => files.get(k)!.equals(photo)));
    assert.ok(photos.some((k) => k === `photos/students/${marker}-1 ${marker} Zainab Musa.jpg`), photos.join(" | "));
    for (const [, body] of files) assert.ok(!body.includes("SECRET-HASH-VALUE"), "never a password");
  } finally {
    server.close();
    await db.delete(portalStudents).where(like(portalStudents.studentId, `${marker}%`));
    await db.delete(portalTeachers).where(like(portalTeachers.name, `${marker}%`));
    if (imageIds.length) await db.delete(portalImages).where(inArray(portalImages.id, imageIds));
    if (classIds.length) await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await pool.end();
  }
});
