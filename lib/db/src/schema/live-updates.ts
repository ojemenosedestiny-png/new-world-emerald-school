import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const liveUpdatesTable = pgTable("live_updates", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  fileName: text("file_name").notNull(),
  objectPath: text("object_path").notNull(),
  contentType: text("content_type").notNull(),
  fileSize: integer("file_size").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertLiveUpdateSchema = createInsertSchema(liveUpdatesTable).omit({
  id: true,
  uploadedBy: true,
  publishedAt: true,
});

export type InsertLiveUpdate = z.infer<typeof insertLiveUpdateSchema>;
export type LiveUpdate = typeof liveUpdatesTable.$inferSelect;