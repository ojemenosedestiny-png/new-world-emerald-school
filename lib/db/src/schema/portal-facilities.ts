import { pgTable, serial, text, integer, boolean, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { portalStudents } from "./portal-students";

/** A hostel building, for boys, girls or both. */
export const portalHostelBlocks = pgTable("portal_hostel_blocks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  gender: text("gender").notNull().default("mixed"),
  description: text("description").notNull().default(""),
  imageUrl: text("image_url").notNull().default(""),
});
export type PortalHostelBlockRecord = typeof portalHostelBlocks.$inferSelect;

/** A room in a block: how many bed spaces it has and its price per term. */
export const portalHostelRooms = pgTable("portal_hostel_rooms", {
  id: serial("id").primaryKey(),
  blockId: integer("block_id").notNull().references(() => portalHostelBlocks.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  beds: integer("beds").notNull(),
  priceKobo: integer("price_kobo").notNull().default(0),
  imageUrl: text("image_url").notNull().default(""),
  notes: text("notes").notNull().default(""),
}, (t) => [uniqueIndex("portal_hostel_rooms_block_name").on(t.blockId, t.name)]);
export type PortalHostelRoomRecord = typeof portalHostelRooms.$inferSelect;

/** A student's bed space; a student has at most one. */
export const portalHostelAllocations = pgTable("portal_hostel_allocations", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull().references(() => portalHostelRooms.id, { onDelete: "cascade" }),
  studentId: integer("student_id").notNull().unique().references(() => portalStudents.id, { onDelete: "cascade" }),
  bed: text("bed").notNull().default(""),
  allocatedAt: timestamp("allocated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type PortalHostelAllocationRecord = typeof portalHostelAllocations.$inferSelect;

export type TransportStop = { name: string; pickup: string; dropoff: string };
/** A school bus route with its stops and times, driver and vehicle, and fee per term. */
export const portalTransportRoutes = pgTable("portal_transport_routes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  stops: jsonb("stops").$type<TransportStop[]>().notNull().default([]),
  driverName: text("driver_name").notNull().default(""),
  driverPhone: text("driver_phone").notNull().default(""),
  vehicle: text("vehicle").notNull().default(""),
  plate: text("plate").notNull().default(""),
  feeKobo: integer("fee_kobo").notNull().default(0),
  notes: text("notes").notNull().default(""),
  active: boolean("active").notNull().default(true),
});
export type PortalTransportRouteRecord = typeof portalTransportRoutes.$inferSelect;

/** A student's route and the stop they use; a student has at most one route. */
export const portalTransportAssignments = pgTable("portal_transport_assignments", {
  id: serial("id").primaryKey(),
  routeId: integer("route_id").notNull().references(() => portalTransportRoutes.id, { onDelete: "cascade" }),
  studentId: integer("student_id").notNull().unique().references(() => portalStudents.id, { onDelete: "cascade" }),
  stop: text("stop").notNull().default(""),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
});
export type PortalTransportAssignmentRecord = typeof portalTransportAssignments.$inferSelect;
