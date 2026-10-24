import { Router, type Request } from "express";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db, portalClasses, portalMessages, portalStudents, type PortalMessageRecord } from "@workspace/db";
import { GetMessageThreadParams, MarkMyMessagesReadBody, ReplyMessageThreadBody, SendMyMessageBody } from "@workspace/api-zod";
import { check, portalActor, staffOnly, studentOnly } from "../lib/portal-auth";
import { CHANNELS, SEND_WINDOW_MS, STUDENT_SEND_LIMIT, THREAD_LIMIT, cleanBody, staffMayOpen, threadTitle, type Channel } from "../lib/messages";

export const portalMessagesRouter = Router();

const view = (m: PortalMessageRecord) => ({ id: m.id, fromStaff: m.fromStaff, senderName: m.senderName, body: m.body, createdAt: m.createdAt.toISOString(), read: m.readAt !== null });

async function thread(studentId: number, channel: Channel) {
  const rows = await db.select().from(portalMessages)
    .where(and(eq(portalMessages.studentId, studentId), eq(portalMessages.channel, channel)))
    .orderBy(desc(portalMessages.createdAt), desc(portalMessages.id)).limit(THREAD_LIMIT);
  return rows.reverse();
}

/** Marks messages from the other side as read. */
async function markRead(studentId: number, channel: Channel, fromStaff: boolean) {
  await db.update(portalMessages).set({ readAt: new Date() })
    .where(and(eq(portalMessages.studentId, studentId), eq(portalMessages.channel, channel), eq(portalMessages.fromStaff, fromStaff), isNull(portalMessages.readAt)));
}

async function className(classId: number) {
  const [c] = await db.select({ name: portalClasses.name }).from(portalClasses).where(eq(portalClasses.id, classId));
  return c?.name ?? "";
}

// ---- Student side
async function student(req: Request) {
  const actor = await portalActor(req);
  studentOnly(actor);
  return actor.student!;
}

async function myMessages(s: { id: number; classId: number }) {
  const cls = await className(s.classId);
  const threads = [];
  for (const channel of CHANNELS) {
    const messages = await thread(s.id, channel);
    threads.push({ channel, title: threadTitle(channel, cls), unread: messages.filter((m) => m.fromStaff && !m.readAt).length, messages: messages.map(view) });
  }
  return { threads };
}

portalMessagesRouter.get("/my-messages", async (req, res) => {
  res.json(await myMessages(await student(req)));
});

portalMessagesRouter.post("/my-messages", async (req, res) => {
  const s = await student(req);
  const input = SendMyMessageBody.parse(req.body);
  const body = cleanBody(input.body);
  check(body, "Write a message of up to 1000 characters.");
  const [{ recent }] = await db.select({ recent: sql<number>`count(*)::int` }).from(portalMessages)
    .where(and(eq(portalMessages.studentId, s.id), eq(portalMessages.fromStaff, false), gte(portalMessages.createdAt, new Date(Date.now() - SEND_WINDOW_MS))));
  check(recent < STUDENT_SEND_LIMIT, "You have sent a lot of messages. Please wait a few minutes.", 429);
  await db.insert(portalMessages).values({ studentId: s.id, channel: input.channel, fromStaff: false, senderName: s.name, body });
  res.json(await myMessages(s));
});

portalMessagesRouter.post("/my-messages/read", async (req, res) => {
  const s = await student(req);
  const { channel } = MarkMyMessagesReadBody.parse(req.body);
  await markRead(s.id, channel, true);
  res.json(await myMessages(s));
});

// ---- Staff side
portalMessagesRouter.get("/message-threads", async (req, res) => {
  const actor = await portalActor(req);
  staffOnly(actor);
  if (actor.role === "teacher" && !actor.classIds.length) { res.json([]); return; }
  const scope = actor.role === "admin" ? undefined : and(eq(portalMessages.channel, "class"), inArray(portalStudents.classId, actor.classIds));
  // One row per conversation: its latest message plus the count of unread student messages.
  const rows = await db.select({
    studentId: portalMessages.studentId, channel: portalMessages.channel,
    lastAt: sql<string>`max(${portalMessages.createdAt})`,
    unread: sql<number>`count(*) filter (where ${portalMessages.fromStaff} = false and ${portalMessages.readAt} is null)::int`,
    lastId: sql<number>`max(${portalMessages.id})`,
    studentName: portalStudents.name, studentCode: portalStudents.studentId, className: portalClasses.name,
  }).from(portalMessages)
    .innerJoin(portalStudents, eq(portalStudents.id, portalMessages.studentId))
    .innerJoin(portalClasses, eq(portalClasses.id, portalStudents.classId))
    .where(scope)
    .groupBy(portalMessages.studentId, portalMessages.channel, portalStudents.name, portalStudents.studentId, portalClasses.name)
    .orderBy(sql`max(${portalMessages.createdAt}) desc`).limit(300);
  const last = rows.length ? await db.select().from(portalMessages).where(inArray(portalMessages.id, rows.map((r) => r.lastId))) : [];
  const byId = new Map(last.map((m) => [m.id, m]));
  res.json(rows.map((r) => ({
    studentId: r.studentId, studentName: r.studentName, studentCode: r.studentCode, className: r.className, channel: r.channel,
    lastBody: (byId.get(r.lastId)?.body ?? "").slice(0, 140), lastAt: new Date(r.lastAt).toISOString(),
    lastFromStaff: byId.get(r.lastId)?.fromStaff ?? false, unread: r.unread,
  })));
});

async function openThread(req: Request) {
  const actor = await portalActor(req);
  staffOnly(actor);
  const { studentId, channel } = GetMessageThreadParams.parse(req.params);
  const [s] = await db.select().from(portalStudents).where(eq(portalStudents.id, studentId));
  check(s && staffMayOpen(actor, channel, s.classId), "Conversation not found.", 404);
  return { actor, s, channel };
}
async function staffThread(s: { id: number; name: string; studentId: string; classId: number }, channel: Channel) {
  return { studentId: s.id, studentName: s.name, studentCode: s.studentId, className: await className(s.classId), channel, messages: (await thread(s.id, channel)).map(view) };
}

portalMessagesRouter.get("/message-threads/:studentId/:channel", async (req, res) => {
  const { s, channel } = await openThread(req);
  await markRead(s.id, channel, false);
  res.json(await staffThread(s, channel));
});

portalMessagesRouter.post("/message-threads/:studentId/:channel", async (req, res) => {
  const { actor, s, channel } = await openThread(req);
  const body = cleanBody(ReplyMessageThreadBody.parse(req.body).body);
  check(body, "Write a reply of up to 1000 characters.");
  // Staff are shown to students by name; the office signs as the office.
  const senderName = actor.role === "admin" ? "School office" : actor.name;
  await db.insert(portalMessages).values({ studentId: s.id, channel, fromStaff: true, senderName, senderEmail: req.identity?.email ?? null, body });
  await markRead(s.id, channel, false);
  res.json(await staffThread(s, channel));
});
