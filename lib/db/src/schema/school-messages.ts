import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Emails the Director or the Head of School send to teachers and parents. Each recipient gets their own private copy
 * (never a group email); replies go to the sender.
 */
export const schoolMessages = pgTable("school_messages", {
  id: serial("id").primaryKey(),
  senderEmail: text("sender_email").notNull(),
  senderName: text("sender_name").notNull(),
  // "director" or "head"
  senderRole: text("sender_role").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  recipients: integer("recipients").notNull(),
  sent: integer("sent").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  // "sending" until every copy is tried, then "done"
  status: text("status").notNull().default("sending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});
export type SchoolMessageRecord = typeof schoolMessages.$inferSelect;

export const schoolMessageRecipients = pgTable("school_message_recipients", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull().references(() => schoolMessages.id, { onDelete: "cascade" }),
  // "teacher" or "parent"
  kind: text("kind").notNull(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  // How the email opens, e.g. "Dear Mrs Eze" or "Dear Parent of Ada Obi"
  greeting: text("greeting").notNull(),
  // "pending", "sent" or "failed"
  status: text("status").notNull().default("pending"),
  detail: text("detail").notNull().default(""),
  sentAt: timestamp("sent_at", { withTimezone: true }),
}, (t) => [index("school_message_recipients_message").on(t.messageId), index("school_message_recipients_status").on(t.status)]);
export type SchoolMessageRecipientRecord = typeof schoolMessageRecipients.$inferSelect;
