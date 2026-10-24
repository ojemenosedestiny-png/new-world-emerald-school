import { Router, type IRouter, type Request, type Response } from "express";
import { SendTestEmailResponse } from "@workspace/api-zod";
import { requireWebsiteAdmin } from "../lib/website-admin";
import { EMAIL_FROM_HELP, emailSender, sendEmail } from "../lib/email";
import { siteBaseUrl } from "../lib/accounts";

const router: IRouter = Router();

/**
 * Sends a test email to the signed-in administrator and reports Resend's exact answer,
 * so a wrong key, sender or unverified domain is visible without reading server logs.
 */
router.post("/email/test", async (req: Request, res: Response) => {
  if (!requireWebsiteAdmin(req, res)) return;
  const to = req.identity?.email ?? null;
  const reply = (ok: boolean, detail: string, from: string | null = null) => res.json(SendTestEmailResponse.parse({ ok, detail, from, to }));
  if (!process.env.RESEND_API_KEY?.trim()) return void reply(false, "RESEND_API_KEY is not set in Render.");
  if (!process.env.EMAIL_FROM?.trim()) return void reply(false, "EMAIL_FROM is not set in Render. Use New World Emerald <noreply@yourdomain.com>.");
  const from = emailSender(process.env.EMAIL_FROM);
  if (!from) return void reply(false, EMAIL_FROM_HELP);
  if (!to) return void reply(false, "Your account has no email address to send the test to.", from);
  const site = siteBaseUrl();
  const result = await sendEmail({
    to,
    subject: "Test email from the school website",
    html: `<p>This test email from New World Emerald's website arrived, so Resend is working.</p><p>Sender: ${from.replace(/</g, "&lt;")}</p>`,
    text: `This test email from New World Emerald's website arrived, so Resend is working.\nSender: ${from}`,
  });
  if (!result.sent) return void reply(false, result.detail ? `Resend said: ${result.detail}` : "Resend could not be reached. Please try again.", from);
  reply(true, `Sent to ${to} from ${from}. Check the inbox and the spam folder.${site ? "" : " Note: PUBLIC_SITE_URL is not set, so activation links cannot be emailed yet."}`, from);
});

export default router;
