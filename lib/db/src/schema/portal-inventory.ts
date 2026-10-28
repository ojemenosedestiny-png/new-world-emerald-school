import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { portalClasses } from "./portal-classes";

/** School stock: one row per kind of item (chairs, textbooks, lab kits). No class means school-wide stock. */
export const portalInventoryItems = pgTable("portal_inventory_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  location: text("location").notNull().default(""),
  unit: text("unit").notNull().default("pieces"),
  quantity: integer("quantity").notNull().default(0),
  // At or below this quantity the item shows as low stock; 0 turns the warning off.
  reorderLevel: integer("reorder_level").notNull().default(0),
  condition: text("condition").notNull().default("good"),
  classId: integer("class_id").references(() => portalClasses.id, { onDelete: "set null" }),
  notes: text("notes").notNull().default(""),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("portal_inventory_items_class").on(t.classId)]);
export type PortalInventoryItemRecord = typeof portalInventoryItems.$inferSelect;

/** Every change to an item's stock or condition, newest last; the item's history. */
export const portalInventoryMoves = pgTable("portal_inventory_moves", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull().references(() => portalInventoryItems.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  change: integer("change").notNull(),
  quantityAfter: integer("quantity_after").notNull(),
  note: text("note").notNull().default(""),
  actor: text("actor").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("portal_inventory_moves_item").on(t.itemId, t.createdAt)]);
export type PortalInventoryMoveRecord = typeof portalInventoryMoves.$inferSelect;
