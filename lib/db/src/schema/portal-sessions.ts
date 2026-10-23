import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { portalStudents } from "./portal-students";
export const portalSessions = pgTable("portal_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  studentId: integer("student_id").notNull().references(() => portalStudents.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  // Shown to staff when reviewing or ending a student's sessions.
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  ip: text("ip"),
  userAgent: text("user_agent"),
}, (t) => [index("portal_sessions_student_idx").on(t.studentId)]);
export const insertPortalSessionSchema = createInsertSchema(portalSessions);
export type PortalSessionRecord = typeof portalSessions.$inferSelect;
