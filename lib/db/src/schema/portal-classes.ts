import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
export const portalClasses = pgTable("portal_classes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});
export const insertPortalClassSchema = createInsertSchema(portalClasses).omit({ id: true });
export type PortalClassRecord = typeof portalClasses.$inferSelect;
