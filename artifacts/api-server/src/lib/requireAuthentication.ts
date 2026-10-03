import type { Request, Response } from "express";

export function requireAuthentication(
  req: Request,
  res: Response,
): req is Request & { dbUser: NonNullable<Request["dbUser"]> } {
  if (!req.dbUser) {
    res.status(401).json({ error: "Authentication required" });
    return false;
  }
  return true;
}