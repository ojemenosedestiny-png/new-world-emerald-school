import { Router, type Request } from "express";
import { eq, inArray, sql } from "drizzle-orm";
import { db, feePaymentReportsTable, individualFeeChargesTable, portalClasses, portalStudents } from "@workspace/db";
import { ApplyStudentIdChangeBody, PreviewStudentIdChangeBody } from "@workspace/api-zod";
import { check, portalActor } from "../lib/portal-auth";
import { ADMISSION_NUMBER } from "../lib/accounts";
import { cleanAdmissionNumber, parseIdList, planIdChanges, type PortalStudentForIds } from "../lib/student-ids";
import { clientIp, recordAudit } from "../lib/audit";

/**
 * Moving every student to the school's admission numbers (NW/SEC/26/00001, NW/PRY/26/00001). The office pastes its
 * list; the portal pairs each number with a student by name and shows the plan; the office checks it, picks students
 * for any line that did not pair, and applies it. Students then sign in with the new number. Fee records that were
 * typed with the old number move with the student.
 */
export const portalStudentIdsRouter = Router();
export const MAX_ID_CHANGES = 3_000;

async function office(req: Request) {
  const actor = await portalActor(req);
  check(actor.role === "admin", actor.role === "guest" ? "Sign in as an administrator." : "Only the school office can change student IDs.", actor.role === "guest" ? 401 : 403);
  return req.identity?.email ?? actor.name;
}

async function allStudents(): Promise<PortalStudentForIds[]> {
  return db.select({ id: portalStudents.id, studentId: portalStudents.studentId, name: portalStudents.name, className: portalClasses.name, active: portalStudents.active })
    .from(portalStudents).innerJoin(portalClasses, eq(portalClasses.id, portalStudents.classId));
}

portalStudentIdsRouter.post("/student-ids/preview", async (req, res) => {
  await office(req);
  const { text } = PreviewStudentIdChangeBody.parse(req.body);
  const rows = parseIdList(text);
  check(rows.length, "No admission numbers found. Paste lines like: NW/SEC/26/00001 Abdulkarim Salami");
  check(rows.length <= MAX_ID_CHANGES, `Up to ${MAX_ID_CHANGES} students at a time.`);
  const students = await allStudents();
  const plan = planIdChanges(rows, students);
  const covered = new Set(plan.filter((p) => p.student).map((p) => p.student!.id));
  const notInList = students.filter((s) => s.active && !covered.has(s.id)).sort((a, b) => a.className.localeCompare(b.className) || a.name.localeCompare(b.name));
  res.json({ rows: plan, notInList });
});

// Fee rows keep the student ID as typed, compared without spaces and in capitals (as the fee pages do).
const typedAs = (column: typeof individualFeeChargesTable.studentIdentifier | typeof feePaymentReportsTable.studentIdentifier, studentId: string) =>
  sql`upper(regexp_replace(${column}, '\\s', '', 'g')) = ${studentId.trim().toUpperCase().replace(/\s+/g, "")}`;

portalStudentIdsRouter.post("/student-ids/apply", async (req, res) => {
  const by = await office(req);
  const body = ApplyStudentIdChangeBody.parse(req.body);
  const wanted = body.changes.map((c) => ({ id: c.id, newId: cleanAdmissionNumber(c.newId) }));
  check(wanted.length, "Nothing to change.");
  const bad = wanted.find((c) => !ADMISSION_NUMBER.test(c.newId));
  check(!bad, `"${bad?.newId}" is not an admission number like NW/SEC/26/00001.`);
  check(new Set(wanted.map((c) => c.id)).size === wanted.length, "A student appears twice in the changes.");
  check(new Set(wanted.map((c) => c.newId)).size === wanted.length, "An admission number appears twice in the changes.");

  const changed = await db.transaction(async (tx) => {
    const rows = await tx.select({ id: portalStudents.id, studentId: portalStudents.studentId, name: portalStudents.name }).from(portalStudents)
      .where(inArray(portalStudents.id, wanted.map((c) => c.id))).for("update");
    const byId = new Map(rows.map((r) => [r.id, r]));
    const missing = wanted.find((c) => !byId.has(c.id));
    check(!missing, "One of these students no longer exists. Check the list again.", 404);
    const moves = wanted.filter((c) => byId.get(c.id)!.studentId !== c.newId);
    if (!moves.length) return [];
    // Another student (not being changed now) already has one of the new numbers.
    const holders = await tx.select({ id: portalStudents.id, studentId: portalStudents.studentId, name: portalStudents.name }).from(portalStudents)
      .where(inArray(portalStudents.studentId, moves.map((c) => c.newId)));
    const clash = holders.find((h) => !byId.has(h.id));
    check(!clash, `${clash?.studentId} already belongs to ${clash?.name}. Change theirs first, or check the list.`, 409);
    // Two steps, so students can swap numbers without bumping into each other.
    for (const c of moves) await tx.update(portalStudents).set({ studentId: `MOVING-${c.id}` }).where(eq(portalStudents.id, c.id));
    for (const c of moves) {
      const old = byId.get(c.id)!.studentId;
      await tx.update(portalStudents).set({ studentId: c.newId }).where(eq(portalStudents.id, c.id));
      await tx.update(individualFeeChargesTable).set({ studentIdentifier: c.newId }).where(typedAs(individualFeeChargesTable.studentIdentifier, old));
      await tx.update(feePaymentReportsTable).set({ studentIdentifier: c.newId }).where(typedAs(feePaymentReportsTable.studentIdentifier, old));
    }
    return moves.map((c) => ({ name: byId.get(c.id)!.name, from: byId.get(c.id)!.studentId, to: c.newId }));
  });

  await recordAudit({
    actorKind: "staff", actorId: req.dbUser?.id ?? null, actorLabel: by, action: "students.ids_changed", targetType: "students", targetId: String(changed.length),
    after: { changes: changed.map((c) => ({ from: c.from, to: c.to })) }, ip: clientIp(req), userAgent: req.headers["user-agent"] ?? null,
  });
  res.json({
    changed: changed.length,
    message: changed.length ? `${changed.length} ${changed.length === 1 ? "student now signs" : "students now sign"} in with the new admission number.` : "Everyone already has these numbers.",
  });
});
