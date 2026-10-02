import type { NextFunction, Request, Response } from "express";

export function isWebsiteAdmin(req: Request): boolean {
  if (!req.isAuthenticated() || !req.user.email) return false;
  const approved = (process.env.SCHOOL_ADMIN_EMAILS ?? "")
    .split(/[,;\s]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return approved.includes(req.user.email.trim().toLowerCase());
}

export function requireWebsiteAdmin(req: Request, res: Response): boolean {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to manage the website." });
    return false;
  }
  if (!isWebsiteAdmin(req)) {
    res.status(403).json({ error: "This account is not an approved website administrator." });
    return false;
  }
  return true;
}

// Central protection applies to existing routes as well as new editors.
// Public content, admission submissions and parent order/payment requests remain public.
export function protectWebsiteManagement(req: Request, res: Response, next: NextFunction) {
  // Express routes are case-insensitive unless explicitly configured otherwise.
  const path = req.path.replace(/\/+$/, "").toLowerCase() || "/";
  const method = req.method === "HEAD" ? "GET" : req.method;
  const read = method === "GET";
  let privateRequest = false;

  if (path.startsWith("/admission-applications")) privateRequest = method !== "POST";
  if (path.startsWith("/academic-calendar") || path.startsWith("/live-updates")) privateRequest = !read;
  if (path === "/storage/uploads/request-url") privateRequest = true;
  if (path === "/site-content") privateRequest = !read;
  if (path.startsWith("/school-commerce/")) {
    const publicRead = read && (
      ["/school-commerce/products", "/school-commerce/fee-schedules", "/school-commerce/settings"].includes(path) ||
      /^\/school-commerce\/individual-charges\/lookup\/[^/]+$/.test(path)
    );
    const publicSubmission = method === "POST" &&
      ["/school-commerce/orders", "/school-commerce/fee-reports"].includes(path);
    privateRequest = !publicRead && !publicSubmission;
  }
  if (privateRequest && !requireWebsiteAdmin(req, res)) return;
  next();
}