import type { Request, Response } from "express";

export function requireAuthentication(
  req: Request,
  res: Response,
): req is Request & { user: Express.User } {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Authentication required" });
    return false;
  }
  return true;
}