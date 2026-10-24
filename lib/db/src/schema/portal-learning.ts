import { pgTable, serial, text, integer, real, boolean, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { portalClasses } from "./portal-classes";
import { portalStudents } from "./portal-students";

/** Daily register: one row per student per school day. Date is the school's local date, YYYY-MM-DD. */
export const portalAttendance = pgTable("portal_attendance", {
  id: serial("id").primaryKey(),
  classId: integer("class_id").notNull().references(() => portalClasses.id, { onDelete: "cascade" }),
  studentId: integer("student_id").notNull().references(() => portalStudents.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  status: text("status").notNull(),
  note: text("note").notNull().default(""),
  markedBy: text("marked_by"),
  markedAt: timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("portal_attendance_student_date").on(t.studentId, t.date), index("portal_attendance_class_date").on(t.classId, t.date)]);
export type PortalAttendanceRecord = typeof portalAttendance.$inferSelect;

/** Homework and class assignments set by staff for one class. */
export const portalAssignments = pgTable("portal_assignments", {
  id: serial("id").primaryKey(),
  classId: integer("class_id").notNull().references(() => portalClasses.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  title: text("title").notNull(),
  instructions: text("instructions").notNull().default(""),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  maxScore: integer("max_score").notNull().default(10),
  published: boolean("published").notNull().default(false),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("portal_assignments_class").on(t.classId)]);
export type PortalAssignmentRecord = typeof portalAssignments.$inferSelect;

/** A student's answer to an assignment: text and up to five photos (portal_images ids). */
export const portalSubmissions = pgTable("portal_submissions", {
  id: serial("id").primaryKey(),
  assignmentId: integer("assignment_id").notNull().references(() => portalAssignments.id, { onDelete: "cascade" }),
  studentId: integer("student_id").notNull().references(() => portalStudents.id, { onDelete: "cascade" }),
  text: text("text").notNull().default(""),
  imageIds: text("image_ids").array().notNull().default([]),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  score: real("score"),
  feedback: text("feedback").notNull().default(""),
  markedAt: timestamp("marked_at", { withTimezone: true }),
  markedBy: text("marked_by"),
}, (t) => [uniqueIndex("portal_submissions_assignment_student").on(t.assignmentId, t.studentId)]);
export type PortalSubmissionRecord = typeof portalSubmissions.$inferSelect;
