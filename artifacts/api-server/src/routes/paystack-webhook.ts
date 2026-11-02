import type { Request, Response } from "express";
import { validWebhookSignature } from "../lib/paystack";
import { checkWithPaystack } from "./portal-parent";

/**
 * Paystack's notice that a payment succeeded, so a parent who closes the page before returning is still
 * credited. The signature is checked against the raw body, and the payment is then confirmed with Paystack
 * directly before anything is applied; repeated notices change nothing.
 */
export async function paystackWebhook(req: Request, res: Response) {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!validWebhookSignature(raw, req.header("x-paystack-signature"))) { res.status(401).end(); return; }
  let event: { event?: string; data?: { reference?: string } } = {};
  try { event = JSON.parse(raw.toString("utf8")); } catch { res.status(400).end(); return; }
  const reference = event.data?.reference;
  if (event.event === "charge.success" && typeof reference === "string" && /^NWE-\d{8}-[A-F0-9]{10}$/.test(reference)) {
    try {
      await checkWithPaystack(reference, req.log);
    } catch (error) {
      // Paystack retries a failed notice, so let it.
      req.log.error({ err: error, reference }, "Paystack webhook could not apply the payment");
      res.status(500).end();
      return;
    }
  }
  res.status(200).end();
}
