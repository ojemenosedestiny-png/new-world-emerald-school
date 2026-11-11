import type { NextFunction, Request, Response } from "express";
import { clientIp } from "./audit-format";

/**
 * Limits for public forms that need no sign-in (admissions, store orders, fee reports), so a script cannot flood
 * the school's records or inboxes:
 * - per address: `perHour` from one connection;
 * - overall: `overallPerHour` from everyone together, so a script that fakes many addresses is still capped.
 * Kept in memory: a restart resets it.
 */
export function publicRateLimit(name: string, perHour: number, message: string, overallPerHour = perHour * 30) {
  const recent = new Map<string, number[]>();
  let overall: number[] = [];
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "POST") return next();
    const now = Date.now();
    const hourAgo = now - 3_600_000;
    overall = overall.filter((t) => t > hourAgo);
    const refuse = (why: string) => {
      res.setHeader("Retry-After", "3600");
      res.status(429).json({ error: message });
      req.log?.warn({ limit: name, why }, "Public form rate limit reached");
    };
    if (overall.length >= overallPerHour) return refuse("overall");
    const key = clientIp(req) ?? "unknown";
    // Forget addresses whose last send is over an hour old (never wipe live counts: that would reset the limit).
    if (recent.size > 10_000) for (const [k, t] of recent) if (!t.some((x) => x > hourAgo)) recent.delete(k);
    const times = (recent.get(key) ?? []).filter((t) => t > hourAgo);
    if (times.length >= perHour) { recent.set(key, times); return refuse("address"); }
    times.push(now);
    recent.set(key, times);
    overall.push(now);
    next();
  };
}
