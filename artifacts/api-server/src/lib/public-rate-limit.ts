import type { NextFunction, Request, Response } from "express";
import { clientIp } from "./audit-format";

/**
 * Per-address limit for public forms that need no sign-in (admissions, store orders, fee reports),
 * so a script cannot flood the school's records or inboxes. Kept in memory: a restart resets it.
 */
export function publicRateLimit(name: string, perHour: number, message: string) {
  const recent = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "POST") return next();
    const now = Date.now();
    const key = clientIp(req) ?? "unknown";
    const times = (recent.get(key) ?? []).filter((t) => t > now - 3_600_000);
    if (recent.size > 10_000) recent.clear();
    if (times.length >= perHour) {
      recent.set(key, times);
      res.setHeader("Retry-After", "3600");
      res.status(429).json({ error: message });
      req.log?.warn({ limit: name }, "Public form rate limit reached");
      return;
    }
    times.push(now);
    recent.set(key, times);
    next();
  };
}
