import { pgTable, serial, integer, text, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { portalExams, type PortalQuestionData } from "./portal-exams";
import { portalStudents } from "./portal-students";
export interface PortalMarkData { questionId: string; score: number; feedback: string }
export const portalAttempts = pgTable("portal_attempts", {
  id: serial("id").primaryKey(),
  examId: integer("exam_id").notNull().references(() => portalExams.id),
  studentId: integer("student_id").notNull().references(() => portalStudents.id),
  questions: jsonb("questions").$type<PortalQuestionData[]>().notNull(),
  answers: jsonb("answers").$type<Record<string, string>>().notNull().default({}),
  marks: jsonb("marks").$type<PortalMarkData[]>().notNull().default([]),
  status: text("status").notNull().default("in_progress"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  deadline: timestamp("deadline", { withTimezone: true }).notNull(),
  savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
  // Times the student left the exam screen (tab switch, other app, leaving full screen) during a lockdown exam.
  focusLosses: integer("focus_losses").notNull().default(0),
}, (t) => [uniqueIndex("portal_one_exam_attempt").on(t.studentId, t.examId)]);
export const insertPortalAttemptSchema = createInsertSchema(portalAttempts).omit({ id: true });

/**
 * A make-up sitting: a student who missed an exam gets their own window to write it. Only that student sees the exam
 * again; the class's window is unchanged. Removed with the exam or the student.
 */
export const portalExamMakeups = pgTable("portal_exam_makeups", {
  id: serial("id").primaryKey(),
  examId: integer("exam_id").notNull().references(() => portalExams.id, { onDelete: "cascade" }),
  studentId: integer("student_id").notNull().references(() => portalStudents.id, { onDelete: "cascade" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  createdBy: text("created_by").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("portal_one_exam_makeup").on(t.examId, t.studentId)]);
export type PortalExamMakeupRecord = typeof portalExamMakeups.$inferSelect;
export type PortalAttemptRecord = typeof portalAttempts.$inferSelect;
