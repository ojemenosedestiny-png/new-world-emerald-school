import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response, NextFunction } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db, portalStudents, portalSessions, portalSubjects, portalTeachers, type PortalStudentRecord } from "@workspace/db";
import { adminNeedsMfa, isWebsiteAdmin } from "./website-admin";
import { clerkClient, getAuth } from "@clerk/express";

const scrypt = promisify(scryptCallback);
export const portalCookie = "school_portal";
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export async function hashPassword(password: string) {
  const salt = randomBytes(24).toString("hex");
  const key = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  const key = await scrypt(password, salt, 64) as Buffer;
  const expected = Buffer.from(digest, "hex");
  return expected.length === key.length && timingSafeEqual(expected, key);
}
export function sessionToken(req: Request) {
  return req.headers.cookie?.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${portalCookie}=`))?.slice(portalCookie.length + 1) ?? "";
}
export function setPortalCookie(req: Request, res: Response, token: string) {
  res.cookie(portalCookie, token, {
    httpOnly: true, secure: req.secure || req.headers["x-forwarded-proto"] === "https",
    sameSite: "strict", path: "/api/portal", maxAge: 12 * 60 * 60 * 1000,
  });
}
export class PortalError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function check(condition: unknown, message: string, status = 400): asserts condition {
  if (!condition) throw new PortalError(status, message);
}
export interface PortalActor {
  role: "guest" | "student" | "teacher" | "admin";
  name: string;
  classIds: number[];
  mustChangePassword: boolean;
  student?: PortalStudentRecord;
  /** The teacher record, for teachers. */
  teacherId?: number;
  /** The subjects a teacher teaches, and in which classes (set by the principal). */
  teaching?: { classId: number; subject: string }[];
}
/** Subject names compared loosely: "Basic Science", "basic science" and "Basic-Science" are the same subject. */
export const subjectKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** A teacher teaches this exam's subject in this exam's class. */
export function teachesExam(actor: Pick<PortalActor, "teaching">, exam: { classId: number; subject?: string | null }) {
  const key = exam.subject ? subjectKey(exam.subject) : "";
  return !!key && (actor.teaching ?? []).some((t) => t.classId === exam.classId && subjectKey(t.subject) === key);
}
const verifiedStaff = new Map<string, { email: string; until: number }>();
/**
 * The signed-in person's primary email, lowercased, only once they have confirmed it with Clerk; otherwise null.
 * Looked up from Clerk (not the session claims) and cached for a minute. Used for teachers and parents.
 */
// Tests sign staff in without Clerk by replacing this lookup; it is never set in the running site.
let staffEmailForTest: ((req: Request) => Promise<string | null>) | null = null;
export function setStaffEmailResolverForTest(fn: ((req: Request) => Promise<string | null>) | null) { staffEmailForTest = fn; }
export async function verifiedClerkEmail(req: Request): Promise<string | null> {
  if (staffEmailForTest) return staffEmailForTest(req);
  if (!req.dbUser) return null;
  const clerkId = getAuth(req).userId;
  if (!clerkId) return null;
  let verified = verifiedStaff.get(clerkId);
  if (!verified || verified.until < Date.now()) {
    const user = await clerkClient.users.getUser(clerkId);
    const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
    if (primary?.verification?.status !== "verified") return null;
    verified = { email: primary.emailAddress.toLowerCase(), until: Date.now() + 60_000 };
    if (verifiedStaff.size > 1000) verifiedStaff.clear();
    verifiedStaff.set(clerkId, verified);
  }
  return verified.email;
}
export async function portalActor(req: Request): Promise<PortalActor> {
  // Staff permissions are always rechecked, including after revocation.
  if (isWebsiteAdmin(req)) return { role: "admin", name: req.dbUser?.firstName || "School office", classIds: [], mustChangePassword: false };
  // An approved administrator without required two-factor gets no staff access until it is on.
  if (adminNeedsMfa(req)) return { role: "guest", name: "", classIds: [], mustChangePassword: false };
  const email = await verifiedClerkEmail(req);
  if (email) {
    const [teacher] = await db.select().from(portalTeachers).where(and(eq(portalTeachers.email, email), eq(portalTeachers.active, true)));
    if (teacher) {
      const teaching = await db.select({ classId: portalSubjects.classId, subject: portalSubjects.name }).from(portalSubjects).where(eq(portalSubjects.teacherId, teacher.id));
      return { role: "teacher", name: teacher.name, classIds: teacher.classIds, mustChangePassword: false, teacherId: teacher.id, teaching };
    }
  }
  const token = sessionToken(req);
  if (/^[a-f0-9]{64}$/.test(token)) {
    const [row] = await db.select({ student: portalStudents }).from(portalSessions)
      .innerJoin(portalStudents, eq(portalStudents.id, portalSessions.studentId))
      .where(and(eq(portalSessions.tokenHash, hashToken(token)), gt(portalSessions.expiresAt, new Date()), eq(portalStudents.active, true)));
    if (row) return { role: "student", name: row.student.name, classIds: [row.student.classId], mustChangePassword: row.student.mustChangePassword, student: row.student };
  }
  return { role: "guest", name: "", classIds: [], mustChangePassword: false };
}
export function studentOnly(actor: PortalActor) {
  check(actor.role === "student" && actor.student, "Sign in with your student ID.", 401);
  check(!actor.mustChangePassword, "Change your temporary password before continuing.", 403);
  return actor.student;
}
export function staffOnly(actor: PortalActor) {
  check(actor.role === "admin" || actor.role === "teacher", "Approved staff access required.", actor.role === "guest" ? 401 : 403);
}
/**
 * May this staff member manage this exam? The office always; a teacher for exams in their own classes, and for any
 * exam they set themselves (teachers may set exams for any class, not only the ones assigned to them).
 */
export function examAllowed(actor: PortalActor, exam: { classId: number; createdByTeacherId: number | null; subject?: string | null }) {
  staffOnly(actor);
  // The office; the class teacher; whoever set it; and every teacher who teaches that subject in that class.
  check(actor.role === "admin" || actor.classIds.includes(exam.classId) || (!!actor.teacherId && exam.createdByTeacherId === actor.teacherId) || teachesExam(actor, exam),
    "This exam belongs to another teacher's class.", 403);
}
export function classAllowed(actor: PortalActor, classId: number) {
  staffOnly(actor);
  check(actor.role === "admin" || actor.classIds.includes(classId), "This class is not assigned to you.", 403);
}
// Same-site cookies are supplemented by Origin checks for all state changes,
// including staff Clerk requests and login CSRF.
export function portalOriginGuard(req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.origin;
    const host = req.headers.host;
    const forwarded = req.headers["x-forwarded-host"];
    const hosts = [host, ...(typeof forwarded === "string" ? forwarded.split(",").map((h) => h.trim()) : [])];
    try {
      if (origin && !hosts.includes(new URL(origin).host)) {
        res.status(403).json({ error: "Cross-site portal requests are not allowed." }); return;
      }
      if (req.headers["sec-fetch-site"] === "cross-site") {
        res.status(403).json({ error: "Cross-site portal requests are not allowed." }); return;
      }
    } catch {
      res.status(403).json({ error: "Invalid request origin." }); return;
    }
  }
  next();
}
