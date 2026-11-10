import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";

/**
 * The staff AI assistant's conversations. Each belongs to one person (their verified sign-in email) and only they
 * can open it. The assistant is a general helper: it is never given student records.
 */
export const assistantConversations = pgTable("assistant_conversations", {
  id: serial("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  title: text("title").notNull().default("New chat"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("assistant_conversations_owner").on(t.ownerEmail, t.updatedAt)]);

export const assistantMessages = pgTable("assistant_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => assistantConversations.id, { onDelete: "cascade" }),
  // "user" or "assistant"
  role: text("role").notNull(),
  content: text("content").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("assistant_messages_conversation").on(t.conversationId, t.id)]);
