import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, portalClasses, portalStudents, studentProfiles, type StudentProfileRecord } from "@workspace/db";
import { GetChildProfileParams, GetStudentProfileParams, SaveStudentProfileBody, SaveStudentProfileParams } from "@workspace/api-zod";
import { check, classAllowed, portalActor, studentOnly } from "../lib/portal-auth";
import { parentEmail } from "./portal-parent";
import { recordAudit, clientIp } from "../lib/audit";

/**
 * Each student's full profile: date of birth, home address and phone, state of origin, health, admission details,
 * both parents or guardians and an emergency contact. The office and the student's class teachers fill it in; the
 * student and their linked parents can read it.
 */
export const studentProfilesRouter = Router();

export const PROFILE_FIELDS = [
  "dateOfBirth", "gender", "phone", "address", "city", "stateOfOrigin", "lga", "nationality", "religion", "bloodGroup", "genotype", "medicalNotes",
  "admissionDate", "previousSchool", "parent1Name", "parent1Relationship", "parent1Phone", "parent1Occupation", "parent2Name", "parent2Relationship",
  "parent2Phone", "parent2Occupation", "emergencyName", "emergencyPhone",
] as const;
type Field = typeof PROFILE_FIELDS[number];
const PHONES: Field[] = ["phone", "parent1Phone", "parent2Phone", "emergencyPhone"];
const DATES: Field[] = ["dateOfBirth", "admissionDate"];

const blank = () => Object.fromEntries(PROFILE_FIELDS.map((f) => [f, ""])) as Record<Field, string>;
const fieldsOf = (row: StudentProfileRecord | undefined) => (row ? Object.fromEntries(PROFILE_FIELDS.map((f) => [f, row[f]])) as Record<Field, string> : blank());

async function view(studentId: number, canEdit: boolean) {
  const [s] = await db.select().from(portalStudents).where(eq(portalStudents.id, studentId));
  check(s, "Student not found.", 404);
  const [[cls], [row]] = await Promise.all([
    db.select({ name: portalClasses.name }).from(portalClasses).where(eq(portalClasses.id, s.classId)),
    db.select().from(studentProfiles).where(eq(studentProfiles.studentId, s.id)),
  ]);
  return {
    id: s.id, studentId: s.studentId, name: s.name, className: cls?.name ?? "", active: s.active, photoImageId: s.photoImageId,
    guardianEmail: s.guardianEmail, secondGuardianEmail: s.secondGuardianEmail, profile: fieldsOf(row),
    updatedAt: row?.updatedAt.toISOString() ?? null, updatedBy: row?.updatedBy ?? "", canEdit,
  };
}

/** Problems with the details as typed, in plain words; null when they are fine. */
export function profileProblem(p: Record<Field, string>, today = new Date().toISOString().slice(0, 10)): string | null {
  for (const f of DATES) {
    const v = p[f];
    if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + "T12:00:00Z")) || new Date(v + "T12:00:00Z").toISOString().slice(0, 10) !== v)) return f === "dateOfBirth" ? "Enter a real date of birth." : "Enter a real admission date.";
    if (v && v > today) return f === "dateOfBirth" ? "The date of birth cannot be in the future." : "The admission date cannot be in the future.";
  }
  if (p.dateOfBirth && p.dateOfBirth < "1990-01-01") return "Check the date of birth.";
  for (const f of PHONES) {
    const v = p[f];
    if (v && (!/^\+?[\d\s()-]{7,20}$/.test(v) || v.replace(/\D/g, "").length < 7)) return "Phone numbers use digits only, for example 0803 123 4567 or +234 803 123 4567.";
  }
  if (p.gender && !["Male", "Female"].includes(p.gender)) return "Choose Male or Female.";
  return null;
}

studentProfilesRouter.get("/students/:id/profile", async (req, res) => {
  const actor = await portalActor(req);
  const { id } = GetStudentProfileParams.parse(req.params);
  const [s] = await db.select({ classId: portalStudents.classId }).from(portalStudents).where(eq(portalStudents.id, id));
  check(s, "Student not found.", 404);
  classAllowed(actor, s.classId);
  res.json(await view(id, true));
});

studentProfilesRouter.put("/students/:id/profile", async (req, res) => {
  const actor = await portalActor(req);
  const { id } = SaveStudentProfileParams.parse(req.params);
  const body = SaveStudentProfileBody.parse(req.body);
  const [s] = await db.select({ classId: portalStudents.classId, studentId: portalStudents.studentId }).from(portalStudents).where(eq(portalStudents.id, id));
  check(s, "Student not found.", 404);
  classAllowed(actor, s.classId);
  const values = Object.fromEntries(PROFILE_FIELDS.map((f) => [f, (body[f] ?? "").trim().replace(/\s+/g, " ")])) as Record<Field, string>;
  const problem = profileProblem(values);
  check(!problem, problem ?? "");
  const by = req.identity?.email || actor.name;
  const [before] = await db.select().from(studentProfiles).where(eq(studentProfiles.studentId, id));
  await db.insert(studentProfiles).values({ studentId: id, ...values, updatedBy: by, updatedAt: new Date() })
    .onConflictDoUpdate({ target: studentProfiles.studentId, set: { ...values, updatedBy: by, updatedAt: new Date() } });
  const changed = PROFILE_FIELDS.filter((f) => (before?.[f] ?? "") !== values[f]);
  await recordAudit({ actorKind: "staff", actorId: req.dbUser?.id ?? null, actorLabel: by, action: "student.profile_saved", targetType: "student", targetId: s.studentId, after: { changed }, ip: clientIp(req), userAgent: req.headers["user-agent"] ?? null });
  res.json(await view(id, true));
});

studentProfilesRouter.get("/me/profile", async (req, res) => {
  const student = studentOnly(await portalActor(req));
  res.json(await view(student.id, false));
});

studentProfilesRouter.get("/parent/children/:id/profile", async (req, res) => {
  const email = await parentEmail(req);
  check(email, "Sign in with the email address the school has for you.", 401);
  const { id } = GetChildProfileParams.parse(req.params);
  const [child] = await db.select({ id: portalStudents.id }).from(portalStudents).where(and(eq(portalStudents.id, id),
    sql`(lower(trim(${portalStudents.guardianEmail})) = ${email} or lower(trim(${portalStudents.secondGuardianEmail})) = ${email})`));
  check(child, "This child is not linked to your email.", 404);
  res.json(await view(id, false));
});
