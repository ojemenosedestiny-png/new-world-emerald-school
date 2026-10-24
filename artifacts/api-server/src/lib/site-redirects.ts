import type { NextFunction, Request, Response } from "express";

// Pages from the old WordPress site, sent to their place on the new site so saved
// links and search results keep working after the domain moves here.
const LEGACY_PAGES: Record<string, string> = {
  "/home": "/",
  "/about-us": "/#about", "/our-team": "/#about", "/team-single-02": "/#about", "/secondary": "/#academics",
  "/faqs": "/#admissions", "/student-registration": "/#admissions", "/contact": "/#admissions", "/contact-us": "/#admissions",
  "/blog": "/#news", "/event": "/#news", "/events": "/#news", "/a-guide-for-teachers-and-education-staff": "/#news",
  "/shop": "/commerce", "/cart": "/commerce", "/checkout": "/commerce", "/wishlist": "/commerce",
  "/my-account": "/portal", "/dashboard": "/portal", "/lp-profile": "/portal", "/my-courses": "/portal",
  "/courses": "/portal", "/courses-overview": "/portal", "/course-completed": "/portal", "/lp-checkout": "/portal",
  "/instructors": "/portal/manage", "/instructor": "/portal/manage", "/instructor-registration": "/portal/manage", "/lp-become-a-teacher": "/portal/manage",
};
// Whole groups of old addresses: posts, categories, theme demo pages and WordPress internals.
const LEGACY_PREFIXES: [RegExp, string][] = [
  [/^\/(category|tag|event|events|blog)\//, "/#news"],
  [/^\/(course|courses|lp-course)[-/]/, "/portal"],
  [/^\/(lp-|wp-|pricing-table|team-single|demo|sample-page|feed|xmlrpc\.php|eb_)/, "/"],
];

/** Where an old WordPress address now lives, or null for the new site's own pages. */
export function legacyRedirect(rawPath: string): string | null {
  const path = rawPath.toLowerCase().replace(/\/+$/, "") || "/";
  if (path === "/") return null;
  if (LEGACY_PAGES[path]) return LEGACY_PAGES[path];
  for (const [pattern, target] of LEGACY_PREFIXES) if (pattern.test(path + "/")) return target;
  return null;
}

/**
 * Sends visitors on the Render address to the school's domain, so search engines index
 * one site. Only when FORWARD_TO_DOMAIN=true: switch it on after the domain shows this
 * site, never before (PUBLIC_SITE_URL may be set earlier for email links). API calls are left alone.
 */
export function primaryHostRedirect(host: string | undefined, originalUrl: string, publicSiteUrl = process.env.PUBLIC_SITE_URL, enabled = process.env.FORWARD_TO_DOMAIN === "true"): string | null {
  if (!enabled || !host || !publicSiteUrl) return null;
  let primary: URL;
  try { primary = new URL(publicSiteUrl); } catch { return null; }
  const requestHost = host.toLowerCase().split(":")[0];
  if (requestHost === primary.hostname.toLowerCase() || !requestHost.endsWith(".onrender.com")) return null;
  return primary.origin + originalUrl;
}

export function siteRedirects() {
  return (req: Request, res: Response, next: NextFunction) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || req.path === "/api" || req.path.startsWith("/api/")) return next();
    const elsewhere = primaryHostRedirect(req.headers.host, req.originalUrl);
    if (elsewhere) { res.redirect(301, elsewhere); return; }
    const moved = legacyRedirect(req.path);
    if (moved) { res.redirect(301, moved); return; }
    next();
  };
}
