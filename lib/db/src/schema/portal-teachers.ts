import { pgTable, serial, text, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
export const portalTeachers = pgTable("portal_teachers", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  classIds: integer("class_ids").array().notNull(),
  active: boolean("active").notNull().default(true),
  // Public staff directory: role title and subjects only, never contact details.
  title: text("title").notNull().default(""),
  subjects: text("subjects").array().notNull().default([]),
  showInDirectory: boolean("show_in_directory").notNull().default(true),
  photoFileId: text("photo_file_id"),
});
export const insertPortalTeacherSchema = createInsertSchema(portalTeachers).omit({ id: true });
export type PortalTeacherRecord = typeof portalTeachers.$inferSelect;
