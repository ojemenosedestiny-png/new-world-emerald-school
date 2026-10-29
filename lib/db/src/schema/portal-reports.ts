import { pgTable, serial, text, integer, real, timestamp, uniqueIndex, primaryKey, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { portalClasses } from "./portal-classes";
import { portalStudents } from "./portal-students";

// Academic term, e.g. session "2026/2027", term "First Term". Score maxima apply to every subject.
export const portalTerms = pgTable("portal_terms", {
  id: serial("id").primaryKey(),
  session: text("session").notNull(),
  term: text("term").notNull(),
  caMax: integer("ca_max").notNull().default(40),
  examMax: integer("exam_max").notNull().default(60),
  nextTermBegins: text("next_term_begins"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("portal_terms_session_term").on(t.session, t.term)]);
export const insertPortalTermSchema = createInsertSchema(portalTerms).omit({ id: true, createdAt: true });
export type PortalTermRecord = typeof portalTerms.$inferSelect;

export const portalSubjects = pgTable("portal_subjects", {
  id: serial("id").primaryKey(),
  classId: integer("class_id").notNull().references(() => portalClasses.id),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  // The subject teacher, who may enter this subject's scores even without being the class teacher.
  teacherId: integer("teacher_id"),
}, (t) => [uniqueIndex("portal_subjects_class_name").on(t.classId, t.name)]);
export const insertPortalSubjectSchema = createInsertSchema(portalSubjects).omit({ id: true });
export type PortalSubjectRecord = typeof portalSubjects.$inferSelect;

// One row per student, subject and term. A null part means "not entered yet".
export const portalScores = pgTable("portal_scores", {
  id: serial("id").primaryKey(),
  termId: integer("term_id").notNull().references(() => portalTerms.id),
  studentId: integer("student_id").notNull().references(() => portalStudents.id),
  subjectId: integer("subject_id").notNull().references(() => portalSubjects.id),
  ca: real("ca"),
  exam: real("exam"),
  // Manual results (or imported old results): a typed total and grade used instead of the calculated ones.
  total: real("total"),
  grade: text("grade"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("portal_scores_term_student_subject").on(t.termId, t.studentId, t.subjectId)]);
export const insertPortalScoreSchema = createInsertSchema(portalScores).omit({ id: true, updatedAt: true });
export type PortalScoreRecord = typeof portalScores.$inferSelect;

export const portalReportCards = pgTable("portal_report_cards", {
  id: serial("id").primaryKey(),
  termId: integer("term_id").notNull().references(() => portalTerms.id),
  studentId: integer("student_id").notNull().references(() => portalStudents.id),
  teacherRemark: text("teacher_remark").notNull().default(""),
  principalRemark: text("principal_remark").notNull().default(""),
  daysPresent: integer("days_present"),
  daysOpen: integer("days_open"),
}, (t) => [uniqueIndex("portal_report_cards_term_student").on(t.termId, t.studentId)]);
export const insertPortalReportCardSchema = createInsertSchema(portalReportCards).omit({ id: true });
export type PortalReportCardRecord = typeof portalReportCards.$inferSelect;

// A row means that class's report cards for the term are visible to its students.
export const portalReportReleases = pgTable("portal_report_releases", {
  termId: integer("term_id").notNull().references(() => portalTerms.id),
  classId: integer("class_id").notNull().references(() => portalClasses.id),
  releasedAt: timestamp("released_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.termId, t.classId] })]);
export type PortalReportReleaseRecord = typeof portalReportReleases.$inferSelect;

/** School-wide report settings (one row, id 1): the grading scale, and the principal's name and signature. */
export const portalReportSettings = pgTable("portal_report_settings", {
  id: integer("id").primaryKey(),
  gradingScale: jsonb("grading_scale").$type<{ min: number; grade: string; remark: string }[]>(),
  principalName: text("principal_name").notNull().default(""),
  // A small PNG/JPEG/WebP data URL, printed on published report cards.
  principalSignature: text("principal_signature"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type PortalReportSettingsRecord = typeof portalReportSettings.$inferSelect;

/**
 * Where a class's results are for a term: draft (scores being entered), review (the class teacher has
 * checked and signed), approved (the principal or office approved). Published is a row in portal_report_releases.
 */
export const portalReportWorkflow = pgTable("portal_report_workflow", {
  termId: integer("term_id").notNull().references(() => portalTerms.id),
  classId: integer("class_id").notNull().references(() => portalClasses.id),
  status: text("status").notNull().default("draft"),
  // automatic: totals and grades come from CA + exam; manual: the teacher may type totals and grades.
  mode: text("mode").notNull().default("automatic"),
  teacherName: text("teacher_name").notNull().default(""),
  teacherSignature: text("teacher_signature"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedBy: text("approved_by").notNull().default(""),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  returnNote: text("return_note").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.termId, t.classId] })]);
export type PortalReportWorkflowRecord = typeof portalReportWorkflow.$inferSelect;

/** Audit log of every import of old results: who, when, which file and what happened. */
export const portalResultImports = pgTable("portal_result_imports", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull().default(""),
  importedBy: text("imported_by").notNull().default(""),
  rows: integer("rows").notNull(),
  imported: integer("imported").notNull(),
  skipped: integer("skipped").notNull(),
  warnings: integer("warnings").notNull().default(0),
  published: integer("published").notNull().default(0),
  // Terms, classes and new subjects touched, for the history list.
  summary: jsonb("summary").$type<{ terms: string[]; classes: string[]; newSubjects: string[]; newTerms: string[] }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type PortalResultImportRecord = typeof portalResultImports.$inferSelect;
