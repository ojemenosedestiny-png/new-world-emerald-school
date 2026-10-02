import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const academicCalendarTable = pgTable("academic_calendar", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  weekStart: text("week_start").notNull(),
  weekEnd: text("week_end").notNull(),
  term: text("term").notNull(),
  fileName: text("file_name").notNull(),
  objectPath: text("object_path").notNull(),
  contentType: text("content_type").notNull(),
  fileSize: integer("file_size").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertAcademicCalendarSchema = createInsertSchema(
  academicCalendarTable,
).omit({ id: true, uploadedAt: true });

export type InsertAcademicCalendar = z.infer<
  typeof insertAcademicCalendarSchema
>;
export type AcademicCalendar = typeof academicCalendarTable.$inferSelect;