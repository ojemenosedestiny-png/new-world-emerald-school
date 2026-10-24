import { Router, type Request } from "express";
import { eq, sql } from "drizzle-orm";
import { classFeeSchedulesTable, db, feePaymentReportsTable, individualFeeChargesTable, portalClasses, portalStudents } from "@workspace/db";
import { check, portalActor, studentOnly } from "../lib/portal-auth";
import { feeStatement } from "../lib/fees";

export const portalFeesRouter = Router();

// Fee rows store the student ID as typed by the office or a parent, so compare it the same way the fee forms do.
const sameId = (column: typeof individualFeeChargesTable.studentIdentifier | typeof feePaymentReportsTable.studentIdentifier, studentId: string) =>
  sql`upper(regexp_replace(${column}, '\\s', '', 'g')) = ${studentId.trim().toUpperCase().replace(/\s+/g, "")}`;

async function statementFor(student: { id: number; name: string; studentId: string; classId: number }) {
  const [cls] = await db.select({ name: portalClasses.name }).from(portalClasses).where(eq(portalClasses.id, student.classId));
  const className = cls?.name ?? "";
  const [schedules, charges, reports] = await Promise.all([
    db.select().from(classFeeSchedulesTable).where(eq(classFeeSchedulesTable.isActive, true)),
    db.select().from(individualFeeChargesTable).where(sameId(individualFeeChargesTable.studentIdentifier, student.studentId)),
    db.select().from(feePaymentReportsTable).where(sameId(feePaymentReportsTable.studentIdentifier, student.studentId)),
  ]);
  return { studentName: student.name, studentId: student.studentId, className, ...feeStatement(className, schedules, charges, reports) };
}

portalFeesRouter.get("/my-fees", async (req, res) => {
  const actor = await portalActor(req);
  studentOnly(actor);
  res.json(await statementFor(actor.student!));
});

async function adminOnly(req: Request) {
  const actor = await portalActor(req);
  check(actor.role === "admin", actor.role === "guest" ? "Sign in as an administrator." : "Only the school office can see fee statements.", actor.role === "guest" ? 401 : 403);
}

portalFeesRouter.get("/students/:id/fees", async (req, res) => {
  await adminOnly(req);
  const id = Number(req.params.id);
  check(Number.isSafeInteger(id) && id > 0, "Student not found.", 404);
  const [student] = await db.select().from(portalStudents).where(eq(portalStudents.id, id));
  check(student, "Student not found.", 404);
  res.json(await statementFor(student));
});
