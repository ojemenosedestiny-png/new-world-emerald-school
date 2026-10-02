import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { isWebsiteAdmin, protectWebsiteManagement } from "./website-admin";

// Synthetic settings are local to this isolated test process.
process.env.SCHOOL_ADMIN_EMAILS = "approved@example.com";

function request(path: string, method: string, account: "guest" | "visitor" | "admin") {
  return {
    path, method,
    user: account === "guest" ? undefined : {
      id: account,
      email: account === "admin" ? "APPROVED@example.com" : "visitor@example.com",
    },
    isAuthenticated: () => account !== "guest",
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