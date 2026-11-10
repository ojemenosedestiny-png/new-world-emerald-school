import { Router } from "express";
import { asc, inArray } from "drizzle-orm";
import {
  db, portalAttempts, portalClasses, portalExams, portalImages, portalScores, portalStudents, portalSubjects, portalTeachers, portalTerms,
} from "@workspace/db";
import { check } from "../lib/portal-auth";
import { isSuperAdmin } from "../lib/website-admin";
import {
  approvedEmails, bursarEmails, chairmanEmails, directorEmails, examOfficerEmails, headEmails, principalEmails, superAdminEmails,
} from "../lib/approved-identities";
import { classSection } from "../lib/principal";
import { readImage } from "../lib/images";
import { recordAudit, clientIp } from "../lib/audit";
import { csv, ZipStream } from "../lib/zip-stream";

/**
 * The school owner's full download: one ZIP with spreadsheets (CSV, opens in Excel) of every student, teacher,
 * staff role, parent, class, result and CBT score, and a photos folder. Passwords are never included.
 */
export const schoolExportRouter = Router();
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const day = (d: Date | null | undefined) => (d ? new Date(d.getTime() + 3_600_000).toISOString().slice(0, 10) : "");
const SECTION = { primary: "Primary", secondary: "Secondary" } as const;

schoolExportRouter.get("/export/everything", async (req, res) => {
  check(req.identity, "Sign in first.", 401);
  check(isSuperAdmin(req), "Only the school owner can download all the school's data.", 403);
  const by = req.identity!.email ?? "school owner";

  const [classes, students, teachers, subjects, terms, scores, exams, attempts] = await Promise.all([
    db.select().from(portalClasses).orderBy(asc(portalClasses.name)),
    db.select().from(portalStudents).orderBy(asc(portalStudents.name)),
    db.select().from(portalTeachers).orderBy(asc(portalTeachers.name)),
    db.select().from(portalSubjects),
    db.select().from(portalTerms),
    db.select().from(portalScores),
    db.select({ id: portalExams.id, title: portalExams.title, subject: portalExams.subject, classId: portalExams.classId, startsAt: portalExams.startsAt }).from(portalExams),
    db.select({ examId: portalAttempts.examId, studentId: portalAttempts.studentId, status: portalAttempts.status, questions: portalAttempts.questions, marks: portalAttempts.marks, savedAt: portalAttempts.savedAt }).from(portalAttempts),
  ]);
  const photoIds = [...students.map((s) => s.photoImageId), ...teachers.map((t) => t.photoFileId)].filter((id): id is string => !!id);
  const photos = photoIds.length ? await db.select().from(portalImages).where(inArray(portalImages.id, photoIds)) : [];
  const photoRow = new Map(photos.map((p) => [p.id, p]));
  const className = new Map(classes.map((c) => [c.id, c.name]));
  const section = (classId: number) => { const s = classSection(className.get(classId) ?? ""); return s ? SECTION[s] : ""; };
  const studentById = new Map(students.map((s) => [s.id, s]));
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const termById = new Map(terms.map((t) => [t.id, t]));
  const examById = new Map(exams.map((e) => [e.id, e]));
  const photoName = (folder: string, label: string, id: string | null) => {
    const row = id ? photoRow.get(id) : undefined;
    return row ? `photos/${folder}/${label}.${EXT[row.contentType] ?? "jpg"}` : "";
  };
  const studentPhoto = (s: typeof students[number]) => photoName("students", `${s.studentId.replace(/\//g, "-")} ${s.name}`, s.photoImageId);
  const teacherPhoto = (t: typeof teachers[number]) => photoName("teachers", `${t.name} (${t.id})`, t.photoFileId);

  await recordAudit({ actorKind: "staff", actorId: req.dbUser?.id ?? null, actorLabel: by, action: "school.export_everything", targetType: "school", targetId: "all", after: { students: students.length, teachers: teachers.length, photos: photos.length }, ip: clientIp(req), userAgent: req.headers["user-agent"] ?? null });

  const stamp = day(new Date());
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="new-world-emerald-school-data-${stamp}.zip"`);
  res.setHeader("Cache-Control", "no-store");
  const zip = new ZipStream(res);

  await zip.add("students.csv", csv(
    ["Student ID (login)", "Full name", "Class", "School", "Active", "Account status", "Activated on", "Parent email 1", "Parent email 2", "Photo file"],
    students.map((s) => [s.studentId, s.name, className.get(s.classId) ?? "", section(s.classId), s.active ? "Yes" : "No", s.accountStatus, day(s.activatedAt), s.guardianEmail ?? "", s.secondGuardianEmail ?? "", studentPhoto(s)]),
  ));
  await zip.add("teachers.csv", csv(
    ["Teacher no.", "Full name", "Email (login)", "Role / title", "Subjects", "Classes", "School", "Active", "In staff directory", "Photo file"],
    teachers.map((t) => {
      const names = t.classIds.map((id) => className.get(id)).filter(Boolean) as string[];
      const sections = [...new Set(names.map((n) => classSection(n)).filter(Boolean).map((s) => SECTION[s!]))];
      return [t.id, t.name, t.email, t.title, t.subjects.join(", "), names.join(", "), sections.join(" and "), t.active ? "Yes" : "No", t.showInDirectory ? "Yes" : "No", teacherPhoto(t)];
    }),
  ));
  const roles: [string, string[]][] = [
    ["School owner (super administrator)", superAdminEmails()], ["Office administrator", approvedEmails()], ["Head of School / Head Teacher", headEmails()],
    ["Director", directorEmails()], ["Secondary principal", principalEmails("secondary")], ["Primary principal", principalEmails("primary")],
    ["Exam officer", examOfficerEmails()], ["Chairman", chairmanEmails()], ["Bursar", bursarEmails()],
  ];
  await zip.add("staff-roles.csv", csv(["Role", "Email (login)"], roles.flatMap(([role, emails]) => emails.map((e) => [role, e]))));
  const parents = new Map<string, typeof students>();
  for (const s of students) for (const e of [s.guardianEmail, s.secondGuardianEmail]) {
    const email = e?.trim().toLowerCase();
    if (email) parents.set(email, [...(parents.get(email) ?? []), s]);
  }
  await zip.add("parents.csv", csv(["Parent email (login)", "Children", "Children's IDs", "Classes"],
    [...parents.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([email, kids]) => [email, kids.map((k) => k.name).join(", "), kids.map((k) => k.studentId).join(", "), kids.map((k) => className.get(k.classId) ?? "").join(", ")])));
  await zip.add("classes.csv", csv(["Class", "School", "Active students", "All students", "Class teachers", "Subjects"],
    classes.map((c) => [c.name, section(c.id), students.filter((s) => s.classId === c.id && s.active).length, students.filter((s) => s.classId === c.id).length,
      teachers.filter((t) => t.classIds.includes(c.id)).map((t) => t.name).join(", "), subjects.filter((s) => s.classId === c.id).map((s) => s.name).join(", ")])));
  await zip.add("results.csv", csv(
    ["Session", "Term", "Class", "Student ID", "Student name", "Subject", "CA / First Half Term", "CA 2", "Exam / Second Half Term", "Typed total", "Typed grade", "Subject teacher's comment"],
    scores.map((r) => {
      const st = studentById.get(r.studentId), sub = subjectById.get(r.subjectId), term = termById.get(r.termId);
      return [term?.session ?? "", term?.term ?? "", sub ? className.get(sub.classId) ?? "" : "", st?.studentId ?? "", st?.name ?? "", sub?.name ?? "", r.ca ?? "", r.ca2 ?? "", r.exam ?? "", r.total ?? "", r.grade ?? "", r.comment];
    }),
  ));
  await zip.add("cbt-scores.csv", csv(["Exam", "Subject", "Class", "Exam date", "Student ID", "Student name", "Status", "Score", "Out of", "Last saved"],
    attempts.map((a) => {
      const e = examById.get(a.examId), st = studentById.get(a.studentId);
      const score = a.marks.reduce((n, m) => n + m.score, 0), out = a.questions.reduce((n, q) => n + q.marks, 0);
      return [e?.title ?? "", e?.subject ?? "", e ? className.get(e.classId) ?? "" : "", day(e?.startsAt), st?.studentId ?? "", st?.name ?? "", a.status, a.status === "marked" ? score : "", out, day(a.savedAt)];
    })));

  // Photos last, one at a time; any that cannot be fetched are listed in the read-me.
  const missed: string[] = [];
  for (const [folder, owner, id] of [...students.map((s) => [studentPhoto(s), s.name, s.photoImageId] as const), ...teachers.map((t) => [teacherPhoto(t), t.name, t.photoFileId] as const)]) {
    const row = id ? photoRow.get(id) : undefined;
    if (!row || !folder) continue;
    try { await zip.add(folder, await readImage(row), false); }
    catch { missed.push(owner); req.log.warn({ imageId: row.id }, "Export: photo could not be read"); }
  }
  await zip.add("READ ME.txt", Buffer.from([
    "New World Emerald Private School: full data download",
    `Downloaded ${new Date().toISOString()} by ${by}.`,
    "",
    "Open the .csv files in Excel (double-click, or Excel > Open). Photos are in the photos folder; each student's",
    "and teacher's photo file is named in the last column of students.csv and teachers.csv.",
    "",
    "students.csv      every student: login ID, name, class, school, status, parent emails, photo",
    "teachers.csv      every teacher: login email, name, role, subjects, classes, photo",
    "staff-roles.csv   office, Head of School, Director, principals, exam officer, Chairman, bursar logins",
    "parents.csv       every parent email and their children",
    "classes.csv       every class with its students, teachers and subjects",
    "results.csv       every saved result mark (report cards)",
    "cbt-scores.csv    every CBT exam attempt and score",
    "",
    "Passwords are never included: they are stored scrambled and cannot be read by anyone.",
    "This file holds children's personal information. Keep it on a password-protected computer and do not share it.",
    ...(missed.length ? ["", `Photos that could not be downloaded this time (${missed.length}): ${missed.join(", ")}`] : []),
  ].join("\r\n"), "utf8"));
  await zip.finish();
});
