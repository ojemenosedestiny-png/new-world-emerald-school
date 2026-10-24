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
  // Parent or guardian who receives activation and password-reset links.
  guardianEmail: text("guardian_email"),
  // "pending" until the account is activated through its link; existing accounts are "active".
  accountStatus: text("account_status").notNull().default("active"),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  // Profile photo: the approved one students and staff see, and one awaiting staff approval.
  photoImageId: text("photo_image_id"),
  pendingPhotoImageId: text("pending_photo_image_id"),
});
export const insertPortalStudentSchema = createInsertSchema(portalStudents).omit({ id: true });
export type PortalStudentRecord = typeof portalStudents.$inferSelect;
