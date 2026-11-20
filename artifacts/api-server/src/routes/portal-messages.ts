import { Router, type Request } from "express";
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { db, portalClasses, portalMessages, portalStudents, portalSubjects, portalTeachers, type PortalMessageRecord } from "@workspace/db";
import { GetMessageThreadParams, GetPrivateMessageThreadParams, MarkMyMessagesReadBody, ReplyMessageThreadBody, SendMyMessageBody } from "@workspace/api-zod";
import { check, portalActor, staffOnly, studentOnly, type PortalActor } from "../lib/portal-auth";
import { CHANNELS, SEND_WINDOW_MS, STUDENT_SEND_LIMIT, THREAD_LIMIT, cleanBody, staffMayOpen, threadTitle, type Channel } from "../lib/messages";

export const portalMessagesRouter = Router();

const view = (m: PortalMessageRecord) => ({ id: m.id, fromStaff: m.fromStaff, senderName: m.senderName, body: m.body, createdAt: m.createdAt.toISOString(), read: m.readAt !== null });

/** One conversation: (student, channel), and for a private conversation also the teacher. */
const where = (studentId: number, channel: Channel, teacherId: number | null) => and(
  eq(portalMessages.studentId, studentId), eq(portalMessages.channel, channel),
  ...(channel === "teacher" ? [eq(portalMessages.teacherId, teacherId ?? -1)] : []),
);

async function thread(studentId: number, channel: Channel, teacherId: number | null = null) {
  const rows = await db.select().from(portalMessages).where(where(studentId, channel, teacherId))
    .orderBy(desc(portalMessages.createdAt), desc(portalMessages.id)).limit(THREAD_LIMIT);
  return rows.reverse();
}

/** Marks messages from the other side as read. */
async function markRead(studentId: number, channel: Channel, fromStaff: boolean, teacherId: number | null = null) {
  await db.update(portalMessages).set({ readAt: new Date() })
    .where(and(where(studentId, channel, teacherId), eq(portalMessages.fromStaff, fromStaff), isNull(portalMessages.readAt)));
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

/** The teachers a student may write to privately: their class teacher and whoever teaches their class a subject. */
async function teachersFor(classId: number) {
  const [teachers, subjects] = await Promise.all([
    db.select({ id: portalTeachers.id, name: portalTeachers.name, title: portalTeachers.title, photoFileId: portalTeachers.photoFileId, showInDirectory: portalTeachers.showInDirectory, classIds: portalTeachers.classIds })
      .from(portalTeachers).where(eq(portalTeachers.active, true)),
    db.select({ teacherId: portalSubjects.teacherId, name: portalSubjects.name }).from(portalSubjects).where(eq(portalSubjects.classId, classId)),
  ]);
  return teachers
    .filter((t) => t.classIds.includes(classId) || subjects.some((s) => s.teacherId === t.id))
    .map((t) => ({
      id: t.id, name: t.name, title: t.title ?? "", photoId: t.showInDirectory ? t.photoFileId ?? null : null, classTeacher: t.classIds.includes(classId),
      subjects: [...new Set(subjects.filter((s) => s.teacherId === t.id).map((s) => s.name))].sort(),
    }))
    .sort((a, b) => Number(b.classTeacher) - Number(a.classTeacher) || a.name.localeCompare(b.name));
}

async function myMessages(s: { id: number; classId: number }) {
  const [cls, teachers] = await Promise.all([className(s.classId), teachersFor(s.classId)]);
  const threads = [];
  for (const channel of CHANNELS) {
    const messages = await thread(s.id, channel);
    threads.push({ channel, title: threadTitle(channel, cls), unread: messages.filter((m) => m.fromStaff && !m.readAt).length, messages: messages.map(view), teacherId: null, closed: false });
  }
  // Private conversations the student has with individual teachers, most recent first.
  const started = await db.select({ teacherId: portalMessages.teacherId, last: sql<string>`max(${portalMessages.createdAt})` }).from(portalMessages)
    .where(and(eq(portalMessages.studentId, s.id), eq(portalMessages.channel, "teacher")))
    .groupBy(portalMessages.teacherId).orderBy(sql`max(${portalMessages.createdAt}) desc`);
  const ids = started.map((r) => r.teacherId).filter((id): id is number => id !== null);
  const names = new Map((ids.length ? await db.select({ id: portalTeachers.id, name: portalTeachers.name }).from(portalTeachers).where(inArray(portalTeachers.id, ids)) : []).map((t) => [t.id, t.name]));
  for (const teacherId of ids) {
    const messages = await thread(s.id, "teacher", teacherId);
    threads.push({
      channel: "teacher" as const, title: names.get(teacherId) ?? "A former teacher", unread: messages.filter((m) => m.fromStaff && !m.readAt).length,
      messages: messages.map(view), teacherId, closed: !teachers.some((t) => t.id === teacherId),
    });
  }
  return { threads, teachers };
}

portalMessagesRouter.get("/my-messages", async (req, res) => {
  res.json(await myMessages(await student(req)));
});

portalMessagesRouter.post("/my-messages", async (req, res) => {
  const s = await student(req);
  const input = SendMyMessageBody.parse(req.body);
  const body = cleanBody(input.body);
  check(body, "Write a message of up to 1000 characters.");
  let teacherId: number | null = null;
  if (input.channel === "teacher") {
    teacherId = input.teacherId ?? null;
    check(teacherId && (await teachersFor(s.classId)).some((t) => t.id === teacherId), "Choose one of your teachers to write to.", 400);
  }
  const [{ recent }] = await db.select({ recent: sql<number>`count(*)::int` }).from(portalMessages)
    .where(and(eq(portalMessages.studentId, s.id), eq(portalMessages.fromStaff, false), gte(portalMessages.createdAt, new Date(Date.now() - SEND_WINDOW_MS))));
  check(recent < STUDENT_SEND_LIMIT, "You have sent a lot of messages. Please wait a few minutes.", 429);
  await db.insert(portalMessages).values({ studentId: s.id, channel: input.channel, fromStaff: false, senderName: s.name, body, teacherId });
  res.json(await myMessages(s));
});

portalMessagesRouter.post("/my-messages/read", async (req, res) => {
  const s = await student(req);
  const { channel, teacherId } = MarkMyMessagesReadBody.parse(req.body);
  await markRead(s.id, channel, true, channel === "teacher" ? teacherId ?? -1 : null);
  res.json(await myMessages(s));
});

// ---- Staff side
portalMessagesRouter.get("/message-threads", async (req, res) => {
  const actor = await portalActor(req);
  staffOnly(actor);
  // A teacher sees their classes' class conversations, and private conversations students started with them alone.
  const mine = actor.teacherId ? and(eq(portalMessages.channel, "teacher"), eq(portalMessages.teacherId, actor.teacherId)) : undefined;
  const classes = actor.classIds.length ? and(eq(portalMessages.channel, "class"), inArray(portalStudents.classId, actor.classIds)) : undefined;
  if (actor.role === "teacher" && !mine && !classes) { res.json([]); return; }
  const scope = actor.role === "admin" ? undefined : mine && classes ? or(mine, classes) : (mine ?? classes);
  // One row per conversation: its latest message plus the count of unread student messages.
  const rows = await db.select({
    studentId: portalMessages.studentId, channel: portalMessages.channel, teacherId: portalMessages.teacherId,
    lastAt: sql<string>`max(${portalMessages.createdAt})`,
    unread: sql<number>`count(*) filter (where ${portalMessages.fromStaff} = false and ${portalMessages.readAt} is null)::int`,
    lastId: sql<number>`max(${portalMessages.id})`,
    studentName: portalStudents.name, studentCode: portalStudents.studentId, className: portalClasses.name,
  }).from(portalMessages)
    .innerJoin(portalStudents, eq(portalStudents.id, portalMessages.studentId))
    .innerJoin(portalClasses, eq(portalClasses.id, portalStudents.classId))
    .where(scope)
    .groupBy(portalMessages.studentId, portalMessages.channel, portalMessages.teacherId, portalStudents.name, portalStudents.studentId, portalClasses.name)
    .orderBy(sql`max(${portalMessages.createdAt}) desc`).limit(300);
  const last = rows.length ? await db.select().from(portalMessages).where(inArray(portalMessages.id, rows.map((r) => r.lastId))) : [];
  const byId = new Map(last.map((m) => [m.id, m]));
  const teacherIds = [...new Set(rows.map((r) => r.teacherId).filter((id): id is number => id !== null))];
  const teacherNames = new Map((teacherIds.length ? await db.select({ id: portalTeachers.id, name: portalTeachers.name }).from(portalTeachers).where(inArray(portalTeachers.id, teacherIds)) : []).map((t) => [t.id, t.name]));
  res.json(rows.map((r) => ({
    studentId: r.studentId, studentName: r.studentName, studentCode: r.studentCode, className: r.className, channel: r.channel,
    lastBody: (byId.get(r.lastId)?.body ?? "").slice(0, 140), lastAt: new Date(r.lastAt).toISOString(),
    lastFromStaff: byId.get(r.lastId)?.fromStaff ?? false, unread: r.unread,
    teacherId: r.channel === "teacher" ? r.teacherId : null, teacherName: r.teacherId ? teacherNames.get(r.teacherId) ?? "" : "",
  })));
});

async function openConversation(actor: PortalActor, studentId: number, channel: Channel, teacherId: number | null) {
  const [s] = await db.select().from(portalStudents).where(eq(portalStudents.id, studentId));
  check(s && staffMayOpen(actor, channel, s.classId, teacherId), "Conversation not found.", 404);
  return s;
}
async function staffThread(actor: PortalActor, s: { id: number; name: string; studentId: string; classId: number }, channel: Channel, teacherId: number | null = null) {
  const teacherName = teacherId ? (await db.select({ name: portalTeachers.name }).from(portalTeachers).where(eq(portalTeachers.id, teacherId)))[0]?.name ?? "" : "";
  return {
    studentId: s.id, studentName: s.name, studentCode: s.studentId, className: await className(s.classId), channel, messages: (await thread(s.id, channel, teacherId)).map(view),
    teacherId, teacherName, canReply: channel !== "teacher" || actor.teacherId === teacherId,
  };
}

portalMessagesRouter.get("/message-threads/:studentId/:channel", async (req, res) => {
  const actor = await portalActor(req);
  staffOnly(actor);
  const { studentId, channel } = GetMessageThreadParams.parse(req.params);
  check(channel !== "teacher", "Conversation not found.", 404);
  const s = await openConversation(actor, studentId, channel, null);
  await markRead(s.id, channel, false);
  res.json(await staffThread(actor, s, channel));
});

portalMessagesRouter.post("/message-threads/:studentId/:channel", async (req, res) => {
  const actor = await portalActor(req);
  staffOnly(actor);
  const { studentId, channel } = GetMessageThreadParams.parse(req.params);
  check(channel !== "teacher", "Conversation not found.", 404);
  const s = await openConversation(actor, studentId, channel, null);
  const body = cleanBody(ReplyMessageThreadBody.parse(req.body).body);
  check(body, "Write a reply of up to 1000 characters.");
  // Staff are shown to students by name; the office signs as the office.
  const senderName = actor.role === "admin" ? "School office" : actor.name;
  await db.insert(portalMessages).values({ studentId: s.id, channel, fromStaff: true, senderName, senderEmail: req.identity?.email ?? null, body });
  await markRead(s.id, channel, false);
  res.json(await staffThread(actor, s, channel));
});

// ---- Private conversations: one student and the one teacher they chose
portalMessagesRouter.get("/message-threads/:studentId/teacher/:teacherId", async (req, res) => {
  const actor = await portalActor(req);
  staffOnly(actor);
  const { studentId, teacherId } = GetPrivateMessageThreadParams.parse(req.params);
  const s = await openConversation(actor, studentId, "teacher", teacherId);
  // Only the teacher's own visit marks the student's messages read; the office reading them does not.
  if (actor.teacherId === teacherId) await markRead(s.id, "teacher", false, teacherId);
  res.json(await staffThread(actor, s, "teacher", teacherId));
});

portalMessagesRouter.post("/message-threads/:studentId/teacher/:teacherId", async (req, res) => {
  const actor = await portalActor(req);
  staffOnly(actor);
  const { studentId, teacherId } = GetPrivateMessageThreadParams.parse(req.params);
  const s = await openConversation(actor, studentId, "teacher", teacherId);
  check(actor.teacherId === teacherId, "Only the teacher the student wrote to can answer this conversation.", 403);
  const body = cleanBody(ReplyMessageThreadBody.parse(req.body).body);
  check(body, "Write a reply of up to 1000 characters.");
  await db.insert(portalMessages).values({ studentId: s.id, channel: "teacher", fromStaff: true, senderName: actor.name, senderEmail: req.identity?.email ?? null, body, teacherId });
  await markRead(s.id, "teacher", false, teacherId);
  res.json(await staffThread(actor, s, "teacher", teacherId));
});
