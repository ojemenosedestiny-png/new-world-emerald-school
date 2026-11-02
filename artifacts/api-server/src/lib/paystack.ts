import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Paystack, server to server only. The secret key comes from PAYSTACK_SECRET_KEY (Render settings, never
 * the code). Parents are sent to Paystack's own checkout page, so card details never touch this site.
 */
const API = "https://api.paystack.co";
const secret = () => process.env.PAYSTACK_SECRET_KEY?.trim() ?? "";

export const paystackConfigured = () => /^sk_(live|test)_[A-Za-z0-9]+$/.test(secret());

export class PaystackError extends Error {}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!paystackConfigured()) throw new PaystackError("Online payment is not set up yet.");
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${secret()}`, "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => null) as { status?: boolean; message?: string; data?: T } | null;
  if (!res.ok || !body?.status || body.data === undefined) throw new PaystackError(body?.message || `Paystack answered ${res.status}.`);
  return body.data;
}

/** Starts a payment and returns the Paystack checkout address to send the parent to. */
export async function initializePayment(p: { email: string; amountKobo: number; reference: string; callbackUrl: string; metadata: Record<string, unknown> }) {
  const data = await call<{ authorization_url: string; reference: string }>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({ email: p.email, amount: p.amountKobo, currency: "NGN", reference: p.reference, callback_url: p.callbackUrl, metadata: p.metadata }),
  });
  if (!/^https:\/\/([a-z0-9-]+\.)*paystack\.(co|com)\//.test(data.authorization_url)) throw new PaystackError("Paystack returned an unexpected checkout address.");
  return data.authorization_url;
}

export type VerifiedTransaction = { status: string; amountKobo: number; currency: string; reference: string; channel: string | null; paidAt: string | null; gatewayResponse: string | null };

/** Asks Paystack directly what happened to a payment. Only this answer is trusted, never the browser. */
export async function verifyPayment(reference: string): Promise<VerifiedTransaction> {
  const d = await call<{ status: string; amount: number; currency: string; reference: string; channel?: string; paid_at?: string; gateway_response?: string }>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
  );
  return { status: d.status, amountKobo: d.amount, currency: d.currency, reference: d.reference, channel: d.channel ?? null, paidAt: d.paid_at ?? null, gatewayResponse: d.gateway_response ?? null };
}

/** True when a webhook body was signed by Paystack with this school's secret key (HMAC SHA-512). */
export function validWebhookSignature(rawBody: Buffer, signature: string | undefined, key = secret()) {
  if (!key || !signature || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  const expected = createHmac("sha512", key).update(rawBody).digest();
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
