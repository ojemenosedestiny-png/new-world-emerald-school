import { pgTable, serial, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/** One fee item a parent chose to pay: a student (portal id) and the statement item key (class-12, charge-7). */
export type ParentPaymentSelection = { studentId: number; itemKey: string };
/** Money applied to one fee item when a payment succeeded. Names are copied so receipts survive later edits. */
export type ParentPaymentAllocation = {
  studentId: number; studentCode: string; studentName: string; className: string;
  itemKey: string; description: string; term: string; academicYear: string; amountKobo: number;
};

/**
 * A parent's school-fee payment. Card money comes through Paystack (cardKobo, checked server-to-server
 * before anything is applied); the parent's wallet is used first and any overpayment goes back into it.
 * Status: pending (waiting for Paystack), success, failed.
 */
export const parentPayments = pgTable("parent_payments", {
  id: serial("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  parentEmail: text("parent_email").notNull(),
  cardKobo: integer("card_kobo").notNull(),
  selection: jsonb("selection").$type<ParentPaymentSelection[]>().notNull(),
  status: text("status").notNull().default("pending"),
  allocations: jsonb("allocations").$type<ParentPaymentAllocation[]>().notNull().default([]),
  walletUsedKobo: integer("wallet_used_kobo").notNull().default(0),
  walletCreditKobo: integer("wallet_credit_kobo").notNull().default(0),
  channel: text("channel"),
  gatewayResponse: text("gateway_response"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
}, (t) => [index("parent_payments_email").on(t.parentEmail), index("parent_payments_status").on(t.status)]);
export type ParentPaymentRecord = typeof parentPayments.$inferSelect;

/** A parent's credit balance with the school, keyed by their email. Never negative. */
export const parentWallets = pgTable("parent_wallets", {
  email: text("email").primaryKey(),
  balanceKobo: integer("balance_kobo").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Every change to a wallet, so the balance can always be explained. */
export const parentWalletEntries = pgTable("parent_wallet_entries", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  amountKobo: integer("amount_kobo").notNull(),
  balanceAfterKobo: integer("balance_after_kobo").notNull(),
  kind: text("kind").notNull(),
  paymentReference: text("payment_reference"),
  note: text("note").notNull().default(""),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("parent_wallet_entries_email").on(t.email)]);
