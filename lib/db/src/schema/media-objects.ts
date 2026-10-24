import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

/** Website uploads stored on Cloudinary; the id is the one in /objects/uploads/<id>. */
export const mediaObjects = pgTable("media_objects", {
  id: text("id").primaryKey(),
  publicId: text("public_id").notNull(),
  resourceType: text("resource_type").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type MediaObjectRecord = typeof mediaObjects.$inferSelect;
