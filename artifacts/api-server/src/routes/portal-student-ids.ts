import { Router, type Request } from "express";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db, examRegistrations, feePaymentReportsTable, individualFeeChargesTable, parentPayments, portalAttempts, portalAttendance, portalClasses,
  portalHostelAllocations, portalMessages, portalReportCards, portalScores, portalSessions, portalStudents, portalSubmissions,
  portalTransportAssignments, studentProfiles, tapCards, tapEvents,
} from "@workspace/db";
import { ApplyOldStudentIdCleanupBody, ApplyStudentIdChangeBody, PreviewStudentIdChangeBody } from "@workspace/api-zod";
import { check, portalActor } from "../lib/portal-auth";
import { ADMISSION_NUMBER } from "../lib/accounts";
import { cleanAdmissionNumber, nameWords, parseIdList, planIdChanges, type PortalStudentForIds } from "../lib/student-ids";
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

// ---- Old IDs: after the office enrolled everyone again with admission numbers, each student may have an old record
// (results, attendance, CBT, history) and a new, empty one (the new ID and password). Joining them keeps everything.

type StudentRow = typeof portalStudents.$inferSelect;
/** Where a student has records, by table, as words the office understands. Rows that sign-in creates are not counted. */
async function recordsOf(ids: number[], exec: Pick<typeof db, "select" | "selectDistinct"> = db): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>(ids.map((id) => [id, []]));
  if (!ids.length) return out;
  const add = (rows: { id: number | null }[], label: string) => { for (const r of new Set(rows.map((x) => x.id))) if (r !== null && out.has(r)) out.get(r)!.push(label); };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const by = (table: any, col: any) => exec.selectDistinct({ id: col }).from(table).where(inArray(col, ids)) as unknown as Promise<{ id: number | null }[]>;
  const [scores, cards, attempts, regs, attendance, subs, messages, profiles, taps, hostel, bus, fees, payments] = await Promise.all([
    by(portalScores, portalScores.studentId), by(portalReportCards, portalReportCards.studentId), by(portalAttempts, portalAttempts.studentId),
    by(examRegistrations, examRegistrations.studentId), by(portalAttendance, portalAttendance.studentId), by(portalSubmissions, portalSubmissions.studentId),
    by(portalMessages, portalMessages.studentId), by(studentProfiles, studentProfiles.studentId), by(tapCards, tapCards.studentId),
    by(portalHostelAllocations, portalHostelAllocations.studentId), by(portalTransportAssignments, portalTransportAssignments.studentId),
    exec.selectDistinct({ id: feePaymentReportsTable.studentPortalId }).from(feePaymentReportsTable).where(inArray(feePaymentReportsTable.studentPortalId, ids)),
    exec.select({ selection: parentPayments.selection }).from(parentPayments).where(sql`${parentPayments.selection} @> any(array[${sql.join(ids.map((id) => sql`${JSON.stringify([{ studentId: id }])}::jsonb`), sql`, `)}])`),
  ]);
  add(scores, "results"); add(cards, "report card remarks"); add(attempts, "CBT exams");
  add(regs, "WAEC/NECO form"); add(attendance, "attendance"); add(subs, "assignments");
  add(messages, "messages"); add(profiles, "profile details"); add(taps, "tap-in card");
  add(hostel, "hostel"); add(bus, "school bus"); add(fees, "fee payments");
  add(payments.flatMap((p) => p.selection.map((s) => ({ id: s.studentId }))), "card payments");
  return out;
}

const view = (s: StudentRow, className: Map<number, string>) => ({ id: s.id, studentId: s.studentId, name: s.name, className: className.get(s.classId) ?? "", active: s.active });

/** Old-style IDs (anything not NW/SEC|PRY/..), each paired with the new record of the same name when there is exactly one. */
async function oldIdPlan() {
  const [students, classes] = await Promise.all([db.select().from(portalStudents), db.select({ id: portalClasses.id, name: portalClasses.name }).from(portalClasses)]);
  const className = new Map(classes.map((c) => [c.id, c.name]));
  const key = (s: StudentRow) => nameWords(s.name).join(" ");
  const fresh = students.filter((s) => ADMISSION_NUMBER.test(s.studentId));
  const old = students.filter((s) => !ADMISSION_NUMBER.test(s.studentId));
  const freshByName = new Map<string, StudentRow[]>();
  for (const s of fresh) freshByName.set(key(s), [...(freshByName.get(key(s)) ?? []), s]);
  const records = await recordsOf(students.map((s) => s.id));
  const pairs: { old: ReturnType<typeof view>; new: ReturnType<typeof view>; oldRecords: string[]; newRecords: string[]; status: "ready" | "new_has_records" | "ambiguous" }[] = [];
  const unpaired: { student: ReturnType<typeof view>; records: string[]; note: string }[] = [];
  // A close name: one contains the other (a middle name missing), at least two words alike, and only one fits.
  const close = (s: StudentRow) => {
    const want = nameWords(s.name).filter((w) => w.length > 1);
    if (want.length < 2) return [];
    return fresh.filter((f) => {
      const have = nameWords(f.name).filter((w) => w.length > 1);
      const shared = want.filter((w) => have.includes(w)).length;
      return shared >= 2 && (shared === want.length || shared === have.length);
    });
  };
  // Each old record's new one: the same name, else one close name. A new record wanted by two old ones needs a person.
  const target = new Map<number, StudentRow[]>(old.map((s) => {
    const exact = freshByName.get(key(s)) ?? [];
    return [s.id, exact.length ? exact : close(s)];
  }));
  const wanted = new Map<number, number>();
  for (const t of target.values()) if (t.length === 1) wanted.set(t[0].id, (wanted.get(t[0].id) ?? 0) + 1);
  for (const s of old) {
    const matches = target.get(s.id)!;
    if (matches.length === 1) {
      const n = matches[0];
      const newRecords = records.get(n.id) ?? [];
      pairs.push({ old: view(s, className), new: view(n, className), oldRecords: records.get(s.id) ?? [], newRecords,
        status: (wanted.get(n.id) ?? 0) > 1 ? "ambiguous" : newRecords.length ? "new_has_records" : "ready" });
    } else {
      unpaired.push({ student: view(s, className), records: records.get(s.id) ?? [], note: matches.length > 1 ? "More than one new record has a similar name." : "No new record with this name." });
    }
  }
  pairs.sort((a, b) => a.new.className.localeCompare(b.new.className) || a.old.name.localeCompare(b.old.name));
  // New records the office may pick by hand for an old one: an admission number, nothing in them yet, not already paired.
  const paired = new Set(pairs.map((p) => p.new.id));
  const newOptions = fresh.filter((f) => !paired.has(f.id) && !(records.get(f.id) ?? []).length).map((f) => view(f, className))
    .sort((a, b) => a.name.localeCompare(b.name));
  unpaired.sort((a, b) => a.student.className.localeCompare(b.student.className) || a.student.name.localeCompare(b.student.name));
  return { pairs, unpaired, newOptions };
}

portalStudentIdsRouter.post("/student-ids/old/preview", async (req, res) => {
  await office(req);
  res.json(await oldIdPlan());
});

portalStudentIdsRouter.post("/student-ids/old/apply", async (req, res) => {
  const by = await office(req);
  const body = ApplyOldStudentIdCleanupBody.parse(req.body);
  const purge = body.purge ?? [];
  check(body.join.length || body.remove.length || purge.length, "Choose what to tidy up.");
  const used = [...body.join.flatMap((j) => [j.oldId, j.newId]), ...body.remove, ...purge];
  check(new Set(used).size === used.length, "A student appears twice. Check the choices again.");

  const joined: { name: string; from: string; to: string }[] = [];
  const removed: { name: string; studentId: string }[] = [];
  const purged: { name: string; studentId: string; records: string[] }[] = [];
  await db.transaction(async (tx) => {
    for (const j of body.join) {
      const [o] = await tx.select().from(portalStudents).where(eq(portalStudents.id, j.oldId)).for("update");
      const [n] = await tx.select().from(portalStudents).where(eq(portalStudents.id, j.newId)).for("update");
      check(o && n, "A student no longer exists. Check again.", 409);
      check(!ADMISSION_NUMBER.test(o.studentId), `${o.name} already has an admission number.`, 409);
      check(ADMISSION_NUMBER.test(n.studentId), `${n.name}'s new record has no admission number.`, 409);
      check(!(await recordsOf([n.id], tx)).get(n.id)!.length, `${n.name}'s new record has records now. Check again.`, 409);
      // The old record keeps every result and record, and takes the new ID, password, class and sign-in state.
      await tx.update(portalStudents).set({ studentId: `REMOVING-${n.id}` }).where(eq(portalStudents.id, n.id));
      await tx.update(portalStudents).set({
        studentId: n.studentId, name: n.name, classId: n.classId, passwordHash: n.passwordHash, mustChangePassword: n.mustChangePassword,
        accountStatus: n.accountStatus, activatedAt: n.activatedAt ?? o.activatedAt, active: n.active, failedLogins: 0, lockedUntil: null,
        guardianEmail: o.guardianEmail ?? n.guardianEmail, secondGuardianEmail: o.secondGuardianEmail ?? n.secondGuardianEmail,
        photoImageId: o.photoImageId ?? n.photoImageId, pendingPhotoImageId: o.pendingPhotoImageId ?? n.pendingPhotoImageId,
      }).where(eq(portalStudents.id, o.id));
      // The password changed: anyone signed in with the old one signs in again.
      await tx.delete(portalSessions).where(eq(portalSessions.studentId, o.id));
      await tx.update(individualFeeChargesTable).set({ studentIdentifier: n.studentId }).where(typedAs(individualFeeChargesTable.studentIdentifier, o.studentId));
      await tx.update(feePaymentReportsTable).set({ studentIdentifier: n.studentId }).where(typedAs(feePaymentReportsTable.studentIdentifier, o.studentId));
      await tx.update(tapEvents).set({ studentId: o.id }).where(eq(tapEvents.studentId, n.id));
      await tx.delete(portalStudents).where(eq(portalStudents.id, n.id));
      joined.push({ name: n.name, from: o.studentId, to: n.studentId });
    }
    for (const id of body.remove) {
      const [s] = await tx.select().from(portalStudents).where(eq(portalStudents.id, id)).for("update");
      if (!s) continue;
      check(!ADMISSION_NUMBER.test(s.studentId), `${s.name} has an admission number, so they are not an old record.`, 409);
      check(!(await recordsOf([s.id], tx)).get(s.id)!.length, `${s.name} has records now, so they cannot be removed. Check again.`, 409);
      await tx.delete(portalStudents).where(eq(portalStudents.id, s.id));
      removed.push({ name: s.name, studentId: s.studentId });
    }
    // Removed with everything recorded under the old ID (the office chose this, knowing it deletes those records).
    for (const id of purge) {
      const [s] = await tx.select().from(portalStudents).where(eq(portalStudents.id, id)).for("update");
      if (!s) continue;
      check(!ADMISSION_NUMBER.test(s.studentId), `${s.name} has an admission number, so they are not an old record.`, 409);
      const records = (await recordsOf([s.id], tx)).get(s.id)!;
      await tx.delete(portalScores).where(eq(portalScores.studentId, s.id));
      await tx.delete(portalReportCards).where(eq(portalReportCards.studentId, s.id));
      await tx.delete(portalAttempts).where(eq(portalAttempts.studentId, s.id));
      await tx.delete(examRegistrations).where(eq(examRegistrations.studentId, s.id));
      // Everything else (attendance, profile, messages, sessions, cards...) goes with the student.
      await tx.delete(portalStudents).where(eq(portalStudents.id, s.id));
      purged.push({ name: s.name, studentId: s.studentId, records });
    }
  });
  await recordAudit({
    actorKind: "staff", actorId: req.dbUser?.id ?? null, actorLabel: by, action: "students.old_ids_removed", targetType: "students", targetId: String(joined.length + removed.length + purged.length),
    after: { joined: joined.map((j) => ({ from: j.from, to: j.to })), removed: removed.map((r) => r.studentId), removedWithRecords: purged.map((r) => ({ studentId: r.studentId, name: r.name, records: r.records })) }, ip: clientIp(req), userAgent: req.headers["user-agent"] ?? null,
  });
  const parts = [joined.length ? `${joined.length} old ${joined.length === 1 ? "record" : "records"} joined to the new ID (results and history kept)` : "", removed.length ? `${removed.length} empty old ${removed.length === 1 ? "record" : "records"} removed` : "", purged.length ? `${purged.length} old ${purged.length === 1 ? "record" : "records"} removed with ${purged.length === 1 ? "its" : "their"} records` : ""].filter(Boolean);
  res.json({ joined: joined.length, removed: removed.length + purged.length, message: parts.join("; ") + "." });
});
