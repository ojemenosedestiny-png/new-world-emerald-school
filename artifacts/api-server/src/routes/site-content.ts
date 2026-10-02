import { Router, type IRouter, type Request, type Response } from "express";
import { db, siteContentTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { UpdateSiteContentBody } from "@workspace/api-zod";
import { isWebsiteAdmin, requireWebsiteAdmin } from "../lib/website-admin";

const router: IRouter = Router();
const documentId = "school-website";

router.get("/website-admin/access", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ isAdmin: isWebsiteAdmin(req) });
});

router.get("/site-content", async (_req: Request, res: Response) => {
  const [document] = await db.select().from(siteContentTable).where(eq(siteContentTable.id, documentId));
  res.setHeader("Cache-Control", "no-store");
  res.json({
    revision: document?.revision ?? 0,
    values: document?.values ?? {},
    updatedAt: document?.updatedAt.toISOString() ?? null,
  });
});

function validValue(key: string, value: string): boolean {
  if (!/^[a-zA-Z0-9._-]{1,160}$/.test(key) || ["__proto__", "prototype", "constructor"].includes(key)) return false;
  if (value.length > 20000) return false;
  if (key.startsWith("visibility.")) return value === "true" || value === "false";
  if (/\.(image|media|file|link)\./.test(key)) {
    // Never permit javascript:, data:, protocol-relative or backslash URLs.
    if (value === "" || /[\\\u0000-\u001f]/.test(value) || value.startsWith("//")) return false;
    return /^(https:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(value);
  }
  return true;
}

router.put("/site-content", async (req: Request, res: Response) => {
  if (!requireWebsiteAdmin(req, res)) return;
  const parsed = UpdateSiteContentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid website content." });
    return;
  }
  const { revision, values } = parsed.data;
  if (Object.keys(values).length > 1500 || Object.entries(values).some(([key, value]) => !validValue(key, value))) {
    res.status(400).json({ error: "Check your content. Images and links must use a safe website URL or uploaded file path." });
    return;
  }
  const [current] = await db.select().from(siteContentTable).where(eq(siteContentTable.id, documentId));
  if ((current?.revision ?? 0) !== revision) {
    res.status(409).json({ error: "The website was updated elsewhere. Reload before saving so no changes are overwritten." });
    return;
  }
  const next = {
    values: { ...(current?.values ?? {}), ...values },
    revision: revision + 1,
    updatedAt: new Date(),
    updatedBy: req.user!.id,
  };
  const saved = current
    ? await db.update(siteContentTable).set(next)
        .where(and(eq(siteContentTable.id, documentId), eq(siteContentTable.revision, revision))).returning()
    : await db.insert(siteContentTable).values({ id: documentId, ...next }).onConflictDoNothing().returning();
  if (!saved.length) {
    res.status(409).json({ error: "Another save happened first. Reload before saving." });
    return;
  }
  res.json({ revision: next.revision, values: next.values, updatedAt: next.updatedAt.toISOString() });
});

export default router;