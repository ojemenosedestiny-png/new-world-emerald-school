import { pgTable, serial, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { portalClasses } from "./portal-classes";

/** Uploaded photos (gallery, student and staff portraits), stored privately in object storage. */
export const portalImages = pgTable("portal_images", {
  id: text("id").primaryKey(),
  objectName: text("object_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  purpose: text("purpose").notNull(),
  uploadedBy: text("uploaded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type PortalImageRecord = typeof portalImages.$inferSelect;

/** Gallery albums; a null class means the whole school. */
export const portalAlbums = pgTable("portal_albums", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  classId: integer("class_id").references(() => portalClasses.id, { onDelete: "cascade" }),
  published: boolean("published").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type PortalAlbumRecord = typeof portalAlbums.$inferSelect;

export const portalAlbumPhotos = pgTable("portal_album_photos", {
  id: serial("id").primaryKey(),
  albumId: integer("album_id").notNull().references(() => portalAlbums.id, { onDelete: "cascade" }),
  imageId: text("image_id").notNull().references(() => portalImages.id),
  caption: text("caption").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("portal_album_photos_album_idx").on(t.albumId)]);
