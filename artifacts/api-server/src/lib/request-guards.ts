import type { NextFunction, Request, Response } from "express";

/** The host names this request was addressed to (the Host header and any proxy's X-Forwarded-Host). */
function requestHosts(req: Request) {
  const forwarded = req.headers["x-forwarded-host"];
  return [req.headers.host, ...(typeof forwarded === "string" ? forwarded.split(",").map((h) => h.trim()) : [])].filter(Boolean) as string[];
}

/** True when the browser says the request came from this same site (or it is not a browser request at all). */
export function sameSiteRequest(req: Request) {
  const origin = req.headers.origin;
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  if (!origin) return true;
  try { return requestHosts(req).includes(new URL(origin).host); } catch { return false; }
}

/**
 * Blocks forged requests: a page on another website cannot make a signed-in visitor's browser change anything
 * here (submit, save, delete). Reading (GET) is unaffected. Webhooks from Clerk and Paystack are mounted
 * before this and are checked by their signatures instead.
 */
export function originGuard(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || sameSiteRequest(req)) return next();
  res.status(403).json({ error: "Cross-site requests are not allowed." });
}

/** CORS: only this site's own pages may read the API with the visitor's cookies; other websites get no access. */
export function corsOptions(req: Request, cb: (err: Error | null, options: { origin: boolean; credentials: boolean }) => void) {
  const origin = req.headers.origin;
  let allowed = false;
  if (origin) {
    try { allowed = requestHosts(req).includes(new URL(origin).host); } catch { allowed = false; }
  }
  cb(null, { origin: allowed, credentials: true });
}

/** How big a request body may be in items: generous for any real form (bulk enrolment, score sheets, exams). */
export const MAX_ARRAY_ITEMS = 5_000;
export const MAX_TOTAL_VALUES = 100_000;
export const MAX_DEPTH = 32;

/** Problems with the shape of a JSON body, or null. Walks it once without recursion limits being exceeded. */
export function bodyShapeProblem(body: unknown): string | null {
  let values = 0;
  const stack: [unknown, number][] = [[body, 0]];
  while (stack.length) {
    const [v, depth] = stack.pop()!;
    if (++values > MAX_TOTAL_VALUES) return "This request is too large.";
    if (depth > MAX_DEPTH) return "This request is nested too deeply.";
    if (Array.isArray(v)) {
      if (v.length > MAX_ARRAY_ITEMS) return "This request has too many items.";
      for (const x of v) stack.push([x, depth + 1]);
    } else if (v && typeof v === "object") {
      for (const x of Object.values(v)) stack.push([x, depth + 1]);
    }
  }
  return null;
}

/**
 * Refuses oversized JSON before any validation runs, so a flood of bad items cannot exhaust the server's memory
 * (validation builds one error per bad item). Runs after the JSON parser, which already caps the size in bytes.
 */
export function bodyShapeGuard(req: Request, res: Response, next: NextFunction) {
  const problem = req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) ? bodyShapeProblem(req.body) : null;
  if (problem) { res.status(413).json({ error: problem }); return; }
  next();
}
