import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { portalClasses } from "./portal-classes";
export const portalFiles = pgTable("portal_files", {
  id: text("id").primaryKey(),
  classId: integer("class_id").notNull().references(() => portalClasses.id),
  objectName: text("object_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertPortalFileSchema = createInsertSchema(portalFiles).omit({ createdAt: true });
export type PortalFileRecord = typeof portalFiles.$inferSelect;
