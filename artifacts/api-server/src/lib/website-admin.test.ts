import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { isPublicWebsiteRequest, isWebsiteAdmin, protectWebsiteManagement } from "./website-admin";

// Synthetic settings are local to this isolated test process.
process.env.SCHOOL_ADMIN_EMAILS = "approved@example.com";

function request(path: string, method: string, account: "guest" | "visitor" | "admin") {
  return {
    path, method,
    dbUser: account === "guest" ? undefined : {
      id: account,
    },
    identity: {
      email: account === "admin" ? "APPROVED@example.com" : "visitor@example.com",
      emailVerified: account === "admin",
    },
  } as unknown as Request;
}

function check(path: string, method: string, account: "guest" | "visitor" | "admin") {
  let status: number | undefined;
  let allowed = false;
  const response = {
    status(code: number) { status = code; return this; },
    json() { return this; },
  } as unknown as Response;
  protectWebsiteManagement(request(path, method, account), response, () => { allowed = true; });
  return { status, allowed };
}

const privateRoutes = [
  ["GET", "/admission-applications"],
  ["PATCH", "/admission-applications/1"],
  ["POST", "/academic-calendar"],
  ["DELETE", "/academic-calendar/1"],
  ["POST", "/live-updates"],
  ["PATCH", "/live-updates/1"],
  ["POST", "/storage/uploads/request-url"],
  ["PUT", "/site-content"],
  ["GET", "/school-commerce/orders"],
  ["GET", "/school-commerce/fee-reports"],
  ["GET", "/school-commerce/management/products"],
  ["POST", "/school-commerce/products"],
  ["PATCH", "/school-commerce/products/1"],
  ["DELETE", "/school-commerce/products/1"],
  ["PUT", "/school-commerce/settings"],
  ["POST", "/school-commerce/individual-charges"],
];

for (const [method, path] of privateRoutes) {
  test(`${method} ${path} requires explicit approval, including mixed-case URLs`, () => {
    for (const candidate of [path, path.toUpperCase(), `${path}/`]) {
      assert.deepEqual(check(candidate, method, "guest"), { status: 401, allowed: false });
      assert.deepEqual(check(candidate, method, "visitor"), { status: 403, allowed: false });
      assert.deepEqual(check(candidate, method, "admin"), { status: undefined, allowed: true });
    }
  });
}

test("public content and parent submissions remain available", () => {
  for (const [method, path] of [
    ["GET", "/academic-calendar"], ["GET", "/live-updates"], ["GET", "/site-content"],
    ["GET", "/school-commerce/products"], ["GET", "/school-commerce/fee-schedules"],
    ["GET", "/school-commerce/settings"], ["GET", "/school-commerce/individual-charges/lookup/REF123"],
    ["POST", "/admission-applications"], ["POST", "/school-commerce/orders"],
    ["POST", "/school-commerce/fee-reports"],
  ]) assert.deepEqual(check(path, method, "guest"), { status: undefined, allowed: true });
});

test("signed-in accounts do not become admins unless explicitly approved", () => {
  assert.equal(isWebsiteAdmin(request("/", "GET", "guest")), false);
  assert.equal(isWebsiteAdmin(request("/", "GET", "visitor")), false);
  assert.equal(isWebsiteAdmin(request("/", "GET", "admin")), true);
});

test("an allowlisted address without verified identity cannot manage the website", () => {
  const req = request("/", "GET", "admin");
  req.identity!.emailVerified = false;
  assert.equal(isWebsiteAdmin(req), false);
});
test("routes that are not explicitly public fail closed", () => {
  for (const [method, path] of [
    ["GET", "/new-admin-report"], ["POST", "/new-admin-action"], ["DELETE", "/site-content"],
    ["GET", "/school-commerce/management/new-list"], ["POST", "/admission-applications/1"],
    ["GET", "/academic-calendar/1"], ["PUT", "/storage/objects/uploads/photo.jpg"],
  ]) {
    assert.deepEqual(check(path, method, "guest"), { status: 401, allowed: false });
    assert.deepEqual(check(path, method, "visitor"), { status: 403, allowed: false });
    assert.deepEqual(check(path, method, "admin"), { status: undefined, allowed: true });
  }
});

test("only signed upload addresses accept files without signing in", () => {
  assert.equal(isPublicWebsiteRequest("PUT", "/storage/uploads/eyJpZCI6IjEifQ.c2lnbmF0dXJl"), true);
  for (const [method, path] of [["PUT", "/storage/uploads/no-signature"], ["PUT", "/storage/uploads/a.b/extra"], ["POST", "/storage/uploads/a.b"], ["DELETE", "/storage/uploads/a.b"]]) {
    assert.equal(isPublicWebsiteRequest(method, path), false, `${method} ${path}`);
  }
});

test("health, account status and public storage reads stay public", () => {
  for (const [method, path] of [
    ["GET", "/healthz"], ["HEAD", "/healthz"], ["GET", "/account"], ["GET", "/website-admin/access"],
    ["GET", "/storage/public-objects/logo.png"], ["GET", "/storage/objects/uploads/photo.jpg"],
  ]) assert.deepEqual(check(path, method, "guest"), { status: undefined, allowed: true });
});

test("an unresolved Clerk identity keeps public pages open and explains the admin refusal", () => {
  const req = { path: "/site-content", method: "GET", identityError: "Account identity could not be resolved." } as unknown as Request;
  let allowed = false;
  protectWebsiteManagement(req, { status() { return this; }, json() { return this; } } as unknown as Response, () => { allowed = true; });
  assert.equal(allowed, true);
  let status: number | undefined;
  let body: unknown;
  const res = { status(code: number) { status = code; return this; }, json(value: unknown) { body = value; return this; } } as unknown as Response;
  protectWebsiteManagement({ ...req, method: "PUT" } as unknown as Request, res, () => { throw new Error("must not pass"); });
  assert.equal(status, 401);
  assert.deepEqual(body, { error: "Account identity could not be resolved." });
});
