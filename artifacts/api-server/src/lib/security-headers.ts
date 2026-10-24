import express, { type Express, type Request, type RequestHandler } from "express";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware";

/**
 * Content Security Policy for the website and API. Clerk's frontend API lives on
 * *.clerk.accounts.dev (development keys) or clerk.<site domain> (production keys).
 * Uploads go straight to Google Cloud Storage with signed URLs.
 */
export function contentSecurityPolicy(host: string | undefined) {
  const hostname = (host ?? "").toLowerCase().replace(/:\d+$/, "");
  const clerk = ["https://*.clerk.accounts.dev", "https://*.clerk.com", ...(hostname ? [`https://clerk.${hostname}`] : [])];
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", ...clerk, "https://challenges.cloudflare.com"],
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
    "img-src": ["'self'", "data:", "blob:", "https://img.clerk.com", "https://storage.googleapis.com", "https://res.cloudinary.com"],
    "media-src": ["'self'", "blob:", "https://storage.googleapis.com", "https://res.cloudinary.com"],
    // Big videos upload from the browser straight to Cloudinary.
    "connect-src": ["'self'", ...clerk, "https://clerk-telemetry.com", "https://storage.googleapis.com", "https://api.cloudinary.com"],
    // Live updates can embed YouTube's privacy-enhanced player.
    "frame-src": ["'self'", "https://challenges.cloudflare.com", ...clerk, "https://www.youtube-nocookie.com"],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    // Exam papers are shown in a same-site frame, so framing by our own pages is allowed.
    "frame-ancestors": ["'self'"],
    "report-uri": ["/api/csp-report"],
  };
  return Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`).join("; ");
}

/**
 * Baseline security headers on every response. The CSP is report-only until reports
 * confirm nothing legitimate is blocked; set CSP_ENFORCE=true to enforce it.
 */
export function securityHeaders(enforceCsp = process.env.CSP_ENFORCE === "true"): RequestHandler {
  return (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    if (req.secure || req.headers["x-forwarded-proto"] === "https") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    res.setHeader(enforceCsp ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only", contentSecurityPolicy(getClerkProxyHost(req)));
    next();
  };
}

/** Receives browser CSP violation reports and logs a bounded summary. */
export function mountCspReports(app: Express) {
  let recent = 0;
  let windowStart = Date.now();
  app.post("/api/csp-report", express.json({ type: ["application/csp-report", "application/json", "application/reports+json"], limit: "16kb" }), (req: Request, res) => {
    const now = Date.now();
    if (now - windowStart > 60_000) { windowStart = now; recent = 0; }
    if (++recent <= 30) {
      const body = req.body as { "csp-report"?: Record<string, unknown> } | Record<string, unknown>[] | undefined;
      const report = Array.isArray(body) ? (body[0]?.body as Record<string, unknown> | undefined) : body?.["csp-report"];
      req.log.warn({ csp: report ? {
        directive: report["violated-directive"] ?? report.effectiveDirective,
        blocked: report["blocked-uri"] ?? report.blockedURL,
        page: String(report["document-uri"] ?? report.documentURL ?? "").split("?")[0],
      } : "unparsed" }, "CSP violation report");
    }
    res.status(204).end();
  });
}
