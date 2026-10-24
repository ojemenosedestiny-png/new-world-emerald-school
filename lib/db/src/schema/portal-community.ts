import { pgTable, serial, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { portalClasses } from "./portal-classes";

/** School calendar events; a null class means the whole school. */
export const portalEvents = pgTable("portal_events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  details: text("details").notNull().default(""),
  venue: text("venue").notNull().default(""),
  category: text("category").notNull().default("general"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  allDay: boolean("all_day").notNull().default(false),
  classId: integer("class_id").references(() => portalClasses.id, { onDelete: "cascade" }),
  published: boolean("published").notNull().default(false),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("portal_events_starts_idx").on(t.startsAt)]);
export type PortalEventRecord = typeof portalEvents.$inferSelect;
