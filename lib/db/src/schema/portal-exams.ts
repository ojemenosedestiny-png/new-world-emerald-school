import { pgTable, serial, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { portalClasses } from "./portal-classes";
export interface PortalQuestionData {
  id: string;
  type: "mcq" | "written";
  text: string;
  options: string[];
  correctAnswer?: number | null;
  marks: number;
  rubric?: string;
  /** Shared passage or instructions shown above the question (copied onto each question it applies to). */
  passage?: string;
  /** A diagram picture for the question, stored as a portal file. */
  diagramFileId?: string | null;
}
export const portalExams = pgTable("portal_exams", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  subject: text("subject").notNull(),
  classId: integer("class_id").notNull().references(() => portalClasses.id),
  durationMinutes: integer("duration_minutes").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  mode: text("mode").notNull(),
  fileId: text("file_id"),
  instructions: text("instructions").notNull().default(""),
  questions: jsonb("questions").$type<PortalQuestionData[]>().notNull(),
  published: boolean("published").notNull().default(false),
  resultsReleased: boolean("results_released").notNull().default(false),
  // Computer-based test options: each student's paper can be drawn from the question bank and shuffled.
  shuffleQuestions: boolean("shuffle_questions").notNull().default(false),
  shuffleOptions: boolean("shuffle_options").notNull().default(false),
  // 0 = every question; otherwise each student gets this many, drawn at random.
  drawCount: integer("draw_count").notNull().default(0),
  // Full screen, no copy or paste, and every exit from the exam screen is recorded for the teacher.
  lockdown: boolean("lockdown").notNull().default(false),
  // Each student sees their own result as soon as their attempt is marked (multiple choice: on submitting), with no release step.
  instantResults: boolean("instant_results").notNull().default(true),
});
export const insertPortalExamSchema = createInsertSchema(portalExams).omit({ id: true });
export type PortalExamRecord = typeof portalExams.$inferSelect;
