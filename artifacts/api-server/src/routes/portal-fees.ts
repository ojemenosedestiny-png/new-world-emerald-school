import { Router, type Request } from "express";
import { and, eq, sql } from "drizzle-orm";
import { classFeeSchedulesTable, db, feePaymentReportsTable, individualFeeChargesTable, parentPayments, portalClasses, portalStudents } from "@workspace/db";
import { check, portalActor, studentOnly } from "../lib/portal-auth";
import { feeStatement } from "../lib/fees";

export const portalFeesRouter = Router();

/** The database, or an open transaction (settling a payment reads statements inside its transaction). */
export type DbExec = Pick<typeof db, "select">;

// Fee rows store the student ID as typed by the office or a parent, so compare it the same way the fee forms do.
const sameId = (column: typeof individualFeeChargesTable.studentIdentifier | typeof feePaymentReportsTable.studentIdentifier, studentId: string) =>
  sql`upper(regexp_replace(${column}, '\\s', '', 'g')) = ${studentId.trim().toUpperCase().replace(/\s+/g, "")}`;

/** A student's fee statement, counting bank-transfer reports and online (Paystack and wallet) payments. */
export async function statementFor(student: { id: number; name: string; studentId: string; classId: number }, exec: DbExec = db) {
  const [cls] = await exec.select({ name: portalClasses.name }).from(portalClasses).where(eq(portalClasses.id, student.classId));
  const className = cls?.name ?? "";
  const [schedules, charges, reports, online] = await Promise.all([
    exec.select().from(classFeeSchedulesTable).where(eq(classFeeSchedulesTable.isActive, true)),
    exec.select().from(individualFeeChargesTable).where(sameId(individualFeeChargesTable.studentIdentifier, student.studentId)),
    exec.select().from(feePaymentReportsTable).where(sameId(feePaymentReportsTable.studentIdentifier, student.studentId)),
    exec.select({ reference: parentPayments.reference, allocations: parentPayments.allocations, settledAt: parentPayments.settledAt, createdAt: parentPayments.createdAt })
      .from(parentPayments)
      .where(and(eq(parentPayments.status, "success"), sql`${parentPayments.allocations} @> ${JSON.stringify([{ studentId: student.id }])}::jsonb`)),
  ]);
  const mine = online.map((p) => ({ ...p, lines: p.allocations.filter((a) => a.studentId === student.id) }));
  const credits = mine.flatMap((p) => p.lines.map((a) => ({ itemKey: a.itemKey, amountKobo: a.amountKobo })));
  const payments = mine.map((p) => ({ reference: p.reference, amountKobo: p.lines.reduce((n, a) => n + a.amountKobo, 0), createdAt: p.settledAt ?? p.createdAt }));
  return { studentName: student.name, studentId: student.studentId, className, ...feeStatement(className, schedules, charges, reports, credits, payments) };
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
