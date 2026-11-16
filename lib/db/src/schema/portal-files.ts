import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { portalClasses } from "./portal-classes";
export const portalFiles = pgTable("portal_files", {
  id: text("id").primaryKey(),
  // Null for a whole-school document, such as an exam timetable for every class.
  classId: integer("class_id").references(() => portalClasses.id),
  objectName: text("object_name").notNull(),
  // The teacher who uploaded it (exam papers and diagrams): they may open it even in a class they do not teach.
  uploadedByTeacherId: integer("uploaded_by_teacher_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertPortalFileSchema = createInsertSchema(portalFiles).omit({ createdAt: true });
export type PortalFileRecord = typeof portalFiles.$inferSelect;
