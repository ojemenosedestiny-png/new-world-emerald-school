import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const siteContentTable = pgTable("site_content", {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  values: jsonb("values").$type<Record<string, string>>().notNull().default({}),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});