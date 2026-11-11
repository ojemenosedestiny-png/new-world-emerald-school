import { Router, type Request } from "express";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, portalAuditLog, portalClasses, portalSessions, portalStudents, portalSubjects, portalTeacherPresence, portalTeachers } from "@workspace/db";
import { ManagePrincipalBody, GetPrincipalActivityQueryParams, GetPrincipalOverviewQueryParams } from "@workspace/api-zod";
import { check } from "../lib/portal-auth";
import { isPrincipal } from "../lib/website-admin";
import { moveStudent } from "../lib/move-student";
import { validEmail } from "../lib/accounts";
import { emailTypoFix } from "../lib/email-typos";
import { recordAudit, clientIp } from "../lib/audit";
import { cleanSubjectName, fixMessage, fixSubject } from "../lib/subject-fix";
import { classSection, describeActivity, lagosDay, lagosToday, type ActivityKind, type SchoolSection } from "../lib/principal";

export const portalPrincipalRouter = Router();

// Two principals share these routes: secondary (JSS 1 to SS 3, the default) and primary (Year 1 to Year 6).
export function principalOnly(req: Request, section: SchoolSection) {
  check(req.dbUser, "Sign in with the principal's email.", 401);
  check(isPrincipal(req, section), `This page is for the ${section} school principal only.`, 403);
}

/**
 * A section's classes, and its teachers: anyone who is a class or subject teacher there, or not yet
 * assigned anywhere (so either principal can take them on).
 */
export async function sectionStaff(section: SchoolSection) {
  const [allClasses, teachers, allSubjects] = await Promise.all([
    db.select().from(portalClasses).orderBy(asc(portalClasses.name)),
    db.select().from(portalTeachers).where(eq(portalTeachers.active, true)).orderBy(asc(portalTeachers.name)),
    db.select().from(portalSubjects).orderBy(asc(portalSubjects.sortOrder), asc(portalSubjects.name)),
  ]);
  const classes = allClasses.filter((c) => classSection(c.name) === section);
  const ids = new Set(classes.map((c) => c.id));
  const subjects = allSubjects.filter((s) => ids.has(s.classId));
  // A new teacher with no class or subject anywhere yet: either principal may take them on.
  const unassigned = (t: typeof teachers[number]) => !t.classIds.length && !allSubjects.some((s) => s.teacherId === t.id);
  const inSection = (t: typeof teachers[number]) => t.classIds.some((id) => ids.has(id)) || subjects.some((s) => s.teacherId === t.id) || unassigned(t);
  return { classes, teachers, subjects, inSection, unassigned };
}

/** The section's classes with their class teachers and subject teachers, and every active teacher with their classes. */
portalPrincipalRouter.get("/principal", async (req, res) => {
  const section = GetPrincipalOverviewQueryParams.parse(req.query).section ?? "secondary";
  principalOnly(req, section);
  const [{ classes, teachers, subjects, inSection, unassigned }, counts, everyone] = await Promise.all([
    sectionStaff(section),
    db.select({ classId: portalStudents.classId, n: sql<number>`count(*)::int` }).from(portalStudents).where(eq(portalStudents.active, true)).groupBy(portalStudents.classId),
    db.select({ id: portalStudents.id, name: portalStudents.name, studentId: portalStudents.studentId, classId: portalStudents.classId, active: portalStudents.active,
      guardianEmail: portalStudents.guardianEmail, secondGuardianEmail: portalStudents.secondGuardianEmail, photoImageId: portalStudents.photoImageId })
      .from(portalStudents).orderBy(asc(portalStudents.name)),
  ]);
  const sectionIds = new Set(classes.map((c) => c.id));
  const studentCount = new Map(counts.map((c) => [c.classId, c.n]));
  const teacherName = new Map(teachers.map((t) => [t.id, t.name]));
  res.json({
    today: lagosToday(),
    classes: classes.map((c) => ({
      id: c.id, name: c.name, students: studentCount.get(c.id) ?? 0,
      teachers: teachers.filter((t) => t.classIds.includes(c.id)).map((t) => ({ id: t.id, name: t.name })),
      subjects: subjects.filter((s) => s.classId === c.id).map((s) => ({ id: s.id, name: s.name, teacherId: s.teacherId, teacherName: s.teacherId === null ? null : teacherName.get(s.teacherId) ?? null })),
    })),
    // Only this school's teachers (and new ones not yet in any class): never the other school's.
    teachers: teachers.filter(inSection).map((t) => ({ id: t.id, name: t.name, email: t.email, classIds: t.classIds, photoFileId: t.photoFileId ?? null, subjectCount: subjects.filter((s) => s.teacherId === t.id).length, inSection: true, unassigned: unassigned(t) })),
    students: everyone.filter((s) => sectionIds.has(s.classId)),
  });
});

async function activeTeacher(id: number | null | undefined, section: SchoolSection) {
  check(id, "Choose a teacher.");
  const [t] = await db.select().from(portalTeachers).where(eq(portalTeachers.id, id));
  check(t && t.active, "That teacher is not active.", 404);
  // Each principal works with their own school's teachers (or a new one not yet in any class).
  const staff = await sectionStaff(section);
  check(staff.inSection(t), `${t.name} teaches in the other school. Ask the school office to add them to your school.`, 403);
  return t;
}

/** Assign, replace or remove a class teacher, or set a subject's teacher. Each change is in the audit log. */
portalPrincipalRouter.post("/principal", async (req, res) => {
  check(req.dbUser, "Sign in with the principal's email.", 401);
  const body = ManagePrincipalBody.parse(req.body);
  const [cls] = await db.select().from(portalClasses).where(eq(portalClasses.id, body.classId));
  check(cls, "Class not found.", 404);
  // Each principal changes only their own section's classes.
  const section = classSection(cls.name);
  check(section && isPrincipal(req, section), `${cls.name} is not one of your classes.`, 403);
  let message = "Saved.";
  switch (body.action) {
    case "editStudent": {
      // The principal corrects a student in their own school: name, parent emails, and whether they can sign in.
      check(body.studentId, "Choose a student.");
      const [st] = await db.select().from(portalStudents).where(eq(portalStudents.id, body.studentId));
      check(st, "Student not found.", 404);
      check(st.classId === cls.id, "That student is not in this class.", 409);
      const name = (body.studentName ?? st.name).trim().replace(/\s+/g, " ");
      check(name.length >= 2 && name.length <= 150, "Type the student's full name.");
      const email = (v: string | null | undefined, old: string | null) => {
        if (v === undefined) return old;
        const e = (v ?? "").trim().toLowerCase();
        if (!e) return null;
        check(validEmail(e), `"${e}" is not a valid email address.`);
        const typo = emailTypoFix(e);
        check(!typo, `"${e}" looks mistyped. Did you mean ${typo}?`);
        return e;
      };
      const guardianEmail = email(body.guardianEmail, st.guardianEmail);
      const secondGuardianEmail = email(body.secondGuardianEmail, st.secondGuardianEmail);
      check(!guardianEmail || guardianEmail !== secondGuardianEmail, "The two parent emails are the same.");
      const active = body.active ?? st.active;
      await db.update(portalStudents).set({ name, guardianEmail, secondGuardianEmail, active }).where(eq(portalStudents.id, st.id));
      if (!active && st.active) await db.delete(portalSessions).where(eq(portalSessions.studentId, st.id));
      await recordAudit({ actorKind: "staff", actorId: req.dbUser?.id ?? null, actorLabel: req.identity?.email ?? "principal", action: "principal.student_edited", targetType: "student", targetId: st.studentId,
        before: { name: st.name, active: st.active }, after: { name, active, parentEmailsChanged: guardianEmail !== st.guardianEmail || secondGuardianEmail !== st.secondGuardianEmail }, ip: clientIp(req), userAgent: req.headers["user-agent"] ?? null });
      message = `${name}'s details are saved.${!active && st.active ? " They can no longer sign in." : ""}`;
      break;
    }
    case "renameSubject":
    case "removeSubject": {
      // Across every class of the principal's school, so a misspelling made in many arms is fixed at once.
      const oldName = cleanSubjectName(body.subjectName);
      check(oldName, "Choose the subject to fix.");
      const newName = body.action === "renameSubject" ? cleanSubjectName(body.newSubjectName) : null;
      if (body.action === "renameSubject") {
        check(newName, "Type the correct subject name (letters, numbers and simple punctuation, up to 80 characters).");
        check(newName !== oldName, "The new name is the same as the old one.");
      }
      const ids = (await sectionStaff(section!)).classes.map((c) => c.id);
      message = fixMessage(await fixSubject(ids, oldName, newName), oldName, newName);
      break;
    }
    case "moveStudent": {
      // Within the principal's own school only: both classes must be in their section.
      check(body.studentId, "Choose a student.");
      message = await moveStudent(req, body.studentId, cls.id, req.identity?.email ?? "principal", (from) => classSection(from) === section);
      break;
    }
    case "assign": {
      const t = await activeTeacher(body.teacherId, section!);
      check(!t.classIds.includes(cls.id), `${t.name} already teaches ${cls.name}.`, 409);
      await db.update(portalTeachers).set({ classIds: [...t.classIds, cls.id] }).where(eq(portalTeachers.id, t.id));
      message = `${t.name} is now a class teacher for ${cls.name}.`;
      break;
    }
    case "remove": {
      const t = await activeTeacher(body.teacherId, section!);
      check(t.classIds.includes(cls.id), `${t.name} does not teach ${cls.name}.`, 404);
      await db.update(portalTeachers).set({ classIds: t.classIds.filter((id) => id !== cls.id) }).where(eq(portalTeachers.id, t.id));
      message = `${t.name} no longer teaches ${cls.name}.`;
      break;
    }
    case "replace": {
      const out = await activeTeacher(body.teacherId, section!);
      const into = await activeTeacher(body.newTeacherId, section!);
      check(out.id !== into.id, "Choose a different teacher.");
      check(out.classIds.includes(cls.id), `${out.name} does not teach ${cls.name}.`, 404);
      // The class's subjects taught by the outgoing teacher move to the new one too.
      const moved = await db.transaction(async (tx) => {
        await tx.update(portalTeachers).set({ classIds: out.classIds.filter((id) => id !== cls.id) }).where(eq(portalTeachers.id, out.id));
        if (!into.classIds.includes(cls.id)) await tx.update(portalTeachers).set({ classIds: [...into.classIds, cls.id] }).where(eq(portalTeachers.id, into.id));
        return tx.update(portalSubjects).set({ teacherId: into.id }).where(and(eq(portalSubjects.classId, cls.id), eq(portalSubjects.teacherId, out.id))).returning({ id: portalSubjects.id });
      });
      message = `${into.name} has replaced ${out.name} in ${cls.name}${moved.length ? `, including ${moved.length} ${moved.length === 1 ? "subject" : "subjects"}` : ""}.`;
      break;
    }
    case "setSubjectTeacher": {
      check(body.subjectId, "Choose a subject.");
      const [subject] = await db.select().from(portalSubjects).where(eq(portalSubjects.id, body.subjectId));
      check(subject && subject.classId === cls.id, "That subject is not in this class.", 404);
      if (body.teacherId === null || body.teacherId === undefined) {
        await db.update(portalSubjects).set({ teacherId: null }).where(eq(portalSubjects.id, subject.id));
        message = `${subject.name} in ${cls.name} has no subject teacher now.`;
      } else {
        const t = await activeTeacher(body.teacherId, section!);
        await db.update(portalSubjects).set({ teacherId: t.id }).where(eq(portalSubjects.id, subject.id));
        message = `${t.name} now teaches ${subject.name} in ${cls.name}.`;
      }
      break;
    }
    case "setGroupSubjectTeacher": {
      // One subject's teacher across every arm of a year group (Year 11 Amber, Jade, Chrysolite...).
      const ids = [...new Set([cls.id, ...(body.classIds ?? [])])];
      check(ids.length <= 20, "Choose at most 20 classes.");
      const name = (body.subjectName ?? "").trim().replace(/\s+/g, " ");
      check(name, "Type or choose a subject.");
      check(name.length <= 80 && /^[\p{L}\p{N}][\p{L}\p{N} &()'.,/+-]*$/u.test(name), "Use letters, numbers and simple punctuation for the subject name, up to 80 characters.");
      const rows = await db.select({ id: portalClasses.id, name: portalClasses.name }).from(portalClasses).where(inArray(portalClasses.id, ids));
      check(rows.length === ids.length, "Class not found.", 404);
      check(rows.every((r) => classSection(r.name) === section), "Every class must be in your school.", 403);
      const t = body.teacherId === null || body.teacherId === undefined ? null : await activeTeacher(body.teacherId, section!);
      const same = sql`lower(trim(${portalSubjects.name})) = ${name.toLowerCase()}`;
      const added = await db.transaction(async (tx) => {
        let added: string[] = [];
        if (body.addMissing) {
          // Every class should match: classes without the subject get it, named as the others have it, or as the
          // principal typed it when it is a new subject.
          const existing = await tx.select({ classId: portalSubjects.classId, name: portalSubjects.name }).from(portalSubjects).where(and(inArray(portalSubjects.classId, ids), same));
          const subjectName = existing[0]?.name.trim() ?? name;
          const missing = rows.filter((r) => !existing.some((e) => e.classId === r.id));
          for (const r of missing) {
            const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${portalSubjects.sortOrder}), -1)::int + 1` }).from(portalSubjects).where(eq(portalSubjects.classId, r.id));
            await tx.insert(portalSubjects).values({ classId: r.id, name: subjectName, sortOrder: next });
          }
          added = missing.map((r) => r.name);
        }
        const updated = await tx.update(portalSubjects).set({ teacherId: t?.id ?? null }).where(and(inArray(portalSubjects.classId, ids), same)).returning({ classId: portalSubjects.classId });
        check(updated.length, `None of these classes has ${name}.`, 404);
        return { added, classes: new Set(updated.map((u) => u.classId)).size };
      });
      const n = added.classes;
      message = (t ? `${t.name} now teaches ${name} in ${n} ${n === 1 ? "class" : "classes"}.` : `${name} has no subject teacher now in ${n} ${n === 1 ? "class" : "classes"}.`)
        + (added.added.length ? ` ${name} was added to ${added.added.join(", ")}.` : "");
      break;
    }
  }
  res.json({ message });
});

export const KINDS: ActivityKind[] = ["register", "scores", "exams", "marking", "messages", "assignments", "notes", "announcements", "other"];

/** What each teacher did on one day (Lagos time): when they were in the portal and every change they made. */
portalPrincipalRouter.get("/principal/activity", async (req, res) => {
  const query = GetPrincipalActivityQueryParams.parse(req.query);
  const section = query.section ?? "secondary";
  principalOnly(req, section);
  const date = query.date ?? lagosToday();
  const day = lagosDay(date);
  check(day, "Choose a valid date.");
  const staff = await sectionStaff(section);
  const teachers = staff.teachers.filter(staff.inSection);
  const emails = teachers.map((t) => t.email.toLowerCase());
  const rows = emails.length
    ? await db.select({ at: portalAuditLog.at, actorLabel: portalAuditLog.actorLabel, action: portalAuditLog.action }).from(portalAuditLog)
      .where(and(gte(portalAuditLog.at, day.start), lt(portalAuditLog.at, day.end), eq(portalAuditLog.outcome, "success"), inArray(sql`lower(${portalAuditLog.actorLabel})`, emails)))
      .orderBy(asc(portalAuditLog.at)).limit(5000)
    : [];
  const presence = teachers.length
    ? await db.select().from(portalTeacherPresence).where(and(eq(portalTeacherPresence.day, date), inArray(portalTeacherPresence.teacherId, teachers.map((t) => t.id))))
    : [];
  const classNames = new Map(staff.classes.map((c) => [c.id, c.name]));
  const result = teachers.map((t) => {
    const actions = rows.filter((r) => r.actorLabel.toLowerCase() === t.email.toLowerCase())
      .map((r) => ({ at: r.at.toISOString(), ...describeActivity(r.action) }))
      .filter((a): a is { at: string; kind: ActivityKind; label: string } => !!a.label);
    const seen = presence.find((p) => p.teacherId === t.id);
    const times = [...actions.map((a) => a.at), ...(seen ? [seen.firstAt.toISOString(), seen.lastAt.toISOString()] : [])].sort();
    return {
      id: t.id, name: t.name, email: t.email, classes: t.classIds.map((id) => classNames.get(id)).filter((n): n is string => !!n),
      firstSeen: times[0] ?? null, lastSeen: times[times.length - 1] ?? null,
      counts: Object.fromEntries(KINDS.map((k) => [k, actions.filter((a) => a.kind === k).length])) as Record<ActivityKind, number>,
      actions,
    };
  });
  res.json({ date, today: lagosToday(), teachers: result });
});
