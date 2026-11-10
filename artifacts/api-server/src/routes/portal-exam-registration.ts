import { Router, type Request } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, examRegistrationSettings, examRegistrations, portalClasses, portalStudents, type ExamRegistrationRecord, type ExamRegistrationSettingsRecord } from "@workspace/db";
import { GetExamRegistrationAdminQueryParams, ReviewExamRegistrationBody, ReviewExamRegistrationParams, SaveExamRegistrationSettingsBody, SaveMyExamRegistrationBody } from "@workspace/api-zod";
import { check, portalActor, studentOnly } from "../lib/portal-auth";
import { accountFor, examFeeStatus, knownSessions, openRegistrationFor } from "../lib/payment-accounts";
import { lagosToday } from "../lib/principal";
import { recordAudit, clientIp } from "../lib/audit";

/**
 * WAEC and NECO registration for SS 3. The school opens it for a session with a fee; the student fills the form;
 * the parent pays by transfer into the WAEC/NECO account; once the school confirms the payment the student submits.
 */
export const portalExamRegistrationRouter = Router();

async function office(req: Request) {
  const actor = await portalActor(req);
  check(actor.role === "admin", actor.role === "guest" ? "Sign in as an administrator." : "Only the school office and the Head of School can manage WAEC/NECO registration.", actor.role === "guest" ? 401 : 403);
  return req.identity?.email ?? actor.name;
}

const settingsView = (s: ExamRegistrationSettingsRecord) => ({
  academicYear: s.academicYear, title: s.title, open: s.open, feeKobo: s.feeKobo, compulsorySubjects: s.compulsorySubjects,
  optionalSubjects: s.optionalSubjects, maxSubjects: s.maxSubjects, classIds: s.classIds, deadline: s.deadline,
});
const formView = (f: ExamRegistrationRecord) => ({
  id: f.id, academicYear: f.academicYear, surname: f.surname, firstName: f.firstName, middleName: f.middleName, dateOfBirth: f.dateOfBirth,
  stateOfOrigin: f.stateOfOrigin, lga: f.lga, gender: f.gender, nin: f.nin, subjects: f.subjects, phone: f.phone, email: f.email,
  signatureName: f.signatureName, status: f.status as "draft" | "submitted" | "returned", officeNote: f.officeNote,
  submittedAt: f.submittedAt?.toISOString() ?? null, updatedAt: f.updatedAt.toISOString(),
});
const clean = (v: string) => v.trim().replace(/\s+/g, " ");
const sameSubject = (a: string, b: string) => clean(a).toLowerCase() === clean(b).toLowerCase();

/** What is wrong with a form before it can be submitted, or null. Exported for tests. */
export function formProblem(f: { surname: string; firstName: string; dateOfBirth: string; stateOfOrigin: string; lga: string; gender: string; nin: string; subjects: string[]; phone: string; email: string; signatureName: string }, s: Pick<ExamRegistrationSettingsRecord, "compulsorySubjects" | "optionalSubjects" | "maxSubjects">, today: string) {
  if (!clean(f.surname) || !clean(f.firstName)) return "Write your surname and first name exactly as on your birth certificate.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.dateOfBirth) || Number.isNaN(Date.parse(f.dateOfBirth))) return "Enter your date of birth.";
  const age = (Date.parse(today) - Date.parse(f.dateOfBirth)) / (365.25 * 86_400_000);
  if (age < 10 || age > 30) return "Check your date of birth.";
  if (!clean(f.stateOfOrigin) || !clean(f.lga)) return "Enter your state of origin and local government area.";
  if (f.gender !== "Male" && f.gender !== "Female") return "Choose your gender.";
  if (!/^\d{11}$/.test(f.nin)) return "Your NIN (National Identification Number) has 11 digits.";
  const subjects = f.subjects.map(clean).filter(Boolean);
  if (new Set(subjects.map((x) => x.toLowerCase())).size !== subjects.length) return "A subject is listed twice.";
  const missing = s.compulsorySubjects.filter((c) => !subjects.some((x) => sameSubject(x, c)));
  if (missing.length) return `Every candidate takes ${missing.join(", ")}.`;
  if (subjects.length > s.maxSubjects) return `Choose at most ${s.maxSubjects} subjects.`;
  if (subjects.length < Math.min(s.maxSubjects, Math.max(s.compulsorySubjects.length, 8))) return `Choose ${Math.min(s.maxSubjects, Math.max(s.compulsorySubjects.length, 8))} subjects or more.`;
  const allowed = [...s.compulsorySubjects, ...s.optionalSubjects];
  const unknown = subjects.filter((x) => !allowed.some((a) => sameSubject(a, x)));
  if (unknown.length) return `${unknown.join(", ")} is not on the school's subject list.`;
  if (!/^\+?\d{10,14}$/.test(f.phone.replace(/[\s-]/g, ""))) return "Enter a phone number we can call.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return "Enter a valid email address.";
  if (!clean(f.signatureName).toLowerCase().includes(clean(f.surname).toLowerCase())) return "Sign by typing your full name, including your surname.";
  return null;
}

async function mine(student: { id: number; name: string; studentId: string; classId: number }) {
  const [cls] = await db.select({ name: portalClasses.name }).from(portalClasses).where(eq(portalClasses.id, student.classId));
  const open = await openRegistrationFor(student.classId);
  // When nothing is open, a student still sees the form they sent last.
  const [latest] = await db.select().from(examRegistrations).where(eq(examRegistrations.studentId, student.id)).orderBy(desc(examRegistrations.academicYear)).limit(1);
  const settings = open ?? (latest ? (await db.select().from(examRegistrationSettings).where(eq(examRegistrationSettings.academicYear, latest.academicYear)))[0] ?? null : null);
  const form = settings ? (await db.select().from(examRegistrations).where(and(eq(examRegistrations.studentId, student.id), eq(examRegistrations.academicYear, settings.academicYear))))[0] ?? null : null;
  return {
    settings: settings ? settingsView(settings) : null, eligible: !!open, form: form ? formView(form) : null,
    fee: settings && settings.feeKobo > 0 ? { amountKobo: settings.feeKobo, status: await examFeeStatus(student.id, settings.academicYear), itemKey: `exam-${settings.academicYear}` } : null,
    account: settings ? await accountFor("exam_registration", settings.academicYear) : null,
    student: { name: student.name, studentId: student.studentId, className: cls?.name ?? "" },
  };
}

portalExamRegistrationRouter.get("/my-exam-registration", async (req, res) => {
  const student = studentOnly(await portalActor(req));
  res.json(await mine(student));
});

portalExamRegistrationRouter.put("/my-exam-registration", async (req, res) => {
  const student = studentOnly(await portalActor(req));
  const body = SaveMyExamRegistrationBody.parse(req.body);
  const s = await openRegistrationFor(student.classId);
  check(s, "WAEC/NECO registration is not open for your class.", 403);
  const today = lagosToday();
  check(!s.deadline || today <= s.deadline, `Registration closed on ${s.deadline}. Speak to the school office.`, 403);
  const [old] = await db.select().from(examRegistrations).where(and(eq(examRegistrations.studentId, student.id), eq(examRegistrations.academicYear, s.academicYear)));
  check(!old || old.status !== "submitted", "Your form is already submitted. Ask the school office if something must change.", 409);
  const fields = {
    surname: clean(body.surname), firstName: clean(body.firstName), middleName: clean(body.middleName), dateOfBirth: body.dateOfBirth.trim(),
    stateOfOrigin: clean(body.stateOfOrigin), lga: clean(body.lga), gender: body.gender.trim(), nin: body.nin.replace(/\s+/g, ""),
    // Subjects are kept as the school spells them.
    subjects: body.subjects.map(clean).filter(Boolean).map((x) => [...s.compulsorySubjects, ...s.optionalSubjects].find((a) => sameSubject(a, x)) ?? x),
    phone: body.phone.trim(), email: body.email.trim().toLowerCase(), signatureName: clean(body.signatureName),
  };
  if (body.submit) {
    const problem = formProblem(fields, s, today);
    check(!problem, problem ?? "");
    if (s.feeKobo > 0) check((await examFeeStatus(student.id, s.academicYear)) === "paid", "The registration fee must be paid and confirmed by the school before you can submit. Your parent pays it in the parent portal.", 402);
  }
  const values = { ...fields, status: body.submit ? "submitted" : old?.status === "returned" ? "returned" : "draft", submittedAt: body.submit ? new Date() : null, updatedAt: new Date() };
  if (old) await db.update(examRegistrations).set(values).where(eq(examRegistrations.id, old.id));
  else await db.insert(examRegistrations).values({ ...values, studentId: student.id, academicYear: s.academicYear });
  if (body.submit) await recordAudit({ actorKind: "student", actorId: String(student.id), actorLabel: student.studentId, action: "exam_registration.submitted", targetType: "exam_registration", targetId: s.academicYear, ip: clientIp(req), userAgent: req.headers["user-agent"] ?? null });
  res.json(await mine(student));
});

portalExamRegistrationRouter.get("/exam-registration", async (req, res) => {
  await office(req);
  const { academicYear } = GetExamRegistrationAdminQueryParams.parse(req.query);
  const [sessions, classes, all] = await Promise.all([
    knownSessions(),
    db.select({ id: portalClasses.id, name: portalClasses.name }).from(portalClasses).orderBy(asc(portalClasses.name)),
    db.select().from(examRegistrationSettings).orderBy(desc(examRegistrationSettings.academicYear)),
  ]);
  const settings = academicYear ? all.find((s) => s.academicYear === academicYear) ?? null : all[0] ?? null;
  let rows: unknown[] = [];
  if (settings) {
    const students = settings.classIds.length ? await db.select().from(portalStudents).where(and(inArray(portalStudents.classId, settings.classIds), eq(portalStudents.active, true))).orderBy(asc(portalStudents.name)) : [];
    const forms = await db.select().from(examRegistrations).where(eq(examRegistrations.academicYear, settings.academicYear));
    // Students who left the class but already registered are kept.
    const extra = forms.filter((f) => !students.some((st) => st.id === f.studentId)).map((f) => f.studentId);
    const others = extra.length ? await db.select().from(portalStudents).where(inArray(portalStudents.id, extra)) : [];
    rows = await Promise.all([...students, ...others].map(async (st) => {
      const f = forms.find((x) => x.studentId === st.id);
      return { studentId: st.id, studentName: st.name, studentCode: st.studentId, className: classes.find((c) => c.id === st.classId)?.name ?? "", feeStatus: settings.feeKobo > 0 ? await examFeeStatus(st.id, settings.academicYear) : "paid", form: f ? formView(f) : null };
    }));
  }
  res.json({ settings: settings ? settingsView(settings) : null, sessions: [...new Set([...all.map((s) => s.academicYear), ...sessions])].sort((a, b) => b.localeCompare(a)), classes, rows });
});

portalExamRegistrationRouter.post("/exam-registration", async (req, res) => {
  const by = await office(req);
  const body = SaveExamRegistrationSettingsBody.parse(req.body);
  const academicYear = body.academicYear.trim();
  check(/^\d{4}\/\d{4}$/.test(academicYear), "Write the session like 2026/2027.");
  check(!body.deadline || /^\d{4}-\d{2}-\d{2}$/.test(body.deadline), "Choose a valid closing date.");
  const tidy = (list: string[]) => [...new Map(list.map(clean).filter(Boolean).map((x) => [x.toLowerCase(), x])).values()];
  const compulsorySubjects = tidy(body.compulsorySubjects);
  const optionalSubjects = tidy(body.optionalSubjects).filter((x) => !compulsorySubjects.some((c) => sameSubject(c, x)));
  check(body.maxSubjects >= compulsorySubjects.length, "The most subjects allowed must include every compulsory subject.");
  const classIds = [...new Set(body.classIds)];
  if (classIds.length) check((await db.select({ id: portalClasses.id }).from(portalClasses).where(inArray(portalClasses.id, classIds))).length === classIds.length, "A class was not found.", 404);
  check(!body.open || classIds.length, "Choose the SS 3 classes before opening registration.");
  const values = { academicYear, title: clean(body.title) || "WAEC and NECO registration", open: body.open, feeKobo: body.feeKobo, compulsorySubjects, optionalSubjects, maxSubjects: body.maxSubjects, classIds, deadline: body.deadline, updatedAt: new Date() };
  await db.insert(examRegistrationSettings).values(values).onConflictDoUpdate({ target: examRegistrationSettings.academicYear, set: values });
  await recordAudit({ actorKind: "staff", actorId: req.dbUser?.id ?? null, actorLabel: by, action: "exam_registration.settings", targetType: "exam_registration_settings", targetId: academicYear, after: { open: values.open, feeKobo: values.feeKobo, classes: classIds.length }, ip: clientIp(req), userAgent: req.headers["user-agent"] ?? null });
  res.json({ message: `${values.title} ${academicYear} is ${values.open ? "open" : "closed"}.` });
});

portalExamRegistrationRouter.post("/exam-registration/:id", async (req, res) => {
  const by = await office(req);
  const { id } = ReviewExamRegistrationParams.parse(req.params);
  const body = ReviewExamRegistrationBody.parse(req.body);
  const note = body.note.trim();
  check(note.length >= 3, "Tell the student what to correct.");
  const [f] = await db.select().from(examRegistrations).where(eq(examRegistrations.id, id));
  check(f, "Form not found.", 404);
  check(f.status === "submitted", "Only a submitted form can be sent back.", 409);
  await db.update(examRegistrations).set({ status: "returned", officeNote: note, updatedAt: new Date() }).where(eq(examRegistrations.id, f.id));
  await recordAudit({ actorKind: "staff", actorId: req.dbUser?.id ?? null, actorLabel: by, action: "exam_registration.returned", targetType: "exam_registration", targetId: String(f.id), after: { note }, ip: clientIp(req), userAgent: req.headers["user-agent"] ?? null });
  res.json({ message: "The form is back with the student to correct." });
});
