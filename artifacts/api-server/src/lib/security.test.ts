import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";
import { clientIp, sanitizeForAudit } from "./audit-format";
import { adminNeedsMfa, isSuperAdmin, isWebsiteAdmin } from "./website-admin";

function headersFor(req: Partial<Request>, enforce = false) {
  const set: Record<string, string> = {};
  securityHeaders(enforce)({ headers: {}, ...req } as Request, { setHeader: (k: string, v: string) => { set[k] = v; } } as unknown as Response, () => {});
  return set;
}

test("security headers: report-only CSP by default, enforce on request, HSTS only over HTTPS", () => {
  const plain = headersFor({ headers: { host: "school.example" } });
  assert.equal(plain["X-Content-Type-Options"], "nosniff");
  assert.equal(plain["X-Frame-Options"], "SAMEORIGIN");
  assert.equal(plain["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.match(plain["Permissions-Policy"], /camera=\(\)/);
  assert.ok(plain["Content-Security-Policy-Report-Only"]);
  assert.equal(plain["Content-Security-Policy"], undefined);
  assert.equal(plain["Strict-Transport-Security"], undefined);
  const https = headersFor({ headers: { host: "school.example", "x-forwarded-proto": "https" } }, true);
  assert.ok(https["Content-Security-Policy"]);
  assert.match(https["Strict-Transport-Security"], /max-age=31536000/);
});

test("CSP allows the site's own resources, Clerk for this domain, fonts and uploads, and nothing broad", () => {
  const csp = contentSecurityPolicy("newworldemerald.example:443");
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self' https:\/\/\*\.clerk\.accounts\.dev https:\/\/\*\.clerk\.com https:\/\/clerk\.newworldemerald\.example/);
  assert.match(csp, /connect-src [^;]*https:\/\/storage\.googleapis\.com/);
  assert.match(csp, /font-src [^;]*https:\/\/fonts\.gstatic\.com/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(csp, /\s\*(\s|;|$)/, "no bare wildcard source");
});

test("audit copies redact secrets and bound size", () => {
  const out = sanitizeForAudit({
    student: { name: "Ada", password: "Secret-123!", passwordHash: "abc" }, token: "t", apiKey: "k", note: "x".repeat(600),
    list: Array.from({ length: 60 }, (_, i) => i), when: new Date("2026-01-02T03:04:05Z"), empty: { password: "" },
  }) as Record<string, any>;
  assert.equal(out.student.password, "[redacted]");
  assert.equal(out.student.passwordHash, "[redacted]");
  assert.equal(out.token, "[redacted]");
  assert.equal(out.apiKey, "[redacted]");
  assert.equal(out.student.name, "Ada");
  assert.equal(out.note.length, 501);
  assert.equal(out.list.length, 51);
  assert.equal(out.list[50], "[+10 more]");
  assert.equal(out.when, "2026-01-02T03:04:05.000Z");
  assert.equal(out.empty.password, "");
});

test("client IP prefers the first forwarded address", () => {
  assert.equal(clientIp({ headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }, socket: {} } as unknown as Request), "203.0.113.9");
  assert.equal(clientIp({ headers: {}, ip: "198.51.100.2", socket: {} } as unknown as Request), "198.51.100.2");
});

test("super admin and required two-factor for administrators", () => {
  const saved = { a: process.env.SCHOOL_ADMIN_EMAILS, s: process.env.SCHOOL_SUPER_ADMIN_EMAILS, m: process.env.REQUIRE_ADMIN_MFA };
  try {
    process.env.SCHOOL_ADMIN_EMAILS = "head@example.test, bursar@example.test";
    delete process.env.SCHOOL_SUPER_ADMIN_EMAILS;
    delete process.env.REQUIRE_ADMIN_MFA;
    const req = (email: string, mfa: boolean) => ({ dbUser: { id: email }, identity: { email, emailVerified: true, mfa } }) as unknown as Request;
    assert.equal(isSuperAdmin(req("head@example.test", false)), true, "first admin is super admin by default");
    assert.equal(isSuperAdmin(req("bursar@example.test", false)), false);
    process.env.SCHOOL_SUPER_ADMIN_EMAILS = "bursar@example.test, outsider@example.test";
    assert.equal(isSuperAdmin(req("bursar@example.test", false)), true);
    assert.equal(isSuperAdmin(req("head@example.test", false)), false);
    assert.equal(isWebsiteAdmin(req("bursar@example.test", false)), true, "MFA not required unless switched on");
    process.env.REQUIRE_ADMIN_MFA = "true";
    assert.equal(isWebsiteAdmin(req("bursar@example.test", false)), false);
    assert.equal(adminNeedsMfa(req("bursar@example.test", false)), true);
    assert.equal(isWebsiteAdmin(req("bursar@example.test", true)), true);
    assert.equal(adminNeedsMfa(req("visitor@example.test", false)), false, "non-admins are never asked for admin MFA");
  } finally {
    for (const [k, v] of [["SCHOOL_ADMIN_EMAILS", saved.a], ["SCHOOL_SUPER_ADMIN_EMAILS", saved.s], ["REQUIRE_ADMIN_MFA", saved.m]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
