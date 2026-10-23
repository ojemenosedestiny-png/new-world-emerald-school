import { pgTable, serial, text, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { portalClasses } from "./portal-classes";
export const portalMaterials = pgTable("portal_materials", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  subject: text("subject").notNull(),
  classId: integer("class_id").notNull().references(() => portalClasses.id),
  body: text("body").notNull().default(""),
  fileId: text("file_id"),
  published: boolean("published").notNull().default(false),
});
export const insertPortalMaterialSchema = createInsertSchema(portalMaterials).omit({ id: true });
export type PortalMaterialRecord = typeof portalMaterials.$inferSelect;
