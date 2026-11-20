import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { inArray, like } from "drizzle-orm";
import { db, pool, portalClasses, portalMessages, portalSessions, portalStudents, portalSubjects, portalTeachers } from "@workspace/db";
import portalRouter from "../routes/portal";
import { hashPassword, setStaffEmailResolverForTest } from "./portal-auth";
import { STUDENT_SEND_LIMIT } from "./messages";

// Database checks for student-school messages: who can read what, unread counts and the send limit.
test("messages: student threads, office inbox, replies, read state and isolation", async () => {
  const saved = process.env.SCHOOL_ADMIN_EMAILS;
  const marker = `QA-MSG-${randomUUID().slice(0, 8)}`.toUpperCase();
  process.env.SCHOOL_ADMIN_EMAILS = `admin-${marker}@example.test`.toLowerCase();
  setStaffEmailResolverForTest(async (req) => (typeof req.headers["x-test-teacher"] === "string" ? req.headers["x-test-teacher"] : null));
  const classIds: number[] = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error() {}, warn() {}, info() {} } as unknown as typeof req.log;
    if (req.headers["x-test-admin"] === marker) {
      req.dbUser = { id: `synthetic-${marker}` } as NonNullable<typeof req.dbUser>;
      req.identity = { email: `admin-${marker}@example.test`.toLowerCase(), emailVerified: true, mfa: true };
    }
    if (typeof req.headers["x-test-teacher"] === "string") req.dbUser = { id: `id-${req.headers["x-test-teacher"]}` } as NonNullable<typeof req.dbUser>;
    next();
  });
  app.use("/api/portal", portalRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/portal`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function call(path: string, method = "GET", body?: unknown, opts: { cookie?: string; admin?: boolean; teacher?: string } = {}): Promise<{ status: number; data: any }> {
    const r = await fetch(root + path, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(opts.cookie ? { Cookie: opts.cookie } : {}), ...(opts.admin ? { "X-Test-Admin": marker } : {}), ...(opts.teacher ? { "X-Test-Teacher": opts.teacher } : {}) },
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

    // Private messages: Ada chooses one teacher; only that teacher (and the office, to safeguard) can read it.
    const m = marker.toLowerCase();
    const email = (who: string) => `${who}-${m}@example.test`;
    const [musa, ngozi, tolu, femi] = await db.insert(portalTeachers).values([
      { email: email("musa"), name: `${marker} Mr Musa`, classIds: [cls.id] },
      { email: email("ngozi"), name: `${marker} Mrs Ngozi`, classIds: [] },
      { email: email("tolu"), name: `${marker} Mr Tolu`, classIds: [cls.id] },
      { email: email("femi"), name: `${marker} Mr Femi`, classIds: [] },
    ]).returning();
    await db.insert(portalSubjects).values({ classId: cls.id, name: `${marker} Maths`, teacherId: ngozi.id });
    const teach = (t: typeof musa) => ({ teacher: t.email });
    const offered = (await call("/my-messages", "GET", undefined, adaS)).data.teachers;
    assert.deepEqual(offered.map((t: { id: number; classTeacher: boolean; subjects: string[] }) => [t.id, t.classTeacher, t.subjects]),
      [[musa.id, true, []], [tolu.id, true, []], [ngozi.id, false, [`${marker} Maths`]]], "class teachers first, then subject teachers; never a teacher with nothing to do with the class");
    assert.equal((await call("/my-messages", "POST", { channel: "teacher", body: "Hello" }, adaS)).status, 400, "a teacher must be chosen");
    assert.equal((await call("/my-messages", "POST", { channel: "teacher", teacherId: femi.id, body: "Hello" }, adaS)).status, 400, "not one of her teachers");
    const priv = await call("/my-messages", "POST", { channel: "teacher", teacherId: ngozi.id, body: "Please explain fractions again." }, adaS);
    assert.equal(priv.status, 200, JSON.stringify(priv.data));
    const privThread = priv.data.threads.find((t: { channel: string }) => t.channel === "teacher");
    assert.deepEqual([privThread.teacherId, privThread.title, privThread.messages.length, privThread.closed], [ngozi.id, `${marker} Mrs Ngozi`, 1, false]);
    assert.equal(priv.data.threads.find((t: { channel: string }) => t.channel === "class").messages.some((x: { body: string }) => x.body.includes("fractions")), false, "not in the class conversation");

    const inboxOf = async (t: typeof musa) => (await call("/message-threads", "GET", undefined, teach(t))).data.filter((x: { studentId: number }) => x.studentId === ada.id);
    assert.deepEqual((await inboxOf(ngozi)).map((x: { channel: string; teacherId: number | null }) => [x.channel, x.teacherId]), [["teacher", ngozi.id]], "Mrs Ngozi sees only her private conversation");
    for (const other of [musa, tolu]) {
      const list = await inboxOf(other);
      assert.deepEqual(list.map((x: { channel: string }) => x.channel), ["class"], "class teachers do not see the private conversation");
      assert.equal((await call(`/message-threads/${ada.id}/teacher/${ngozi.id}`, "GET", undefined, teach(other))).status, 404);
      assert.equal((await call(`/message-threads/${ada.id}/teacher/${ngozi.id}`, "POST", { body: "Hi" }, teach(other))).status, 404);
    }
    assert.equal((await inboxOf(femi)).length, 0);
    assert.equal((await call(`/message-threads/${ada.id}/teacher`, "GET", undefined, teach(ngozi))).status, 404, "private conversations only through their own address");

    // The office reads to safeguard, but does not answer and does not mark it read for the teacher.
    const officeView = await call(`/message-threads/${ada.id}/teacher/${ngozi.id}`, "GET", undefined, admin);
    assert.deepEqual([officeView.status, officeView.data.canReply, officeView.data.teacherName], [200, false, `${marker} Mrs Ngozi`]);
    assert.equal((await call(`/message-threads/${ada.id}/teacher/${ngozi.id}`, "POST", { body: "Office here" }, admin)).status, 403);
    const officeList = (await call("/message-threads", "GET", undefined, admin)).data.find((x: { studentId: number; channel: string }) => x.studentId === ada.id && x.channel === "teacher");
    assert.deepEqual([officeList.unread, officeList.teacherName], [1, `${marker} Mrs Ngozi`]);

    // Mrs Ngozi opens and answers it; Ada sees the reply from her by name.
    const hers = await call(`/message-threads/${ada.id}/teacher/${ngozi.id}`, "GET", undefined, teach(ngozi));
    assert.deepEqual([hers.data.canReply, hers.data.messages[0].read], [true, true]);
    const answered = await call(`/message-threads/${ada.id}/teacher/${ngozi.id}`, "POST", { body: "Come to my desk at break." }, teach(ngozi));
    assert.equal(answered.status, 200, JSON.stringify(answered.data));
    assert.equal(answered.data.messages[1].senderName, `${marker} Mrs Ngozi`);
    const adaNow = (await call("/my-messages", "GET", undefined, adaS)).data.threads.find((t: { channel: string }) => t.channel === "teacher");
    assert.equal(adaNow.unread, 1);
    const cleared = (await call("/my-messages/read", "POST", { channel: "teacher", teacherId: ngozi.id }, adaS)).data.threads.find((t: { channel: string }) => t.channel === "teacher");
    assert.equal(cleared.unread, 0);
    assert.equal((await call("/my-messages", "GET", undefined, bayoS)).data.threads.some((t: { channel: string }) => t.channel === "teacher"), false, "Bayo never sees Ada's private conversation");

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
      await db.delete(portalSubjects).where(inArray(portalSubjects.classId, classIds));
      await db.delete(portalStudents).where(inArray(portalStudents.classId, classIds));
      await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    }
    await db.delete(portalTeachers).where(like(portalTeachers.name, `${marker}%`));
    setStaffEmailResolverForTest(null);
    if (saved === undefined) delete process.env.SCHOOL_ADMIN_EMAILS; else process.env.SCHOOL_ADMIN_EMAILS = saved;
    await pool.end();
  }
});
