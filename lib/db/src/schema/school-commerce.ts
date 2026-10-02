import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const storeProductsTable = pgTable("store_products", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull(),
  variant: text("variant").notNull().default(""),
  priceKobo: integer("price_kobo").notNull(),
  stock: integer("stock"),
  imageUrl: text("image_url"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type StoreOrderLine = {
  productId: number;
  title: string;
  variant: string;
  quantity: number;
  unitPriceKobo: number;
  lineTotalKobo: number;
};

export const storeOrdersTable = pgTable(
  "store_orders",
  {
    id: serial("id").primaryKey(),
    reference: text("reference").notNull(),
    guardianName: text("guardian_name").notNull(),
    guardianEmail: text("guardian_email").notNull(),
    guardianPhone: text("guardian_phone").notNull(),
    studentName: text("student_name").notNull(),
    studentClass: text("student_class").notNull(),
    items: jsonb("items").$type<StoreOrderLine[]>().notNull(),
    totalKobo: integer("total_kobo").notNull(),
    orderNotes: text("order_notes").notNull().default(""),
    officeNote: text("office_note"),
    transferReference: text("transfer_reference"),
    orderStatus: text("order_status").notNull().default("new"),
    paymentStatus: text("payment_status").notNull().default("awaiting_payment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("store_orders_reference_unique").on(table.reference)],
);

export const classFeeSchedulesTable = pgTable(
  "class_fee_schedules",
  {
    id: serial("id").primaryKey(),
    className: text("class_name").notNull(),
    term: text("term").notNull(),
    academicYear: text("academic_year").notNull(),
    amountKobo: integer("amount_kobo").notNull(),
    description: text("description").notNull().default(""),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("class_fee_schedules_class_term_year_unique").on(
      table.className,
      table.term,
      table.academicYear,
    ),
  ],
);

export const individualFeeChargesTable = pgTable(
  "individual_fee_charges",
  {
    id: serial("id").primaryKey(),
    reference: text("reference").notNull(),
    studentName: text("student_name").notNull(),
    studentIdentifier: text("student_identifier").notNull(),
    className: text("class_name").notNull(),
    term: text("term").notNull(),
    academicYear: text("academic_year").notNull(),
    description: text("description").notNull(),
    amountKobo: integer("amount_kobo").notNull(),
    status: text("status").notNull().default("due"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("individual_fee_charges_reference_unique").on(table.reference)],
);

export const feePaymentReportsTable = pgTable(
  "fee_payment_reports",
  {
    id: serial("id").primaryKey(),
    reference: text("reference").notNull(),
    feeType: text("fee_type").notNull(),
    scheduleId: integer("schedule_id"),
    chargeId: integer("charge_id"),
    studentName: text("student_name").notNull(),
    studentIdentifier: text("student_identifier").notNull(),
    className: text("class_name").notNull(),
    term: text("term").notNull(),
    academicYear: text("academic_year").notNull(),
    description: text("description").notNull().default(""),
    amountKobo: integer("amount_kobo").notNull(),
    guardianName: text("guardian_name").notNull(),
    guardianEmail: text("guardian_email").notNull(),
    guardianPhone: text("guardian_phone").notNull(),
    transferReference: text("transfer_reference"),
    status: text("status").notNull().default("payment_requested"),
    officeNote: text("office_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("fee_payment_reports_reference_unique").on(table.reference)],
);

export const schoolCommerceSettingsTable = pgTable("school_commerce_settings", {
  id: text("id").primaryKey().default("school"),
  paymentInstructions: text("payment_instructions").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertStoreProductSchema = createInsertSchema(storeProductsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertStoreOrderSchema = createInsertSchema(storeOrdersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertClassFeeScheduleSchema = createInsertSchema(classFeeSchedulesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertIndividualFeeChargeSchema = createInsertSchema(individualFeeChargesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertFeePaymentReportSchema = createInsertSchema(feePaymentReportsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertStoreProduct = z.infer<typeof insertStoreProductSchema>;
export type StoreProduct = typeof storeProductsTable.$inferSelect;
export type StoreOrder = typeof storeOrdersTable.$inferSelect;
export type ClassFeeSchedule = typeof classFeeSchedulesTable.$inferSelect;
export type IndividualFeeCharge = typeof individualFeeChargesTable.$inferSelect;
export type FeePaymentReport = typeof feePaymentReportsTable.$inferSelect;