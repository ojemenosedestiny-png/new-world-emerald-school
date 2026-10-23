import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { portalClasses } from "./portal-classes";
export const portalStudents = pgTable("portal_students", {
  id: serial("id").primaryKey(),
  studentId: text("student_id").notNull().unique(),
  name: text("name").notNull(),
  classId: integer("class_id").notNull().references(() => portalClasses.id),
  passwordHash: text("password_hash").notNull(),
  active: boolean("active").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});
export const insertPortalStudentSchema = createInsertSchema(portalStudents).omit({ id: true });
export type PortalStudentRecord = typeof portalStudents.$inferSelect;
