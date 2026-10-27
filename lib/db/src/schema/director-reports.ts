import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** One row per week the Director's Monday report was sent, so it goes out once even with several servers. */
export const directorReports = pgTable("director_reports", {
  weekStart: text("week_start").primaryKey(), // Lagos date of that Monday, YYYY-MM-DD
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  recipients: text("recipients").notNull().default(""),
});
