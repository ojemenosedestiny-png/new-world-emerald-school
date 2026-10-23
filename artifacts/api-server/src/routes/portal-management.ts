import { Router } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, portalClasses, portalStudents, portalTeachers, portalSessions, portalExams, portalAttempts,
  portalMaterials, portalNotices, portalFiles,
} from "@workspace/db";
import { ManagePortalBody } from "@workspace/api-zod";
import { check, portalActor, staffOnly, classAllowed, hashPassword, type PortalActor } from "../lib/portal-auth";
import { automaticMarks, attemptView, finalizeExpired, validateQuestions } from "../lib/portal-assessment";
import { validEmail } from "../lib/accounts";

export const portalManagementRouter = Router();
function scoped(actor: PortalActor, column: typeof portalExams.classId | typeof portalClasses.id | typeof portalStudents.classId | typeof portalAttempts.examId | typeof portalMaterials.classId | typeof portalNotices.classId) {
  return actor.role === "admin" ? undefined : inArray(column, actor.classIds.length ? actor.classIds : [-1]);
}
async function validClass(actor: PortalActor, id: number) {
  classAllowed(actor, id);
  const [row] = await db.select().from(portalClasses).where(eq(portalClasses.id, id));
  check(row, "Class not found.", 404);
}
async function validFile(id: string | null | undefined, classId: number) {
  if (!id) return;
  const [file] = await db.select().from(portalFiles).where(and(eq(portalFiles.id, id), eq(portalFiles.classId, classId)));
  check(file, "The uploaded PDF must belong to this class.");
}
portalManagementRouter.get("/manage", async (req, res) => {
  const actor = await portalActor(req);
  staffOnly(actor);
  const classes = await db.select().from(portalClasses).where(scoped(actor, portalClasses.id));
  const students = await db.select({ id: portalStudents.id, studentId: portalStudents.studentId, name: portalStudents.name, classId: portalStudents.classId, active: portalStudents.active, guardianEmail: portalStudents.guardianEmail, accountStatus: portalStudents.accountStatus }).from(portalStudents).where(scoped(actor, portalStudents.classId));
  const teachers = actor.role === "admin" ? await db.select().from(portalTeachers) : [];
  const exams = await db.select().from(portalExams).where(scoped(actor, portalExams.classId));
  const rawAttempts = exams.length ? await db.select().from(portalAttempts).where(inArray(portalAttempts.examId, exams.map((e) => e.id))) : [];
  const attempts = await Promise.all(rawAttempts.map(async (raw) => {
    const attempt = await finalizeExpired(raw);
    const exam = exams.find((e) => e.id === raw.examId)!;
    const student = students.find((s) => s.id === raw.studentId);
    return { ...attemptView(attempt, exam, true), classId: exam.classId, studentName: student?.name ?? "Former enrolment", studentId: student?.studentId ?? "", questionKeys: attempt.questions };
  }));
  const materials = await db.select().from(portalMaterials).where(scoped(actor, portalMaterials.classId));
  const notices = await db.select().from(portalNotices).where(scoped(actor, portalNotices.classId));
  res.json({ classes, students, teachers, exams, attempts, materials, notices });
});
portalManagementRouter.post("/manage", async (req, res) => {
  const actor = await portalActor(req);
  staffOnly(actor);
  const body = ManagePortalBody.parse(req.body);
  if (["saveClass", "saveStudent", "saveTeacher"].includes(body.action)) check(actor.role === "admin", "Only school administrators can manage enrolments and staff access.", 403);
  if (body.action === "resetAttempt") check(actor.role === "admin", "Only school administrators can reset a student's attempt.", 403);
  switch (body.action) {
    case "saveClass": {
      const data = body.schoolClass;
      check(data && data.name.trim(), "Class name required.");
      if (data.id) {
        const rows = await db.update(portalClasses).set({ name: data.name.trim() }).where(eq(portalClasses.id, data.id)).returning();
        check(rows.length, "Class not found.", 404);
      } else await db.insert(portalClasses).values({ name: data.name.trim() });
      break;
    }
    case "saveStudent": {
      const data = body.student;
      check(data, "Student details required.");
      await validClass(actor, data.classId);
      const studentId = data.studentId.trim().toUpperCase();
      check(/^[A-Z0-9][A-Z0-9/_-]{0,49}$/.test(studentId), "Use letters, numbers, hyphens, slashes or underscores for student IDs.");
      check(data.name.trim(), "Student name required.");
      const guardianEmail = data.guardianEmail === undefined ? undefined : data.guardianEmail?.trim().toLowerCase() || null;
      check(!guardianEmail || validEmail(guardianEmail), "Enter a valid parent email, or leave it empty.");
      if (!data.id) check(data.password, "Give the new student an individual temporary password of at least 10 characters.");
      const passwordHash = data.password ? await hashPassword(data.password) : undefined;
      await db.transaction(async (tx) => {
        if (data.id) {
          const [old] = await tx.select().from(portalStudents).where(eq(portalStudents.id, data.id)).for("update");
          check(old, "Student not found.", 404);
          check(old.studentId === studentId && old.classId === data.classId, "Student ID and class cannot be changed on an existing enrolment.");
          await tx.update(portalStudents).set({
            name: data.name.trim(), active: data.active, ...(guardianEmail !== undefined ? { guardianEmail } : {}),
            ...(passwordHash ? { passwordHash, mustChangePassword: true, failedLogins: 0, lockedUntil: null } : {}),
          }).where(eq(portalStudents.id, data.id));
          if (!data.active || passwordHash) await tx.delete(portalSessions).where(eq(portalSessions.studentId, data.id));
        } else await tx.insert(portalStudents).values({ studentId, name: data.name.trim(), classId: data.classId, active: data.active, passwordHash: passwordHash!, guardianEmail: guardianEmail ?? null });
      });
      break;
    }
    case "saveTeacher": {
      const data = body.teacher;
      check(data && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim()), "A valid teacher email is required.");
      check(data.name.trim(), "Teacher name required.");
      for (const id of data.classIds) await validClass(actor, id);
      const values = { email: data.email.trim().toLowerCase(), name: data.name.trim(), classIds: [...new Set(data.classIds)], active: data.active };
      if (data.id) {
        const rows = await db.update(portalTeachers).set(values).where(eq(portalTeachers.id, data.id)).returning();
        check(rows.length, "Teacher not found.", 404);
      } else await db.insert(portalTeachers).values(values);
      break;
    }
    case "saveExam": {
      const data = body.exam;
      check(data, "Exam details required.");
      await validClass(actor, data.classId);
      check(data.title.trim() && data.subject.trim(), "Exam title and subject required.");
      const startsAt = new Date(data.startsAt), endsAt = new Date(data.endsAt);
      check(Number.isFinite(startsAt.getTime()) && Number.isFinite(endsAt.getTime()) && endsAt > startsAt, "Choose a valid exam opening and closing time.");
      validateQuestions(data.questions, data.published);
      await validFile(data.fileId, data.classId);
      check(data.mode !== "pdf" || data.fileId, "Upload the original PDF for PDF mode.");
      check(!data.resultsReleased, "Save the exam first; release results after marking through the result controls.");
      const { id, ...rest } = data;
      const values = { ...rest, title: data.title.trim(), subject: data.subject.trim(), startsAt, endsAt, fileId: data.fileId || null };
      await db.transaction(async (tx) => {
        if (id) {
          const [old] = await tx.select().from(portalExams).where(eq(portalExams.id, id)).for("update");
          check(old, "Exam not found.", 404);
          classAllowed(actor, old.classId);
          const [attempt] = await tx.select({ id: portalAttempts.id }).from(portalAttempts).where(eq(portalAttempts.examId, id)).limit(1);
          check(!attempt, "Students have started this exam. Its content is locked; use publish and result controls instead.", 409);
          await tx.update(portalExams).set(values).where(eq(portalExams.id, id));
        } else await tx.insert(portalExams).values(values);
      });
      break;
    }
    case "examStatus": {
      const data = body.examStatus;
      check(data, "Exam status required.");
      await db.transaction(async (tx) => {
        const [exam] = await tx.select().from(portalExams).where(eq(portalExams.id, data.id)).for("update");
        check(exam, "Exam not found.", 404);
        classAllowed(actor, exam.classId);
        validateQuestions(exam.questions, data.published);
        if (data.resultsReleased) {
          check(new Date() >= exam.endsAt, "Wait until the exam window closes before releasing results.");
          const [unmarked] = await tx.select({ id: portalAttempts.id }).from(portalAttempts).where(and(eq(portalAttempts.examId, exam.id), sql`${portalAttempts.status} <> 'marked'`)).limit(1);
          check(!unmarked, "All attempts must be submitted and marked before results are released.");
        }
        await tx.update(portalExams).set({ published: data.published, resultsReleased: data.resultsReleased }).where(eq(portalExams.id, exam.id));
      });
      break;
    }
    case "saveMaterial": {
      const data = body.material;
      check(data, "Revision material required.");
      await validClass(actor, data.classId);
      await validFile(data.fileId, data.classId);
      check(data.body.trim() || data.fileId, "Add revision notes or upload a PDF.");
      const { id, ...values } = data;
      if (id) {
        const [old] = await db.select().from(portalMaterials).where(eq(portalMaterials.id, id));
        check(old, "Material not found.", 404); classAllowed(actor, old.classId);
        await db.update(portalMaterials).set({ ...values, fileId: data.fileId || null }).where(eq(portalMaterials.id, id));
      } else await db.insert(portalMaterials).values({ ...values, fileId: data.fileId || null });
      break;
    }
    case "saveNotice": {
      const data = body.notice;
      check(data, "Announcement required.");
      await validClass(actor, data.classId);
      check(data.title.trim() && data.body.trim(), "Announcement title and text required.");
      const { id, ...values } = data;
      if (id) {
        const [old] = await db.select().from(portalNotices).where(eq(portalNotices.id, id));
        check(old, "Announcement not found.", 404); classAllowed(actor, old.classId);
        await db.update(portalNotices).set(values).where(eq(portalNotices.id, id));
      } else await db.insert(portalNotices).values(values);
      break;
    }
    case "grade": {
      const data = body.grade;
      check(data, "Marking details required.");
      await db.transaction(async (tx) => {
        const [lookup] = await tx.select().from(portalAttempts).where(eq(portalAttempts.id, data.attemptId));
        check(lookup, "Attempt not found.", 404);
        // Same exam-first lock order as starts/releases; marks cannot change
        // concurrently with a release becoming visible to students.
        const [exam] = await tx.select().from(portalExams).where(eq(portalExams.id, lookup.examId)).for("update");
        check(exam, "Exam not found.", 404); classAllowed(actor, exam.classId);
        const [attempt] = await tx.select().from(portalAttempts).where(eq(portalAttempts.id, data.attemptId)).for("update");
        check(attempt.status !== "in_progress", "This student is still writing the exam.", 409);
        check(!exam.resultsReleased, "Withhold results before changing marks.", 409);
        const written = attempt.questions.filter((q) => q.type === "written");
        check(new Set(data.marks.map((m) => m.questionId)).size === written.length && data.marks.length === written.length, "Mark every written question exactly once.");
        for (const mark of data.marks) {
          const q = written.find((q) => q.id === mark.questionId);
          check(q && mark.score <= q.marks, "A mark exceeds the question's available marks.");
        }
        await tx.update(portalAttempts).set({ marks: [...automaticMarks(attempt.questions, attempt.answers), ...data.marks], status: "marked" }).where(eq(portalAttempts.id, attempt.id));
      });
      break;
    }
    case "deleteExam": {
      const data = body.target;
      check(data, "Exam required.");
      await db.transaction(async (tx) => {
        const [exam] = await tx.select().from(portalExams).where(eq(portalExams.id, data.id)).for("update");
        check(exam, "Exam not found.", 404);
        classAllowed(actor, exam.classId);
        const [attempt] = await tx.select({ id: portalAttempts.id }).from(portalAttempts).where(eq(portalAttempts.examId, exam.id)).limit(1);
        check(!attempt, "Students have started this exam, so it cannot be deleted. Hide it instead.", 409);
        await tx.delete(portalExams).where(eq(portalExams.id, exam.id));
      });
      break;
    }
    case "deleteMaterial": {
      const data = body.target;
      check(data, "Revision material required.");
      const [old] = await db.select().from(portalMaterials).where(eq(portalMaterials.id, data.id));
      check(old, "Material not found.", 404); classAllowed(actor, old.classId);
      await db.delete(portalMaterials).where(eq(portalMaterials.id, data.id));
      break;
    }
    case "deleteNotice": {
      const data = body.target;
      check(data, "Announcement required.");
      const [old] = await db.select().from(portalNotices).where(eq(portalNotices.id, data.id));
      check(old, "Announcement not found.", 404); classAllowed(actor, old.classId);
      await db.delete(portalNotices).where(eq(portalNotices.id, data.id));
      break;
    }
    case "extendAttempt":
    case "resetAttempt": {
      const data = body.attemptControl;
      check(data, "Attempt required.");
      const extend = body.action === "extendAttempt";
      check(!extend || (Number.isInteger(data.minutes) && data.minutes! >= 1 && data.minutes! <= 240), "Add between 1 and 240 minutes.");
      await db.transaction(async (tx) => {
        const [lookup] = await tx.select().from(portalAttempts).where(eq(portalAttempts.id, data.attemptId));
        check(lookup, "Attempt not found.", 404);
        // Same exam-first lock order as starts, grading and releases.
        const [exam] = await tx.select().from(portalExams).where(eq(portalExams.id, lookup.examId)).for("update");
        check(exam, "Exam not found.", 404); classAllowed(actor, exam.classId);
        const [attempt] = await tx.select().from(portalAttempts).where(eq(portalAttempts.id, data.attemptId)).for("update");
        check(!exam.resultsReleased, "Withhold results before changing attempts.", 409);
        if (extend) {
          check(attempt.status === "in_progress" && attempt.deadline.getTime() > Date.now(), "Only a student who is still writing can be given extra time.", 409);
          // Staff extensions may run past the exam window; they apply to this student only.
          await tx.update(portalAttempts).set({ deadline: new Date(attempt.deadline.getTime() + data.minutes! * 60_000) }).where(eq(portalAttempts.id, attempt.id));
        } else {
          // Removes the attempt so the student can start again while the exam is open.
          await tx.delete(portalAttempts).where(eq(portalAttempts.id, attempt.id));
        }
      });
      break;
    }
  }
  res.json({ message: "Saved successfully." });
});
