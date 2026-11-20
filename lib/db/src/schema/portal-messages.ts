import { pgTable, serial, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { portalStudents } from "./portal-students";

/**
 * Messages between one student and the school. A thread is (student, channel), and for "teacher" also the teacher:
 * "class" reaches the student's class teachers (the office can read it too), "office" reaches the school office only,
 * "teacher" is private between the student and the one teacher they chose (other teachers never see it; the office
 * can read it to keep students safe).
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
  // The teacher a private ("teacher") conversation is with; empty for the class and office conversations.
  teacherId: integer("teacher_id"),
}, (t) => [index("portal_messages_thread").on(t.studentId, t.channel, t.createdAt), index("portal_messages_teacher").on(t.teacherId, t.studentId)]);
export type PortalMessageRecord = typeof portalMessages.$inferSelect;
