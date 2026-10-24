import { pgTable, serial, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { portalStudents } from "./portal-students";

/**
 * Messages between one student and the school. A thread is (student, channel):
 * "class" reaches the student's class teachers (the office can read it too), "office" reaches the school office only.
 */
export const portalMessages = pgTable("portal_messages", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull().references(() => portalStudents.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  fromStaff: boolean("from_staff").notNull(),
  senderName: text("sender_name").notNull(),
  senderEmail: text("sender_email"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // When the other side opened the thread after this message arrived.
  readAt: timestamp("read_at", { withTimezone: true }),
}, (t) => [index("portal_messages_thread").on(t.studentId, t.channel, t.createdAt)]);
export type PortalMessageRecord = typeof portalMessages.$inferSelect;
