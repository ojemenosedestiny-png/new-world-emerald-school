import { Router } from "express";
import { asc, eq, or, sql } from "drizzle-orm";
import { db, portalClasses, portalStudents } from "@workspace/db";
import { ManageParentLinksBody } from "@workspace/api-zod";
import { check, portalActor } from "../lib/portal-auth";
import { siteBaseUrl, validEmail } from "../lib/accounts";
import { emailConfigured, parentInviteEmail, sendEmail } from "../lib/email";
import { emailTypoFix } from "../lib/email-typos";

/** The parent's own sign-in link: the parent portal's sign-in with their email filled in. */
export const parentSignInLink = (email: string, site = siteBaseUrl() ?? "https://newworldemeraldprivateschool.com") => `${site}/sign-in?returnTo=parents&email=${encodeURIComponent(email)}`;

/**
 * The office links parents to children: each child has up to two parent emails (e.g. mother and father), and a
 * parent sees every child linked to their email in the parent portal.
 */
export const portalParentLinksRouter = Router();

async function adminOnly(req: Parameters<typeof portalActor>[0]) {
  const actor = await portalActor(req);
  check(actor.role === "admin", "Only the school office can link parents and children.", actor.role === "guest" ? 401 : 403);
}

const clean = (e: string | null | undefined) => (e ?? "").trim().toLowerCase();

/** Every parent email with their children, and every current student (to link more). */
portalParentLinksRouter.get("/parent-links", async (req, res) => {
  await adminOnly(req);
  const [students, classes] = await Promise.all([
    db.select({ id: portalStudents.id, studentId: portalStudents.studentId, name: portalStudents.name, classId: portalStudents.classId, guardianEmail: portalStudents.guardianEmail, secondGuardianEmail: portalStudents.secondGuardianEmail })
      .from(portalStudents).where(eq(portalStudents.active, true)).orderBy(asc(portalStudents.name)),
    db.select({ id: portalClasses.id, name: portalClasses.name }).from(portalClasses),
  ]);
  const className = new Map(classes.map((c) => [c.id, c.name]));
  const parents = new Map<string, { email: string; children: { id: number; studentId: string; name: string; className: string; slot: "first" | "second" }[] }>();
  for (const s of students) {
    for (const [raw, slot] of [[s.guardianEmail, "first"], [s.secondGuardianEmail, "second"]] as const) {
      const email = clean(raw);
      if (!email) continue;
      const entry = parents.get(email) ?? { email, children: [] };
      entry.children.push({ id: s.id, studentId: s.studentId, name: s.name, className: className.get(s.classId) ?? "", slot });
      parents.set(email, entry);
    }
  }
  res.json({
    parents: [...parents.values()].sort((a, b) => a.email.localeCompare(b.email)),
    students: students.map((s) => ({ id: s.id, studentId: s.studentId, name: s.name, className: className.get(s.classId) ?? "", parents: [clean(s.guardianEmail), clean(s.secondGuardianEmail)].filter(Boolean) })),
  });
});

/** Link a parent email to a child (first free place of two), or unlink it. */
portalParentLinksRouter.post("/parent-links", async (req, res) => {
  await adminOnly(req);
  const body = ManageParentLinksBody.parse(req.body);
  const email = clean(body.email);
  check(validEmail(email), "Enter the parent's email address.");
  const typo = emailTypoFix(email);
  // A mistyped email that is already linked can still be unlinked.
  check(!typo || body.action === "unlink", `"${email}" looks mistyped. Did you mean ${typo}? Check with the parent before linking.`);
  if (body.action === "invite") {
    check(emailConfigured(), "Email is not set up yet. Copy the link and send it to the parent yourself.", 503);
    const children = (await db.select({ name: portalStudents.name }).from(portalStudents)
      .where(or(sql`lower(trim(${portalStudents.guardianEmail})) = ${email}`, sql`lower(trim(${portalStudents.secondGuardianEmail})) = ${email}`))).map((c) => c.name);
    const result = await sendEmail({ to: email, ...parentInviteEmail({ url: parentSignInLink(email), children }) });
    check(result.sent, `The email was not sent${result.detail ? `: ${result.detail}` : ""}. Copy the link and send it yourself.`, 502);
    res.json({ message: `Sign-in link emailed to ${email}.` });
    return;
  }
  check(body.studentId, "Choose a child.");
  const [s] = await db.select().from(portalStudents).where(eq(portalStudents.id, body.studentId));
  check(s && s.active, "Student not found.", 404);
  const first = clean(s.guardianEmail), second = clean(s.secondGuardianEmail);
  let message: string;
  if (body.action === "link") {
    check(first !== email && second !== email, `${email} is already linked to ${s.name}.`, 409);
    check(!first || !second, `${s.name} already has two parents linked. Unlink one first.`, 409);
    await db.update(portalStudents).set(first ? { secondGuardianEmail: email } : { guardianEmail: email }).where(eq(portalStudents.id, s.id));
    message = `${email} can now see ${s.name} in the parent portal.`;
  } else {
    check(first === email || second === email, `${email} is not linked to ${s.name}.`, 404);
    // The second parent moves up when the first is unlinked.
    await db.update(portalStudents).set(first === email ? { guardianEmail: second || null, secondGuardianEmail: null } : { secondGuardianEmail: null }).where(eq(portalStudents.id, s.id));
    message = `${email} is no longer linked to ${s.name}.`;
  }
  res.json({ message });
});

// Exported for tests: how many students have this email as first or second parent.
export const linkedCount = async (email: string) => (await db.select({ n: sql<number>`count(*)::int` }).from(portalStudents)
  .where(or(sql`lower(trim(${portalStudents.guardianEmail})) = ${email}`, sql`lower(trim(${portalStudents.secondGuardianEmail})) = ${email}`)))[0]?.n ?? 0;
