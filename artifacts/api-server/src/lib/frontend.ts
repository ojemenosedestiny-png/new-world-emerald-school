import path from "node:path";
import { existsSync } from "node:fs";
import express, { type Express } from "express";

/**
 * Serves the built website from the API process, for single-service hosts such
 * as Render. Same-origin hosting keeps the Clerk session and the strict portal
 * cookie working without CORS. Replit serves the site separately and leaves
 * FRONTEND_DIST_DIR unset, so this does nothing there.
 */
export function serveFrontend(app: Express, dir = process.env.FRONTEND_DIST_DIR) {
  if (!dir) return false;
  const root = path.resolve(dir);
  const index = path.join(root, "index.html");
  if (!existsSync(index)) throw new Error(`FRONTEND_DIST_DIR has no index.html: ${root}`);
  // Vite fingerprints files in assets/, so they can be cached for a year.
  app.use("/assets", express.static(path.join(root, "assets"), { immutable: true, maxAge: "1y" }));
  // A missing build file must not fall back to the app shell (or log a stack trace).
  app.use("/assets", (_req, res) => { res.status(404).end(); });
  app.use(express.static(root, { index: false, maxAge: "1h" }));
  // Client-side routes (/admin, /portal/exam/3, /sign-in/...) all load the app shell.
  app.use((req, res, next) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || req.path === "/api" || req.path.startsWith("/api/")) return next();
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(index);
  });
  return true;
}
