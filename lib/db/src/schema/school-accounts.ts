import { pgTable, serial, text, bigint, timestamp, index } from "drizzle-orm/pg-core";

/**
 * The school's own cash book: money the bursar records by hand. Fee transfers, card payments and store orders are
 * read from their own tables and never copied here.
 * - direction "in": other income (donations, uniforms, bus, cash fees); counted as soon as it is recorded.
 * - direction "out": spending; "pending" until the school owner approves or rejects it.
 * Status: pending, approved, rejected, void (an approved entry the owner later cancelled, with a reason).
 */
export const schoolTransactions = pgTable("school_transactions", {
  id: serial("id").primaryKey(),
  direction: text("direction").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  // Who paid the school, or who the school paid.
  counterparty: text("counterparty").notNull().default(""),
  amountKobo: bigint("amount_kobo", { mode: "number" }).notNull(),
  // The day the money moved (YYYY-MM-DD, Lagos time).
  occurredOn: text("occurred_on").notNull(),
  // transfer, cash, pos, cheque
  method: text("method").notNull(),
  reference: text("reference").notNull().default(""),
  // Photo of the receipt or invoice (portal_images id, private).
  receiptImageId: text("receipt_image_id"),
  status: text("status").notNull(),
  recordedBy: text("recorded_by").notNull(),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [index("school_transactions_day").on(t.occurredOn), index("school_transactions_status").on(t.status)]);
export type SchoolTransactionRecord = typeof schoolTransactions.$inferSelect;
