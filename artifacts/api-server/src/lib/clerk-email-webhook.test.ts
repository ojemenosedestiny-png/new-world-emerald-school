import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac, randomBytes } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { clerkEmailWebhook } from "../routes/clerk-email-webhook";

// Signs like Clerk's webhook service (Svix): HMAC-SHA256 of "id.timestamp.body".
const secretBytes = randomBytes(24);
const SECRET = "whsec_" + secretBytes.toString("base64");
function signed(body: string, opts: { secret?: Buffer; age?: number } = {}) {
  const id = "msg_" + randomBytes(6).toString("hex");
  const timestamp = String(Math.floor(Date.now() / 1000) - (opts.age ?? 0));
  const signature = createHmac("sha256", opts.secret ?? secretBytes).update(`${id}.${timestamp}.${body}`).digest("base64");
  return { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}`, "Content-Type": "application/json" };
}
const emailEvent = (data: Record<string, unknown>) => JSON.stringify({ type: "email.created", object: "event", data: {
  object: "email", slug: "verification_code", to_email_address: "teacher@example.test", subject: "123456 is your verification code",
  body: "<p>Your code is <b>123456</b></p>", body_plain: "Your code is 123456", delivered_by_clerk: false, ...data,
} });

test("Clerk sign-in emails are verified and sent through Resend", async () => {
  const saved = { secret: process.env.CLERK_WEBHOOK_SIGNING_SECRET, key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM };
  const realFetch = globalThis.fetch;
  const sent: { to: string[]; subject: string; text: string; from: string }[] = [];
  let resendStatus = 200;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).startsWith("https://api.resend.com/")) {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(resendStatus === 200 ? { id: "email_1" } : { message: "Domain not verified" }), { status: resendStatus });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  const app = express();
  app.use((req, _res, next) => { req.log = { error() {}, warn() {}, info() {} } as unknown as typeof req.log; next(); });
  app.post("/hook", express.raw({ type: "application/json" }), clerkEmailWebhook);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  const post = (body: string, headers: Record<string, string>) => realFetch(url, { method: "POST", headers, body });
  try {
    // Off until the signing secret is configured.
    delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    assert.equal((await post(emailEvent({}), signed(emailEvent({})))).status, 503);
    process.env.CLERK_WEBHOOK_SIGNING_SECRET = SECRET;
    process.env.RESEND_API_KEY = "re_test_fake";
    process.env.EMAIL_FROM = "New World Emerald <noreply@school.example>";

    // Forged, tampered or stale calls are refused and nothing is sent.
    const body = emailEvent({});
    assert.equal((await post(body, signed(body, { secret: randomBytes(24) }))).status, 400, "wrong secret");
    assert.equal((await post(body.replace("123456", "999999"), signed(body))).status, 400, "altered after signing");
    assert.equal((await post(body, signed(body, { age: 3600 }))).status, 400, "replayed an hour later");
    assert.equal((await post(body, { "Content-Type": "application/json" })).status, 400, "unsigned");
    assert.equal(sent.length, 0);

    // A verification code goes out from the school address with Clerk's own content.
    const ok = await post(body, signed(body));
    assert.equal(ok.status, 200);
    assert.deepEqual(sent.map((m) => [m.to[0], m.subject, m.text, m.from]), [["teacher@example.test", "123456 is your verification code", "Your code is 123456", "New World Emerald <noreply@school.example>"]]);

    // Emails Clerk still delivers itself, and other event types, are left alone.
    const byClerk = emailEvent({ delivered_by_clerk: true });
    assert.equal((await (await post(byClerk, signed(byClerk))).json() as { skipped?: string }).skipped, "delivered by Clerk");
    const other = JSON.stringify({ type: "user.created", object: "event", data: { id: "user_1" } });
    assert.equal((await post(other, signed(other))).status, 200);
    assert.equal(sent.length, 1, "no duplicates");

    // Plain text is made from the HTML when Clerk sends none.
    const noPlain = emailEvent({ body_plain: null, body: "<style>p{color:red}</style><p>Reset&nbsp;your <b>password</b></p>" });
    await post(noPlain, signed(noPlain));
    assert.equal(sent.at(-1)!.text, "Reset your password");

    // If Resend refuses, Clerk is told to retry; if email is not set up, it says so.
    resendStatus = 403;
    const retry = await post(body, signed(body));
    assert.equal(retry.status, 502);
    assert.match((await retry.json() as { detail: string }).detail, /Domain not verified/);
    delete process.env.RESEND_API_KEY;
    assert.equal((await post(body, signed(body))).status, 503);
  } finally {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    for (const [k, v] of [["CLERK_WEBHOOK_SIGNING_SECRET", saved.secret], ["RESEND_API_KEY", saved.key], ["EMAIL_FROM", saved.from]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
