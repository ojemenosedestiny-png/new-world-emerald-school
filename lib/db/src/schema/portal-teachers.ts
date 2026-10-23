import { pgTable, serial, text, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
export const portalTeachers = pgTable("portal_teachers", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  classIds: integer("class_ids").array().notNull(),
  active: boolean("active").notNull().default(true),
});
export const insertPortalTeacherSchema = createInsertSchema(portalTeachers).omit({ id: true });
export type PortalTeacherRecord = typeof portalTeachers.$inferSelect;
