import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * The school's bank accounts parents pay into by transfer. School fees and WAEC/NECO registration go to different
 * accounts, and each can change from one academic session to the next ("" means every session).
 */
export const paymentAccounts = pgTable("payment_accounts", {
  id: serial("id").primaryKey(),
  // "school_fees" or "exam_registration"
  purpose: text("purpose").notNull(),
  // e.g. "2026/2027"; empty for every session
  academicYear: text("academic_year").notNull().default(""),
  bankName: text("bank_name").notNull(),
  accountName: text("account_name").notNull(),
  accountNumber: text("account_number").notNull(),
  note: text("note").notNull().default(""),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type PaymentAccountRecord = typeof paymentAccounts.$inferSelect;
