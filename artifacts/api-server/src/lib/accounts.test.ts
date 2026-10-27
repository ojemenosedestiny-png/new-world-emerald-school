import assert from "node:assert/strict";
import { test } from "node:test";
import { accountLink, formatStudentId, hashAccountToken, newAccountToken, passwordProblem, siteBaseUrl, validEmail, validTokenShape } from "./accounts";
import { accountReadyEmail, activationEmail, emailConfigured, emailSender, passwordChangedEmail, resetEmail, sendEmail, teacherInviteEmail } from "./email";

test("automatic Student IDs use NWE/year/five digits", () => {
  assert.equal(formatStudentId(2026, 1), "NWE/2026/00001");
  assert.equal(formatStudentId(2026, 123), "NWE/2026/00123");
  assert.equal(formatStudentId(2027, 100000), "NWE/2027/100000");
});

test("new passwords need 10+ characters with a letter and a number", () => {
  assert.equal(passwordProblem("Short1"), "Use at least 10 characters.");
  assert.equal(passwordProblem("onlyletterslong"), "Include at least one letter and one number.");
  assert.equal(passwordProblem("1234567890123"), "Include at least one letter and one number.");
  assert.equal(passwordProblem("x".repeat(120) + "1".repeat(9)), "Use at most 128 characters.");
  assert.equal(passwordProblem("Ada-Chosen-2026"), null);
});

test("emails and tokens are validated; only hashes are comparable", () => {
  assert.equal(validEmail("parent@example.com"), true);
  for (const bad of ["parent@", "@example.com", "par ent@example.com", "parent@example"]) assert.equal(validEmail(bad), false, bad);
  const { token, hash } = newAccountToken();
  assert.equal(validTokenShape(token), true);
  assert.notEqual(hash, token);
  assert.equal(hashAccountToken(token), hash);
  assert.equal(validTokenShape("abc"), false);
  assert.equal(validTokenShape(123), false);
});

test("links use the configured site address, never the request", () => {
  assert.equal(siteBaseUrl({ PUBLIC_SITE_URL: "https://school.example/" }), "https://school.example");
  assert.equal(siteBaseUrl({ RENDER_EXTERNAL_URL: "https://x.onrender.com" }), "https://x.onrender.com");
  assert.equal(siteBaseUrl({ PUBLIC_SITE_URL: "https://school.example", RENDER_EXTERNAL_URL: "https://x.onrender.com" }), "https://school.example");
  assert.equal(siteBaseUrl({}), null);
  assert.equal(siteBaseUrl({ PUBLIC_SITE_URL: "https://evil.example/path" }), null);
  assert.equal(accountLink("https://school.example", "ab".repeat(32)), "https://school.example/portal/activate?t=" + "ab".repeat(32));
});

test("email is sent through Resend when configured and explains failures", async () => {
  const msg = { to: "parent@example.com", subject: "Hi", html: "<p>x</p>", text: "x" };
  assert.deepEqual(await sendEmail(msg, {}), { sent: false, reason: "not_configured" });
  assert.equal(emailConfigured({ RESEND_API_KEY: "re_x", EMAIL_FROM: "School <a@b.c>" }), true);
  let seen: { url: string; init: RequestInit } | undefined;
  const ok = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
  assert.deepEqual(await sendEmail(msg, { RESEND_API_KEY: "re_x", EMAIL_FROM: "School <a@b.c>" }, ok), { sent: true });
  assert.equal(seen!.url, "https://api.resend.com/emails");
  assert.equal((seen!.init.headers as Record<string, string>).Authorization, "Bearer re_x");
  assert.deepEqual(JSON.parse(String(seen!.init.body)).to, ["parent@example.com"]);
  const rejected = (async () => new Response(JSON.stringify({ message: "The example.com domain is not verified." }), { status: 403 })) as unknown as typeof fetch;
  assert.deepEqual(await sendEmail(msg, { RESEND_API_KEY: "re_x", EMAIL_FROM: "a@b.c" }, rejected), { sent: false, reason: "rejected", detail: "The example.com domain is not verified." });
  const down = (async () => { throw new Error("getaddrinfo ENOTFOUND"); }) as unknown as typeof fetch;
  assert.equal((await sendEmail(msg, { RESEND_API_KEY: "re_x", EMAIL_FROM: "a@b.c" }, down)).reason, "unreachable");
});

test("account emails are escaped and carry the link and expiry", () => {
  const a = activationEmail({ studentName: "<b>Ada</b>", studentId: "NWE/2026/00001", className: "JSS 1", url: "https://school.example/portal/activate?t=abc", hours: 72 });
  assert.match(a.subject, /Activate/);
  assert.doesNotMatch(a.html, /<b>Ada<\/b>/);
  assert.match(a.html, /&lt;b&gt;Ada&lt;\/b&gt;/);
  assert.match(a.html, /72 hours/);
  assert.match(a.text, /NWE\/2026\/00001/);
  const r = resetEmail({ studentName: "Ada", studentId: "NWE/2026/00001", url: "https://school.example/portal/activate?t=abc", hours: 24 });
  assert.match(r.html, /24 hours/);
  assert.match(r.text, /https:\/\/school\.example\/portal\/activate\?t=abc/);
});

test("the email sender forgives common paste mistakes and explains real ones", async () => {
  assert.equal(emailSender("noreply@school.ng"), "noreply@school.ng");
  assert.equal(emailSender("New World Emerald <noreply@school.ng>"), "New World Emerald <noreply@school.ng>");
  assert.equal(emailSender('"New World Emerald <noreply@school.ng>"'), "New World Emerald <noreply@school.ng>", "surrounding quotes");
  assert.equal(emailSender("EMAIL_FROM=New World Emerald <noreply@school.ng>"), "New World Emerald <noreply@school.ng>", "pasted name prefix");
  assert.equal(emailSender("New World Emerald noreply@school.ng"), "New World Emerald <noreply@school.ng>", "missing angle brackets");
  assert.equal(emailSender('"New World Emerald" <noreply@school.ng>'), "New World Emerald <noreply@school.ng>", "quoted name");
  assert.equal(emailSender("  <noreply@school.ng>  "), "noreply@school.ng");
  assert.equal(emailSender("newworldemeraldprivateschool.com"), "New World Emerald <noreply@newworldemeraldprivateschool.com>", "only the domain");
  for (const bad of ["New World Emerald", "noreply@", "", "two@at@signs.ng", "-bad.com"]) assert.equal(emailSender(bad), null, bad);
  let calls = 0;
  const counting = (async () => { calls++; return new Response("{}"); }) as unknown as typeof fetch;
  const result = await sendEmail({ to: "p@x.y", subject: "s", html: "h", text: "t" }, { RESEND_API_KEY: "re_x", EMAIL_FROM: "New World Emerald" }, counting);
  assert.equal(result.sent, false);
  assert.match(result.detail ?? "", /EMAIL_FROM has the wrong format/);
  assert.equal(calls, 0, "nothing is sent to Resend with a broken sender");
  let body = "";
  const capture = (async (_u: unknown, init?: RequestInit) => { body = String(init?.body); return new Response("{}"); }) as unknown as typeof fetch;
  await sendEmail({ to: "p@x.y", subject: "s", html: "h", text: "t" }, { RESEND_API_KEY: "re_x", EMAIL_FROM: "'New World Emerald <noreply@school.ng>'" }, capture);
  assert.equal(JSON.parse(body).from, "New World Emerald <noreply@school.ng>");
});

test("confirmation emails carry sign-in details safely", () => {
  const ready = accountReadyEmail({ studentName: "Ada <Obi>", studentId: "NWE/2026/00001", className: "JSS 1", signInUrl: "https://school.example/portal" });
  assert.match(ready.subject, /account is ready/);
  assert.ok(ready.html.includes("NWE/2026/00001") && ready.text.includes("https://school.example/portal"));
  assert.ok(ready.html.includes("Ada &lt;Obi&gt;") && !ready.html.includes("<Obi>"), "names are escaped");
  const changed = passwordChangedEmail({ studentName: "Ada", studentId: "NWE/2026/00001", signInUrl: "https://school.example/portal" });
  assert.match(changed.text, /contact the school office/);
});


test("teacher invitations carry the sign-in link, the email to use and the classes, escaped", () => {
  const mail = teacherInviteEmail({ teacherName: "Mr <Bayo>", email: "bayo@example.test", classNames: ["JSS 1", "JSS 2"], signInUrl: "https://school.example/teacher" });
  assert.match(mail.subject, /added as a teacher/);
  assert.match(mail.html, /Mr &lt;Bayo&gt;/);
  assert.doesNotMatch(mail.html, /<Bayo>/);
  assert.match(mail.html, /JSS 1, JSS 2/);
  assert.match(mail.html, /bayo@example\.test/);
  assert.match(mail.html, /href="https:\/\/school\.example\/teacher"/);
  assert.match(mail.text, /https:\/\/school\.example\/teacher/);
  assert.doesNotMatch(mail.text, /password:/i, "staff have no password to send");
  assert.match(teacherInviteEmail({ teacherName: "A", email: "a@example.test", classNames: [], signInUrl: "https://x.example/teacher" }).text, /none yet/);
});
