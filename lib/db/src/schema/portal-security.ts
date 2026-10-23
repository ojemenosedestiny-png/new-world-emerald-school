import { pgTable, serial, text, integer, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { portalStudents } from "./portal-students";

// Append-only record of staff actions and security events. No route updates or deletes rows.
export const portalAuditLog = pgTable("portal_audit_log", {
  id: serial("id").primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actorKind: text("actor_kind").notNull(), // staff | student | system
  actorId: text("actor_id"),
  actorLabel: text("actor_label").notNull().default(""),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  outcome: text("outcome").notNull().default("success"), // success | denied | failed
  status: integer("status"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  before: jsonb("before"),
  after: jsonb("after"),
}, (t) => [index("portal_audit_log_at_idx").on(t.at), index("portal_audit_log_actor_idx").on(t.actorId)]);
export type PortalAuditRecord = typeof portalAuditLog.$inferSelect;

export const portalLoginEvents = pgTable("portal_login_events", {
  id: serial("id").primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  studentId: integer("student_id").references(() => portalStudents.id, { onDelete: "cascade" }),
  studentCode: text("student_code").notNull(),
  success: boolean("success").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
}, (t) => [index("portal_login_events_student_idx").on(t.studentId, t.at)]);
export type PortalLoginEventRecord = typeof portalLoginEvents.$inferSelect;
