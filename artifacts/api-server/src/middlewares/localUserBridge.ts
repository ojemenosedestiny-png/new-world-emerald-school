import { getAuth } from "@clerk/express";
import { db, usersTable, type User } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { hasVerifiedApproval } from "../lib/approved-identities";
import { schoolUserId } from "../lib/school-identity";

declare global {
  namespace Express {
    interface Request {
      dbUser?: User;
      identity?: { email: string | null; emailVerified: boolean };
    }
  }
}

export async function localUserBridge(req: Request, res: Response, next: NextFunction) {
  try {
    const auth = getAuth(req);
    if (!auth.userId) return next();
    // This is the original subject ID for migrated users, not Clerk's native ID.
    const userId = schoolUserId(auth.sessionClaims);
    if (!userId) {
      res.status(401).json({ error: "Account identity could not be resolved." });
      return;
    }
    let [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) {
      [user] = await db.insert(usersTable).values({ id: userId }).onConflictDoNothing().returning();
      if (!user) [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    }
    if (!user) throw new Error("Local account provisioning failed");
    req.dbUser = user;
    const email = typeof auth.sessionClaims?.email === "string" ? auth.sessionClaims.email : null;
    req.identity = { email, emailVerified: hasVerifiedApproval(userId, email) };
    next();
  } catch (error) {
    next(error);
  }
}