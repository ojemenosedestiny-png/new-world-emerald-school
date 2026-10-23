import type { Request } from "express";

// Database-free helpers so they can be unit tested on their own.
const SECRET_KEY = /pass(word)?|token|secret|hash|api[-_]?key|authorization|cookie/i;

/** Copies a value for the audit log: secrets redacted, long text and large arrays shortened. */
export function sanitizeForAudit(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 500 ? value.slice(0, 500) + "…" : value;
  if (value instanceof Date) return value.toISOString();
  if (depth > 5) return "[nested]";
  if (Array.isArray(value)) {
    const items = value.slice(0, 50).map((v) => sanitizeForAudit(v, depth + 1));
    return value.length > 50 ? [...items, `[+${value.length - 50} more]`] : items;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SECRET_KEY.test(k) ? (v ? "[redacted]" : v) : sanitizeForAudit(v, depth + 1);
    return out;
  }
  return String(value);
}

export function clientIp(req: Request) {
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return (first || req.ip || req.socket.remoteAddress || "").slice(0, 64) || null;
}
