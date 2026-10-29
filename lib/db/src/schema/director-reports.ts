import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/** One row per week the Director's Monday report was sent, so it goes out once even with several servers. */
export const directorReports = pgTable("director_reports", {
  weekStart: text("week_start").primaryKey(), // Lagos date of that Monday, YYYY-MM-DD
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  recipients: text("recipients").notNull().default(""),
});

/** Every email the Director sends to staff: what, to whom, and how many were delivered. */
export const directorBroadcasts = pgTable("director_broadcasts", {
  id: serial("id").primaryKey(),
  audience: text("audience").notNull(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  recipients: integer("recipients").notNull(),
  sent: integer("sent").notNull(),
  failed: integer("failed").notNull(),
  sentBy: text("sent_by").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type DirectorBroadcastRecord = typeof directorBroadcasts.$inferSelect;
