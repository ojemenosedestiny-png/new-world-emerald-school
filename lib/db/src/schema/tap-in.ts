import { pgTable, serial, integer, text, timestamp, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";
import { portalStudents } from "./portal-students";

/**
 * Card tap-in: the school's kiosk devices send each card tap here, and the portal marks the child's attendance.
 * A kiosk proves who it is with a secret key the office creates; only a hash of the key is kept.
 */
export const tapKiosks = pgTable("tap_kiosks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  keyHint: text("key_hint").notNull(),
  active: boolean("active").notNull().default(true),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdBy: text("created_by").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type TapKioskRecord = typeof tapKiosks.$inferSelect;

/** A student's card: the number the kiosk reads from it. A card belongs to one student; a student may have several. */
export const tapCards = pgTable("tap_cards", {
  id: serial("id").primaryKey(),
  cardId: text("card_id").notNull().unique(),
  studentId: integer("student_id").notNull().references(() => portalStudents.id, { onDelete: "cascade" }),
  createdBy: text("created_by").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("tap_cards_student").on(t.studentId)]);
export type TapCardRecord = typeof tapCards.$inferSelect;

/** Every tap a kiosk sent, with what the portal did about it (also how new, unassigned cards are found). */
export const tapEvents = pgTable("tap_events", {
  id: serial("id").primaryKey(),
  kioskId: integer("kiosk_id").references(() => tapKiosks.id, { onDelete: "set null" }),
  kioskName: text("kiosk_name").notNull().default(""),
  // The kiosk's own number for this tap, so a tap re-sent after a network failure is counted once.
  tapRef: text("tap_ref"),
  cardId: text("card_id").notNull().default(""),
  studentId: integer("student_id").references(() => portalStudents.id, { onDelete: "set null" }),
  tappedAt: timestamp("tapped_at", { withTimezone: true }).notNull(),
  date: text("date").notNull(),
  result: text("result").notNull(),
  message: text("message").notNull().default(""),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("tap_events_kiosk_ref").on(t.kioskId, t.tapRef),
  index("tap_events_received").on(t.receivedAt),
  index("tap_events_card").on(t.cardId),
]);
export type TapEventRecord = typeof tapEvents.$inferSelect;

/** One row of settings: after this time of day (school time, HH:MM) a first tap marks the child late. */
export const tapSettings = pgTable("tap_settings", {
  id: integer("id").primaryKey().default(1),
  lateAfter: text("late_after").notNull().default("08:00"),
  updatedBy: text("updated_by").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
