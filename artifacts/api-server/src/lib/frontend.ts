import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import express, { type Express } from "express";
import { pageSeo, robotsTxt, sitemapXml, withPageSeo } from "./seo";

/** The school's edited website text and photos, as stored by the admin editor. */
export type SiteContentSnapshot = { revision: number; values: Record<string, string> };
type LoadSiteContent = () => Promise<SiteContentSnapshot | null>;

const CONTENT_TIMEOUT_MS = 400;
const CONTENT_CACHE_MS = 3_000;

/**
 * Puts the current site content into the page as a JSON data block (not a script, so the security
 * policy is unaffected), so the first paint already shows the school's own photos and words instead of
 * the built-in defaults. "<" is escaped so the content can never close the block early.
 */
export function withSiteContent(html: string, content: SiteContentSnapshot | null) {
  if (!content) return html;
  const json = JSON.stringify(content).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const block = `<script type="application/json" id="nwe-site-content">${json}</script>`;
  if (html.includes("</head>")) return html.replace("</head>", `${block}</head>`);
  return html.includes("<body") ? html.replace("<body", `${block}<body`) : html + block;
}

/**
 * Serves the built website from the API process, for single-service hosts such
 * as Render. Same-origin hosting keeps the Clerk session and the strict portal
 * cookie working without CORS. Replit serves the site separately and leaves
 * FRONTEND_DIST_DIR unset, so this does nothing there.
 */
export function serveFrontend(app: Express, dir = process.env.FRONTEND_DIST_DIR, loadSiteContent?: LoadSiteContent) {
  if (!dir) return false;
  const root = path.resolve(dir);
  const index = path.join(root, "index.html");
  if (!existsSync(index)) throw new Error(`FRONTEND_DIST_DIR has no index.html: ${root}`);
  // Vite fingerprints files in assets/, so they can be cached for a year.
  app.use("/assets", express.static(path.join(root, "assets"), { immutable: true, maxAge: "1y" }));
  // A missing build file must not fall back to the app shell (or log a stack trace).
  app.use("/assets", (_req, res) => { res.status(404).end(); });
  // Generated from the configured domain, ahead of any static copy in the build.
  app.get("/robots.txt", (_req, res) => { res.type("text/plain").setHeader("Cache-Control", "public, max-age=3600"); res.send(robotsTxt()); });
  app.get("/sitemap.xml", (_req, res) => { res.type("application/xml").setHeader("Cache-Control", "public, max-age=3600"); res.send(sitemapXml()); });
  app.use(express.static(root, { index: false, maxAge: "1h" }));
  const shell = readFileSync(index, "utf8");
  // A few seconds of caching keeps busy moments to one database read; edits still appear almost at once.
  let cached: { at: number; content: SiteContentSnapshot | null } | null = null;
  const currentContent = async () => {
    if (!loadSiteContent) return null;
    if (cached && Date.now() - cached.at < CONTENT_CACHE_MS) return cached.content;
    // A slow database must never hold the page up: fall back to the defaults, which update a moment later.
    const content = await Promise.race([
      loadSiteContent().catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), CONTENT_TIMEOUT_MS)),
    ]);
    if (content) cached = { at: Date.now(), content };
    return content;
  };
  // Client-side routes (/admin, /portal/exam/3, /sign-in/...) all load the app shell.
  app.use(async (req, res, next) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || req.path === "/api" || req.path.startsWith("/api/")) return next();
    res.setHeader("Cache-Control", "no-cache");
    // Signed-in areas are never indexed; an unknown address is a real 404 (the app still shows its not-found page).
    const seo = pageSeo(req.path);
    if (seo.kind !== "public") res.setHeader("X-Robots-Tag", "noindex, nofollow");
    if (seo.kind === "missing") res.status(404);
    res.type("html").send(withPageSeo(withSiteContent(shell, await currentContent()), seo));
  });
  return true;
}
