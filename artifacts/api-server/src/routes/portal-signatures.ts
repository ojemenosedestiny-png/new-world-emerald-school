import { Router, type Request } from "express";
import { inArray } from "drizzle-orm";
import { db, portalPrincipals } from "@workspace/db";
import { SaveMySignatureBody } from "@workspace/api-zod";
import { check } from "../lib/portal-auth";
import { isDirector, isHeadOfSchool } from "../lib/website-admin";
import { signatureProblem } from "../lib/report-cards";

/**
 * The Head Teacher (the Head of School) and the Director each set their own name and signature for report cards:
 * primary cards carry the Head Teacher and the Director; secondary cards the principal and the Director.
 */
export const portalSignaturesRouter = Router();
type Role = "head" | "director";
const rolesOf = (req: Request): Role[] => [...(isHeadOfSchool(req) ? ["head" as const] : []), ...(isDirector(req) ? ["director" as const] : [])];

async function view(roles: Role[]) {
  const rows = roles.length ? await db.select().from(portalPrincipals).where(inArray(portalPrincipals.section, roles)) : [];
  return { roles, entries: roles.map((role) => { const r = rows.find((x) => x.section === role); return { role, name: r?.name ?? "", signature: r?.signature ?? null }; }) };
}

portalSignaturesRouter.get("/signatures", async (req, res) => {
  check(req.dbUser, "Sign in first.", 401);
  res.json(await view(rolesOf(req)));
});

portalSignaturesRouter.post("/signatures", async (req, res) => {
  check(req.dbUser, "Sign in first.", 401);
  const body = SaveMySignatureBody.parse(req.body);
  const roles = rolesOf(req);
  check(roles.includes(body.role), body.role === "head" ? "Only the Head Teacher sets this signature." : "Only the Director sets this signature.", 403);
  const name = body.name.trim();
  check(name, "Type your name as it should appear on report cards.");
  const problem = signatureProblem(body.signature);
  check(!problem, problem ?? "");
  const values = { name, signature: body.signature, updatedAt: new Date() };
  await db.insert(portalPrincipals).values({ section: body.role, ...values }).onConflictDoUpdate({ target: portalPrincipals.section, set: values });
  res.json(await view(roles));
});
