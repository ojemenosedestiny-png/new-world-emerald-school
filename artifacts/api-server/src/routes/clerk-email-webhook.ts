import type { Request, Response } from "express";
import { verifyWebhook } from "@clerk/express/webhooks";
import { emailConfigured, sendEmail } from "../lib/email";

/**
 * Sends Clerk's sign-in emails (verification codes, password resets, invitations)
 * through the school's Resend account instead of Clerk's mail service.
 *
 * Clerk calls this for every email ("email.created" webhook). Emails Clerk still
 * delivers itself are skipped; for templates where "Delivered by Clerk" is switched
 * off, the email is sent here. Clerk signs each call (CLERK_WEBHOOK_SIGNING_SECRET),
 * and a non-2xx answer makes Clerk retry, so a Resend hiccup does not lose a code.
 * Mounted with express.raw: the signature covers the exact bytes Clerk sent.
 */
type ClerkEmail = {
  to_email_address?: string | null;
  subject?: string | null;
  body?: string | null;
  body_plain?: string | null;
  delivered_by_clerk?: boolean;
  slug?: string | null;
};

const textFromHtml = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export async function clerkEmailWebhook(req: Request, res: Response) {
  if (!process.env.CLERK_WEBHOOK_SIGNING_SECRET?.trim()) {
    res.status(503).json({ error: "CLERK_WEBHOOK_SIGNING_SECRET is not set." });
    return;
  }
  let event: { type: string; data: unknown };
  try {
    event = await verifyWebhook(req) as { type: string; data: unknown };
  } catch {
    res.status(400).json({ error: "Webhook signature could not be verified." });
    return;
  }
  if (event.type !== "email.created") { res.json({ ok: true, ignored: event.type }); return; }

  const email = event.data as ClerkEmail;
  if (email.delivered_by_clerk) { res.json({ ok: true, skipped: "delivered by Clerk" }); return; }
  const to = email.to_email_address?.trim();
  if (!to || !email.subject || !email.body) { res.status(400).json({ error: "The email is missing a recipient, subject or body." }); return; }
  if (!emailConfigured()) {
    req.log.error({ template: email.slug }, "Clerk email not sent: RESEND_API_KEY and EMAIL_FROM are not set");
    res.status(503).json({ error: "Email is not set up (RESEND_API_KEY and EMAIL_FROM)." });
    return;
  }
  const result = await sendEmail({ to, subject: email.subject, html: email.body, text: email.body_plain?.trim() || textFromHtml(email.body) });
  if (!result.sent) {
    req.log.error({ template: email.slug, reason: result.reason, detail: result.detail }, "Clerk email not sent through Resend");
    res.status(502).json({ error: "Resend did not accept the email.", detail: result.detail });
    return;
  }
  res.json({ ok: true });
}
