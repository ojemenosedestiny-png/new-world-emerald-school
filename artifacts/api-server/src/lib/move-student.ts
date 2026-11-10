import type { Request } from "express";
import { eq } from "drizzle-orm";
import { db, portalClasses, portalStudents } from "@workspace/db";
import { check } from "./portal-auth";
import { recordAudit, clientIp } from "./audit";

/**
 * Moves a student to another class (for example Year 11 Amber to Year 11 Jade). Their sign-in, earlier exam attempts
 * and saved results stay with them; from now on they see the new class's exams, notes and timetable.
 * `allowed` decides whether this staff member may move between these two classes.
 */
export async function moveStudent(req: Request, studentId: number, toClassId: number, by: string, allowed: (from: string, to: string) => boolean) {
  const [student] = await db.select().from(portalStudents).where(eq(portalStudents.id, studentId));
  check(student, "Student not found.", 404);
  const [[from], [to]] = await Promise.all([
    db.select().from(portalClasses).where(eq(portalClasses.id, student.classId)),
    db.select().from(portalClasses).where(eq(portalClasses.id, toClassId)),
  ]);
  check(to, "Class not found.", 404);
  check(student.classId !== to.id, `${student.name} is already in ${to.name}.`, 409);
  check(allowed(from?.name ?? "", to.name), `You cannot move students between ${from?.name ?? "that class"} and ${to.name}.`, 403);
  await db.update(portalStudents).set({ classId: to.id }).where(eq(portalStudents.id, student.id));
  await recordAudit({ actorKind: "staff", actorId: req.dbUser?.id ?? null, actorLabel: by, action: "student.moved", targetType: "student", targetId: student.studentId, before: { classId: student.classId, className: from?.name ?? "" }, after: { classId: to.id, className: to.name }, ip: clientIp(req), userAgent: req.headers["user-agent"] ?? null });
  return `${student.name} moved from ${from?.name ?? "their class"} to ${to.name}.`;
}
