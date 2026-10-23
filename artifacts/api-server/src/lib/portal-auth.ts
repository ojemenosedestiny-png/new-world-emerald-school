import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response, NextFunction } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db, portalStudents, portalSessions, portalTeachers, type PortalStudentRecord } from "@workspace/db";
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
}
const verifiedStaff = new Map<string, { email: string; until: number }>();
export async function portalActor(req: Request): Promise<PortalActor> {
  // Staff permissions are always rechecked, including after revocation.
  if (isWebsiteAdmin(req)) return { role: "admin", name: req.dbUser?.firstName || "School office", classIds: [], mustChangePassword: false };
  // An approved administrator without required two-factor gets no staff access until it is on.
  if (adminNeedsMfa(req)) return { role: "guest", name: "", classIds: [], mustChangePassword: false };
  if (req.dbUser) {
    const clerkId = getAuth(req).userId;
    if (clerkId) {
      let verified = verifiedStaff.get(clerkId);
      if (!verified || verified.until < Date.now()) {
        const user = await clerkClient.users.getUser(clerkId);
        const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
        if (primary?.verification?.status === "verified") {
          verified = { email: primary.emailAddress.toLowerCase(), until: Date.now() + 60_000 };
          if (verifiedStaff.size > 1000) verifiedStaff.clear();
          verifiedStaff.set(clerkId, verified);
        } else verified = undefined;
      }
      if (verified) {
        const [teacher] = await db.select().from(portalTeachers).where(and(eq(portalTeachers.email, verified.email), eq(portalTeachers.active, true)));
        if (teacher) return { role: "teacher", name: teacher.name, classIds: teacher.classIds, mustChangePassword: false };
      }
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
