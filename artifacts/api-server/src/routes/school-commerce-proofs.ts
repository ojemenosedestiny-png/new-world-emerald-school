import express, { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, eq, or } from "drizzle-orm";
import { db, feePaymentReportsTable, portalImages, storeOrdersTable } from "@workspace/db";
import { AttachPaymentProofBody } from "@workspace/api-zod";
import { MAX_IMAGE_BYTES, saveImage } from "../lib/images";
import { clientIp } from "../lib/audit";

/**
 * Payment screenshots from parents. Uploading is public (parents do not sign in),
 * so it is limited to real images up to 5 MB and a few uploads per hour per address.
 * Screenshots are stored privately; only website administrators can open them
 * (through /api/portal/images/:id, which admits administrators).
 */
const router: IRouter = Router();
const UPLOADS_PER_HOUR = 12;
const recent = new Map<string, number[]>();

function rateLimited(ip: string, now = Date.now()) {
  const hour = now - 3_600_000;
  const times = (recent.get(ip) ?? []).filter((t) => t > hour);
  if (recent.size > 5000) recent.clear();
  if (times.length >= UPLOADS_PER_HOUR) { recent.set(ip, times); return true; }
  times.push(now);
  recent.set(ip, times);
  return false;
}

/** A screenshot id that exists, is a payment proof, and is not already attached to an order or report. */
export async function usablePaymentProof(proofId: string | null | undefined): Promise<{ id: string | null } | { error: string }> {
  const id = proofId?.trim();
  if (!id) return { id: null };
  if (!/^[0-9a-f-]{36}$/.test(id)) return { error: "The payment screenshot could not be found. Please upload it again." };
  const [image] = await db.select({ id: portalImages.id }).from(portalImages).where(and(eq(portalImages.id, id), eq(portalImages.purpose, "payment")));
  if (!image) return { error: "The payment screenshot could not be found. Please upload it again." };
  const [order] = await db.select({ id: storeOrdersTable.id }).from(storeOrdersTable).where(eq(storeOrdersTable.proofImageId, id));
  const [report] = await db.select({ id: feePaymentReportsTable.id }).from(feePaymentReportsTable).where(eq(feePaymentReportsTable.proofImageId, id));
  if (order || report) return { error: "That screenshot is already attached to another payment. Please upload it again." };
  return { id };
}

router.post(
  "/school-commerce/payment-proofs",
  (req: Request, res: Response, next: NextFunction) => {
    // Refuse before reading the file when this address has uploaded too much.
    if (rateLimited(clientIp(req) ?? "unknown")) { res.status(429).json({ error: "Too many uploads. Please wait an hour and try again, or contact the School Office." }); return; }
    next();
  },
  express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }),
  async (req: Request, res: Response) => {
    try {
      const proofId = await saveImage(req.body, "payment", `payer:${clientIp(req) ?? "unknown"}`);
      res.json({ proofId });
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      if (status >= 500) req.log.error({ err: error }, "Payment screenshot upload failed");
      res.status(status).json({ error: status >= 500 ? "The screenshot could not be saved. Please try again." : (error as Error).message });
    }
  },
);

router.post("/school-commerce/payment-proofs/attach", async (req: Request, res: Response) => {
  const parsed = AttachPaymentProofBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Enter your order or payment reference, your email and a screenshot." }); return; }
  const reference = parsed.data.reference.trim().toUpperCase();
  const email = parsed.data.email.trim().toLowerCase();
  const proof = await usablePaymentProof(parsed.data.proofId);
  if ("error" in proof) { res.status(400).json({ error: proof.error }); return; }
  // The same answer for a wrong reference or a wrong email, so references cannot be probed.
  const notFound = () => res.status(404).json({ error: "No order or payment report matches that reference and email." });
  const [order] = await db.select().from(storeOrdersTable).where(eq(storeOrdersTable.reference, reference));
  if (order) {
    if (order.guardianEmail.trim().toLowerCase() !== email) return void notFound();
    await db.update(storeOrdersTable).set({
      proofImageId: proof.id,
      ...(order.paymentStatus === "awaiting_payment" ? { paymentStatus: "reported" } : {}),
    }).where(eq(storeOrdersTable.id, order.id));
    res.json({ message: "Screenshot added. The School Office will confirm your payment." });
    return;
  }
  const [report] = await db.select().from(feePaymentReportsTable)
    .where(or(eq(feePaymentReportsTable.reference, reference), eq(feePaymentReportsTable.reference, parsed.data.reference.trim())));
  if (!report || report.guardianEmail.trim().toLowerCase() !== email) return void notFound();
  await db.update(feePaymentReportsTable).set({ proofImageId: proof.id }).where(eq(feePaymentReportsTable.id, report.id));
  res.json({ message: "Screenshot added. The School Office will confirm your payment." });
});

export default router;
