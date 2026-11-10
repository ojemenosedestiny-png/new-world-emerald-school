import { pgTable, integer, text, timestamp } from "drizzle-orm/pg-core";
import { portalStudents } from "./portal-students";

/**
 * A student's full profile beyond the login record: personal details, home address and phone, health, admission,
 * both parents or guardians and an emergency contact. One row per student; every field is optional text.
 */
export const studentProfiles = pgTable("student_profiles", {
  studentId: integer("student_id").primaryKey().references(() => portalStudents.id, { onDelete: "cascade" }),
  dateOfBirth: text("date_of_birth").notNull().default(""),
  gender: text("gender").notNull().default(""),
  phone: text("phone").notNull().default(""),
  address: text("address").notNull().default(""),
  city: text("city").notNull().default(""),
  stateOfOrigin: text("state_of_origin").notNull().default(""),
  lga: text("lga").notNull().default(""),
  nationality: text("nationality").notNull().default(""),
  religion: text("religion").notNull().default(""),
  bloodGroup: text("blood_group").notNull().default(""),
  genotype: text("genotype").notNull().default(""),
  medicalNotes: text("medical_notes").notNull().default(""),
  admissionDate: text("admission_date").notNull().default(""),
  previousSchool: text("previous_school").notNull().default(""),
  parent1Name: text("parent1_name").notNull().default(""),
  parent1Relationship: text("parent1_relationship").notNull().default(""),
  parent1Phone: text("parent1_phone").notNull().default(""),
  parent1Occupation: text("parent1_occupation").notNull().default(""),
  parent2Name: text("parent2_name").notNull().default(""),
  parent2Relationship: text("parent2_relationship").notNull().default(""),
  parent2Phone: text("parent2_phone").notNull().default(""),
  parent2Occupation: text("parent2_occupation").notNull().default(""),
  emergencyName: text("emergency_name").notNull().default(""),
  emergencyPhone: text("emergency_phone").notNull().default(""),
  updatedBy: text("updated_by").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type StudentProfileRecord = typeof studentProfiles.$inferSelect;
