import { createInsertSchema } from "drizzle-zod";
import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const admissionApplicationsTable = pgTable("admission_applications", {
  id: serial("id").primaryKey(),
  studentFirstName: text("student_first_name").notNull(),
  studentLastName: text("student_last_name").notNull(),
  grade: text("grade").notNull(),
  entryYear: text("entry_year").notNull(),
  guardianEmail: text("guardian_email").notNull(),
  guardianPhone: text("guardian_phone").notNull(),
  // Keys of the documents the family ticked as ready (birth certificate, medical report...); never the documents themselves.
  documentsReady: jsonb("documents_ready").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("new"),
  submittedAt: timestamp("submitted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertAdmissionApplicationSchema = createInsertSchema(
  admissionApplicationsTable,
).omit({ id: true, submittedAt: true, status: true });

export type InsertAdmissionApplication = z.infer<
  typeof insertAdmissionApplicationSchema
>;
export type AdmissionApplication =
  typeof admissionApplicationsTable.$inferSelect;