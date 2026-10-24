import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { inArray } from "drizzle-orm";
import { db, pool, portalClasses, portalMessages, portalSessions, portalStudents } from "@workspace/db";
import portalRouter from "../routes/portal";
import { hashPassword } from "./portal-auth";
import { STUDENT_SEND_LIMIT } from "./messages";

// Database checks for student-school messages: who can read what, unread counts and the send limit.
test("messages: student threads, office inbox, replies, read state and isolation", async () => {
  const saved = process.env.SCHOOL_ADMIN_EMAILS;
  const marker = `QA-MSG-${randomUUID().slice(0, 8)}`.toUpperCase();
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
    const type = r.headers.get("content-type") ?? "";
    return { status: r.status, data: type.includes("json") ? await r.json() : null };
  }
  const admin = { admin: true };
  try {
    const [cls] = await db.insert(portalClasses).values({ name: marker + " A" }).returning();
    classIds.push(cls.id);
    const pw = await hashPassword("Message-Pass-1");
    const [ada, bayo] = await db.insert(portalStudents).values([
      { studentId: marker + "-1", name: "Ada Obi", classId: cls.id, passwordHash: pw, mustChangePassword: false },
      { studentId: marker + "-2", name: "Bayo Ade", classId: cls.id, passwordHash: pw, mustChangePassword: false },
    ]).returning();
    const login = async (id: string) => ({ cookie: (await fetch(root + "/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: id, password: "Message-Pass-1" }) })).headers.get("set-cookie")!.split(";")[0] });
    const adaS = await login(ada.studentId), bayoS = await login(bayo.studentId);

    // Sign-in rules.
    assert.equal((await call("/my-messages")).status, 401);
    assert.equal((await call("/my-messages", "GET", undefined, admin)).status, 401, "staff have no student inbox");
    assert.equal((await call("/message-threads", "GET", undefined, adaS)).status, 403);

    // Two empty threads to start.
    const start = await call("/my-messages", "GET", undefined, adaS);
    assert.deepEqual(start.data.threads.map((t: { channel: string; title: string }) => [t.channel, t.title]), [["class", `Class teacher (${marker} A)`], ["office", "School office"]]);

    // Ada writes to the office and to her class teacher.
    assert.equal((await call("/my-messages", "POST", { channel: "office", body: "   " }, adaS)).status, 400);
    assert.equal((await call("/my-messages", "POST", { channel: "staffroom", body: "Hi" }, adaS)).status, 400);
    const sent = await call("/my-messages", "POST", { channel: "office", body: "  Please, when is the PTA meeting?  " }, adaS);
    assert.equal(sent.status, 200, JSON.stringify(sent.data));
    assert.equal(sent.data.threads[1].messages[0].body, "Please, when is the PTA meeting?");
    await call("/my-messages", "POST", { channel: "class", body: "I was sick on Monday." }, adaS);

    // The office inbox lists both conversations with unread counts; other students cannot see them.
    const inbox = (await call("/message-threads", "GET", undefined, admin)).data.filter((t: { studentId: number }) => t.studentId === ada.id);
    assert.deepEqual(inbox.map((t: { channel: string; unread: number }) => [t.channel, t.unread]).sort(), [["class", 1], ["office", 1]]);
    assert.equal(inbox[0].studentName, "Ada Obi");
    const bayoView = await call("/my-messages", "GET", undefined, bayoS);
    assert.equal(bayoView.data.threads.every((t: { messages: unknown[] }) => t.messages.length === 0), true, "students only see their own");

    // Opening the thread marks Ada's message read; the reply is signed by the office.
    assert.equal((await call(`/message-threads/${ada.id}/office`, "GET", undefined, adaS)).status, 403);
    assert.equal((await call(`/message-threads/999999999/office`, "GET", undefined, admin)).status, 404);
    const opened = await call(`/message-threads/${ada.id}/office`, "GET", undefined, admin);
    assert.deepEqual([opened.data.studentName, opened.data.messages.length, opened.data.messages[0].read], ["Ada Obi", 1, true]);
    const reply = await call(`/message-threads/${ada.id}/office`, "POST", { body: "Friday at 2pm in the hall." }, admin);
    assert.equal(reply.status, 200);
    assert.deepEqual([reply.data.messages[1].fromStaff, reply.data.messages[1].senderName], [true, "School office"]);
    assert.equal((await call(`/message-threads/${ada.id}/office`, "POST", { body: "x".repeat(1001) }, admin)).status, 400);

    // Ada sees one unread reply until she opens it.
    const mine = await call("/my-messages", "GET", undefined, adaS);
    assert.equal(mine.data.threads[1].unread, 1);
    const read = await call("/my-messages/read", "POST", { channel: "office" }, adaS);
    assert.equal(read.data.threads[1].unread, 0);
    const after = (await call("/message-threads", "GET", undefined, admin)).data.find((t: { studentId: number; channel: string }) => t.studentId === ada.id && t.channel === "office");
    assert.deepEqual([after.unread, after.lastFromStaff, after.lastBody], [0, true, "Friday at 2pm in the hall."]);

    // Students cannot flood the inbox.
    for (let i = 0; i < STUDENT_SEND_LIMIT; i++) await db.insert(portalMessages).values({ studentId: bayo.id, channel: "class", fromStaff: false, senderName: "Bayo Ade", body: "spam " + i });
    assert.equal((await call("/my-messages", "POST", { channel: "class", body: "One more" }, bayoS)).status, 429);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    if (classIds.length) {
      const ids = (await db.select({ id: portalStudents.id }).from(portalStudents).where(inArray(portalStudents.classId, classIds))).map((s) => s.id);
      if (ids.length) {
        await db.delete(portalSessions).where(inArray(portalSessions.studentId, ids));
        await db.delete(portalMessages).where(inArray(portalMessages.studentId, ids));
      }
      await db.delete(portalStudents).where(inArray(portalStudents.classId, classIds));
      await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    }
    if (saved === undefined) delete process.env.SCHOOL_ADMIN_EMAILS; else process.env.SCHOOL_ADMIN_EMAILS = saved;
    await pool.end();
  }
});
