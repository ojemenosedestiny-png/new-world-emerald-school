import { pgTable, serial, text, integer, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { portalStudents } from "./portal-students";

/**
 * WAEC and NECO registration for one academic session: whether it is open, the fee (paid by transfer into the
 * WAEC/NECO account before a form can be submitted), the subjects every candidate takes, the subjects to choose
 * from, and which classes register (SS 3).
 */
export const examRegistrationSettings = pgTable("exam_registration_settings", {
  academicYear: text("academic_year").primaryKey(),
  title: text("title").notNull().default("WAEC and NECO registration"),
  open: boolean("open").notNull().default(false),
  feeKobo: integer("fee_kobo").notNull().default(0),
  compulsorySubjects: text("compulsory_subjects").array().notNull().default([]),
  optionalSubjects: text("optional_subjects").array().notNull().default([]),
  maxSubjects: integer("max_subjects").notNull().default(9),
  classIds: integer("class_ids").array().notNull().default([]),
  // Last day forms can be submitted (YYYY-MM-DD), or empty.
  deadline: text("deadline").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ExamRegistrationSettingsRecord = typeof examRegistrationSettings.$inferSelect;

/** A student's registration form for one session: draft until submitted (only after the fee is confirmed). */
export const examRegistrations = pgTable("exam_registrations", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull().references(() => portalStudents.id),
  academicYear: text("academic_year").notNull(),
  surname: text("surname").notNull().default(""),
  firstName: text("first_name").notNull().default(""),
  middleName: text("middle_name").notNull().default(""),
  dateOfBirth: text("date_of_birth").notNull().default(""),
  stateOfOrigin: text("state_of_origin").notNull().default(""),
  lga: text("lga").notNull().default(""),
  gender: text("gender").notNull().default(""),
  nin: text("nin").notNull().default(""),
  subjects: text("subjects").array().notNull().default([]),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  // The candidate types their full name as their signature.
  signatureName: text("signature_name").notNull().default(""),
  // draft, submitted, returned (sent back by the school for a correction)
  status: text("status").notNull().default("draft"),
  officeNote: text("office_note").notNull().default(""),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("exam_registrations_student_year").on(t.studentId, t.academicYear)]);
export type ExamRegistrationRecord = typeof examRegistrations.$inferSelect;
