import type { NextFunction, Request, Response } from "express";

export function isWebsiteAdmin(req: Request): boolean {
  if (!req.dbUser || !req.identity?.email || !req.identity.emailVerified) return false;
  const approved = (process.env.SCHOOL_ADMIN_EMAILS ?? "")
    .split(/[,;\s]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return approved.includes(req.identity.email.trim().toLowerCase());
}

export function requireWebsiteAdmin(req: Request, res: Response): boolean {
  if (!req.dbUser) {
    res.status(401).json({ error: "Sign in to manage the website." });
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
const publicSubmissions = ["/admission-applications", "/school-commerce/orders", "/school-commerce/fee-reports"];

export function isPublicWebsiteRequest(method: string, rawPath: string): boolean {
  // Express routes are case-insensitive unless explicitly configured otherwise.
  const path = rawPath.replace(/\/+$/, "").toLowerCase() || "/";
  const normalizedMethod = method === "HEAD" ? "GET" : method;
  if (normalizedMethod === "GET") return publicReads.includes(path) || publicReadPatterns.some((pattern) => pattern.test(path));
  if (normalizedMethod === "POST") return publicSubmissions.includes(path);
  return false;
}

// Central protection applies to existing routes as well as new editors.
export function protectWebsiteManagement(req: Request, res: Response, next: NextFunction) {
  if (!isPublicWebsiteRequest(req.method, req.path) && !requireWebsiteAdmin(req, res)) return;
  next();
}