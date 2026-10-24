import express, { Router, type NextFunction, type Request, type Response } from "express";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  db, portalAssignments, portalAttendance, portalClasses, portalImages, portalStudents, portalSubmissions,
  type PortalAssignmentRecord, type PortalSubmissionRecord,
} from "@workspace/db";
import {
  CreateAssignmentBody, GetAttendanceSheetQueryParams, GetAttendanceSummaryQueryParams, MarkSubmissionBody,
  SaveAttendanceSheetBody, SubmitAssignmentBody,
} from "@workspace/api-zod";
import { check, classAllowed, PortalError, portalActor, staffOnly, studentOnly, type PortalActor } from "../lib/portal-auth";
import { MAX_IMAGE_BYTES, removeImage, saveImage } from "../lib/images";
import { addDays, assignmentValues, isCalendarDate, isLate, schoolDate, tally } from "../lib/learning";

export const portalLearningRouter = Router();
const MAX_PHOTOS = 5;

async function staff(req: Request) {
  const actor = await portalActor(req);
  staffOnly(actor);
  return actor;
}
async function classFor(actor: PortalActor, classId: number) {
  classAllowed(actor, classId);
  const [row] = await db.select().from(portalClasses).where(eq(portalClasses.id, classId));
  check(row, "Class not found.", 404);
  return row;
}
const activeStudents = (classId: number) => db.select().from(portalStudents)
  .where(and(eq(portalStudents.classId, classId), eq(portalStudents.active, true))).orderBy(asc(portalStudents.name));
const idParam = (req: Request) => {
  const id = Number(req.params.id);
  check(Number.isSafeInteger(id) && id > 0, "Not found.", 404);
  return id;
};

// ---- Attendance
async function sheet(classId: number, date: string) {
  const students = await activeStudents(classId);
  const rows = await db.select().from(portalAttendance).where(and(eq(portalAttendance.classId, classId), eq(portalAttendance.date, date)));
  const byStudent = new Map(rows.map((r) => [r.studentId, r]));
  return {
    classId, date, taken: rows.length > 0,
    students: students.map((s) => ({ id: s.id, name: s.name, studentId: s.studentId, status: (byStudent.get(s.id)?.status ?? null) as "present" | null, note: byStudent.get(s.id)?.note ?? "" })),
  };
}

portalLearningRouter.get("/attendance", async (req, res) => {
  const actor = await staff(req);
  const q = GetAttendanceSheetQueryParams.parse(req.query);
  check(isCalendarDate(q.date), "Choose a valid date.");
  await classFor(actor, q.classId);
  res.json(await sheet(q.classId, q.date));
});

portalLearningRouter.put("/attendance", async (req, res) => {
  const actor = await staff(req);
  const body = SaveAttendanceSheetBody.parse(req.body);
  check(isCalendarDate(body.date), "Choose a valid date.");
  const today = schoolDate();
  check(body.date <= today, "You cannot take the register for a future date.");
  check(body.date >= addDays(today, -366), "That date is more than a year ago.");
  await classFor(actor, body.classId);
  const inClass = new Set((await activeStudents(body.classId)).map((s) => s.id));
  check(body.records.every((r) => inClass.has(r.studentId)), "Every student must belong to this class.");
  const markedBy = req.identity?.email ?? actor.name;
  await db.transaction(async (tx) => {
    for (const r of body.records) {
      const values = { classId: body.classId, studentId: r.studentId, date: body.date, status: r.status, note: (r.note ?? "").trim(), markedBy, markedAt: new Date() };
      await tx.insert(portalAttendance).values(values)
        .onConflictDoUpdate({ target: [portalAttendance.studentId, portalAttendance.date], set: { status: values.status, note: values.note, classId: values.classId, markedBy, markedAt: values.markedAt } });
    }
  });
  res.json(await sheet(body.classId, body.date));
});

portalLearningRouter.get("/attendance/summary", async (req, res) => {
  const actor = await staff(req);
  const q = GetAttendanceSummaryQueryParams.parse(req.query);
  check(isCalendarDate(q.from) && isCalendarDate(q.to) && q.from <= q.to, "Choose a valid date range.");
  check(q.to <= addDays(q.from, 400), "Choose a range of about a school year or less.");
  await classFor(actor, q.classId);
  const students = await activeStudents(q.classId);
  const rows = await db.select().from(portalAttendance)
    .where(and(eq(portalAttendance.classId, q.classId), gte(portalAttendance.date, q.from), lte(portalAttendance.date, q.to)));
  const daysOpen = new Set(rows.map((r) => r.date)).size;
  res.json({
    classId: q.classId, from: q.from, to: q.to, daysOpen,
    students: students.map((s) => ({ id: s.id, name: s.name, studentId: s.studentId, ...tally(rows.filter((r) => r.studentId === s.id).map((r) => r.status)) })),
  });
});

portalLearningRouter.get("/attendance/me", async (req, res) => {
  const student = studentOnly(await portalActor(req));
  const since = addDays(schoolDate(), -180);
  const rows = await db.select().from(portalAttendance)
    .where(and(eq(portalAttendance.studentId, student.id), gte(portalAttendance.date, since)))
    .orderBy(sql`${portalAttendance.date} desc`);
  res.json({ totals: tally(rows.map((r) => r.status)), records: rows.map((r) => ({ date: r.date, status: r.status as "present", note: r.note })) });
});

// ---- Assignments (staff)
function submissionView(s: PortalSubmissionRecord, a: PortalAssignmentRecord) {
  return {
    id: s.id, text: s.text, imageIds: s.imageIds, submittedAt: s.submittedAt.toISOString(), late: isLate(s.submittedAt, a.dueAt),
    score: s.score, feedback: s.feedback, markedAt: s.markedAt?.toISOString() ?? null,
  };
}

async function staffViews(assignments: PortalAssignmentRecord[]) {
  if (!assignments.length) return [];
  const classIds = [...new Set(assignments.map((a) => a.classId))];
  const names = new Map((await db.select().from(portalClasses).where(inArray(portalClasses.id, classIds))).map((c) => [c.id, c.name]));
  const students = await db.select({ classId: portalStudents.classId }).from(portalStudents)
    .where(and(inArray(portalStudents.classId, classIds), eq(portalStudents.active, true)));
  const subs = await db.select({ assignmentId: portalSubmissions.assignmentId, markedAt: portalSubmissions.markedAt }).from(portalSubmissions)
    .where(inArray(portalSubmissions.assignmentId, assignments.map((a) => a.id)));
  return assignments.map((a) => ({
    id: a.id, classId: a.classId, className: names.get(a.classId) ?? "", subject: a.subject, title: a.title, instructions: a.instructions,
    dueAt: a.dueAt.toISOString(), maxScore: a.maxScore, published: a.published,
    students: students.filter((s) => s.classId === a.classId).length,
    submitted: subs.filter((s) => s.assignmentId === a.id).length,
    marked: subs.filter((s) => s.assignmentId === a.id && s.markedAt).length,
  }));
}

portalLearningRouter.get("/assignments", async (req, res) => {
  const actor = await staff(req);
  const scope = actor.role === "admin" ? undefined : inArray(portalAssignments.classId, actor.classIds.length ? actor.classIds : [-1]);
  const rows = await db.select().from(portalAssignments).where(scope).orderBy(sql`${portalAssignments.dueAt} desc`);
  res.json(await staffViews(rows));
});

portalLearningRouter.post("/assignments", async (req, res) => {
  const actor = await staff(req);
  const body = CreateAssignmentBody.parse(req.body);
  await classFor(actor, body.classId);
  const result = assignmentValues(body);
  if (!result.ok) throw new PortalError(400, result.error);
  const [row] = await db.insert(portalAssignments).values({ ...result.values, classId: body.classId, createdBy: req.identity?.email ?? actor.name }).returning();
  res.json((await staffViews([row]))[0]);
});

async function ownAssignment(actor: PortalActor, id: number) {
  const [row] = await db.select().from(portalAssignments).where(eq(portalAssignments.id, id));
  check(row, "Assignment not found.", 404);
  classAllowed(actor, row.classId);
  return row;
}

portalLearningRouter.put("/assignments/:id", async (req, res) => {
  const actor = await staff(req);
  const old = await ownAssignment(actor, idParam(req));
  const body = CreateAssignmentBody.parse(req.body);
  await classFor(actor, body.classId);
  const result = assignmentValues(body);
  if (!result.ok) throw new PortalError(400, result.error);
  const [row] = await db.update(portalAssignments).set({ ...result.values, classId: body.classId }).where(eq(portalAssignments.id, old.id)).returning();
  res.json((await staffViews([row]))[0]);
});

portalLearningRouter.delete("/assignments/:id", async (req, res) => {
  const actor = await staff(req);
  const row = await ownAssignment(actor, idParam(req));
  const photos = (await db.select({ imageIds: portalSubmissions.imageIds }).from(portalSubmissions).where(eq(portalSubmissions.assignmentId, row.id))).flatMap((s) => s.imageIds);
  await db.delete(portalAssignments).where(eq(portalAssignments.id, row.id));
  for (const id of photos) await removeImage(id);
  res.json({ message: "Assignment deleted." });
});

portalLearningRouter.get("/assignments/:id/submissions", async (req, res) => {
  const actor = await staff(req);
  const a = await ownAssignment(actor, idParam(req));
  const students = await activeStudents(a.classId);
  const subs = await db.select().from(portalSubmissions).where(eq(portalSubmissions.assignmentId, a.id));
  const byStudent = new Map(subs.map((s) => [s.studentId, s]));
  res.json(students.map((s) => ({ studentId: s.id, name: s.name, studentCode: s.studentId, submission: byStudent.has(s.id) ? submissionView(byStudent.get(s.id)!, a) : null })));
});

portalLearningRouter.post("/submissions/:id/mark", async (req, res) => {
  const actor = await staff(req);
  const body = MarkSubmissionBody.parse(req.body);
  const [sub] = await db.select().from(portalSubmissions).where(eq(portalSubmissions.id, idParam(req)));
  check(sub, "Submission not found.", 404);
  const a = await ownAssignment(actor, sub.assignmentId);
  check(body.score <= a.maxScore, `The score cannot be more than ${a.maxScore}.`);
  await db.update(portalSubmissions).set({ score: body.score, feedback: body.feedback.trim(), markedAt: new Date(), markedBy: req.identity?.email ?? actor.name }).where(eq(portalSubmissions.id, sub.id));
  res.json({ message: "Marked." });
});

// ---- Assignments (students)
async function studentViews(classId: number, studentId: number) {
  const rows = await db.select().from(portalAssignments)
    .where(and(eq(portalAssignments.classId, classId), eq(portalAssignments.published, true))).orderBy(asc(portalAssignments.dueAt));
  const subs = rows.length ? await db.select().from(portalSubmissions)
    .where(and(eq(portalSubmissions.studentId, studentId), inArray(portalSubmissions.assignmentId, rows.map((a) => a.id)))) : [];
  return rows.map((a) => {
    const s = subs.find((x) => x.assignmentId === a.id);
    return { id: a.id, subject: a.subject, title: a.title, instructions: a.instructions, dueAt: a.dueAt.toISOString(), maxScore: a.maxScore, submission: s ? submissionView(s, a) : null };
  });
}

portalLearningRouter.get("/my-assignments", async (req, res) => {
  const student = studentOnly(await portalActor(req));
  res.json(await studentViews(student.classId, student.id));
});

const uploaderTag = (studentId: number) => `student:${studentId}`;

portalLearningRouter.post("/my-assignments/:id/submit", async (req, res) => {
  const student = studentOnly(await portalActor(req));
  const body = SubmitAssignmentBody.parse(req.body);
  const [a] = await db.select().from(portalAssignments).where(eq(portalAssignments.id, idParam(req)));
  check(a && a.published && a.classId === student.classId, "Assignment not found.", 404);
  const text = body.text.trim();
  const imageIds = [...new Set(body.imageIds)];
  check(text || imageIds.length, "Write an answer or add a photo of your work.");
  check(imageIds.length <= MAX_PHOTOS, `Add up to ${MAX_PHOTOS} photos.`);
  if (imageIds.length) {
    const owned = await db.select({ id: portalImages.id }).from(portalImages)
      .where(and(inArray(portalImages.id, imageIds), eq(portalImages.purpose, "assignment"), eq(portalImages.uploadedBy, uploaderTag(student.id))));
    check(owned.length === imageIds.length, "One of the photos could not be found. Please add it again.");
  }
  const [existing] = await db.select().from(portalSubmissions).where(and(eq(portalSubmissions.assignmentId, a.id), eq(portalSubmissions.studentId, student.id)));
  check(!existing?.markedAt, "This assignment has been marked and can no longer be changed.", 409);
  if (existing) {
    await db.update(portalSubmissions).set({ text, imageIds, submittedAt: new Date() }).where(eq(portalSubmissions.id, existing.id));
    for (const old of existing.imageIds) if (!imageIds.includes(old)) await removeImage(old);
  } else {
    await db.insert(portalSubmissions).values({ assignmentId: a.id, studentId: student.id, text, imageIds });
  }
  res.json((await studentViews(student.classId, student.id)).find((v) => v.id === a.id));
});

portalLearningRouter.post(
  "/assignment-images",
  async (req: Request, _res: Response, next: NextFunction) => { try { studentOnly(await portalActor(req)); next(); } catch (error) { next(error); } },
  express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }),
  async (req, res) => {
    const student = studentOnly(await portalActor(req));
    const imageId = await saveImage(req.body, "assignment", uploaderTag(student.id));
    res.json({ imageId });
  },
);
