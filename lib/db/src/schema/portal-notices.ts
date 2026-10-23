import { pgTable, serial, text, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { portalClasses } from "./portal-classes";
export const portalNotices = pgTable("portal_notices", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  classId: integer("class_id").notNull().references(() => portalClasses.id),
  published: boolean("published").notNull().default(false),
});
export const insertPortalNoticeSchema = createInsertSchema(portalNotices).omit({ id: true });
export type PortalNoticeRecord = typeof portalNotices.$inferSelect;
