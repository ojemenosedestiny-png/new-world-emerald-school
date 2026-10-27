import type { NextFunction, Request, Response } from "express";
import { adminMfaRequired, approvedEmails, directorEmails, superAdminEmails } from "./approved-identities";

/** Approved, verified administrator email, before any two-factor requirement. */
function isApprovedAdmin(req: Request): boolean {
  if (!req.dbUser || !req.identity?.email || !req.identity.emailVerified) return false;
  return approvedEmails().includes(req.identity.email.trim().toLowerCase());
}

export function isWebsiteAdmin(req: Request): boolean {
  return isApprovedAdmin(req) && (!adminMfaRequired() || req.identity?.mfa === true);
}

/** An approved administrator who must turn on two-factor authentication before access. */
export function adminNeedsMfa(req: Request): boolean {
  return isApprovedAdmin(req) && adminMfaRequired() && req.identity?.mfa !== true;
}

export function isSuperAdmin(req: Request): boolean {
  return isWebsiteAdmin(req) && superAdminEmails().includes(req.identity!.email!.trim().toLowerCase());
}

/** The school Director (SCHOOL_DIRECTOR_EMAILS): sole access to the Director dashboard and weekly report. */
export function isDirector(req: Request): boolean {
  return isWebsiteAdmin(req) && directorEmails().includes(req.identity!.email!.trim().toLowerCase());
}

export function requireWebsiteAdmin(req: Request, res: Response): boolean {
  if (!req.dbUser) {
    res.status(401).json({ error: req.identityError ?? "Sign in to manage the website." });
    return false;
  }
  if (adminNeedsMfa(req)) {
    res.status(403).json({ error: "Turn on two-factor authentication for your account to manage the website." });
    return false;
  }
  if (!isWebsiteAdmin(req)) {
    res.status(403).json({ error: "This account is not an approved website administrator." });
    return false;
  }
  return true;
}

// Public website endpoints. Everything else requires an approved administrator, so a
// new route is private until it is deliberately added here (fail closed).
// Routes that only need a signed-in account (e.g. /account) check that themselves.
const publicReads = [
  "/healthz",
  "/account",
  "/website-admin/access",
  "/site-content",
  "/academic-calendar",
  "/live-updates",
  "/school-commerce/products",
  "/school-commerce/fee-schedules",
  "/school-commerce/settings",
];
const publicReadPatterns = [
  /^\/school-commerce\/individual-charges\/lookup\/[^/]+$/,
  /^\/storage\/public-objects\/.+$/,
  /^\/storage\/objects\/.+$/,
];
// Admission submissions and parent order/payment reports.
const publicSubmissions = [
  "/admission-applications", "/school-commerce/orders", "/school-commerce/fee-reports",
  // Parents' payment screenshots: images only, size-capped and rate-limited in the route.
  "/school-commerce/payment-proofs", "/school-commerce/payment-proofs/attach",
];

export function isPublicWebsiteRequest(method: string, rawPath: string): boolean {
  // Express routes are case-insensitive unless explicitly configured otherwise.
  const path = rawPath.replace(/\/+$/, "").toLowerCase() || "/";
  const normalizedMethod = method === "HEAD" ? "GET" : method;
  if (normalizedMethod === "GET") return publicReads.includes(path) || publicReadPatterns.some((pattern) => pattern.test(path));
  if (normalizedMethod === "POST") return publicSubmissions.includes(path);
  // Cloudinary uploads: the browser sends the file without cookies to a signed address,
  // and the route itself verifies that signature (see routes/storage.ts).
  if (normalizedMethod === "PUT") return /^\/storage\/uploads\/[a-z0-9_-]+\.[a-z0-9_-]+$/.test(path);
  return false;
}

// Central protection applies to existing routes as well as new editors.
export function protectWebsiteManagement(req: Request, res: Response, next: NextFunction) {
  if (!isPublicWebsiteRequest(req.method, req.path) && !requireWebsiteAdmin(req, res)) return;
  next();
}