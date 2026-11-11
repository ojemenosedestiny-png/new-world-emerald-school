import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { bodyShapeProblem, corsOptions, originGuard, sameSiteRequest } from "./request-guards";
import { publicRateLimit } from "./public-rate-limit";

const req = (h: Record<string, string>, method = "POST") => ({ method, headers: { host: "newworldemeraldprivateschool.com", ...h }, socket: {}, log: { warn() {} } }) as unknown as Request;
function run(mw: (req: Request, res: Response, next: () => void) => void, r: Request) {
  let status = 0, passed = false;
  const res = { status(s: number) { status = s; return res; }, json() { return res; }, setHeader() {} } as unknown as Response;
  mw(r, res, () => { passed = true; });
  return { status, passed };
}

test("forged cross-site requests are refused; the school's own pages and reads are not", () => {
  assert.equal(run(originGuard, req({ origin: "https://newworldemeraldprivateschool.com" })).passed, true);
  assert.equal(run(originGuard, req({})).passed, true, "no Origin: not a browser form from another site");
  assert.equal(run(originGuard, req({ origin: "https://evil.example" })).status, 403);
  assert.equal(run(originGuard, req({ origin: "https://newworldemeraldprivateschool.com.evil.example" })).status, 403);
  assert.equal(run(originGuard, req({ "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal(run(originGuard, req({ origin: "not a url" })).status, 403);
  assert.equal(run(originGuard, req({ origin: "https://evil.example" }, "GET")).passed, true, "reading is unaffected");
  assert.equal(sameSiteRequest(req({ origin: "https://www.example", "x-forwarded-host": "www.example" })), true, "behind a proxy");
});

test("CORS lets only this site's own pages use the visitor's cookies", () => {
  const allowed = (h: Record<string, string>) => { let o = false; corsOptions(req(h, "GET"), (_e, opts) => { o = opts.origin; }); return o; };
  assert.equal(allowed({ origin: "https://newworldemeraldprivateschool.com" }), true);
  assert.equal(allowed({ origin: "https://evil.example" }), false);
  assert.equal(allowed({}), false);
});

test("oversized request bodies are refused before validation", () => {
  assert.equal(bodyShapeProblem({ entries: Array.from({ length: 1500 }, (_, i) => ({ studentId: i, ca: 10, exam: 50 })) }), null, "a real score sheet");
  assert.match(bodyShapeProblem({ classIds: new Array(5001).fill(1) })!, /too many items/);
  assert.match(bodyShapeProblem({ a: Array.from({ length: 30 }, () => new Array(4000).fill("x")) })!, /too large/);
  let deep: unknown = 1; for (let i = 0; i < 40; i++) deep = [deep];
  assert.match(bodyShapeProblem(deep)!, /nested too deeply/);
});

test("public forms: limited per address, and overall so faked addresses cannot get round it", () => {
  const limit = publicRateLimit("test", 2, "slow down", 5);
  const ip = (n: number) => req({ "cf-connecting-ip": `203.0.113.${n}` });
  assert.equal(run(limit, ip(1)).passed, true);
  assert.equal(run(limit, ip(1)).passed, true);
  assert.equal(run(limit, ip(1)).status, 429, "per address");
  assert.equal(run(limit, ip(2)).passed, true);
  assert.equal(run(limit, ip(3)).passed, true);
  assert.equal(run(limit, ip(4)).passed, true);
  assert.equal(run(limit, ip(5)).status, 429, "overall cap reached with fresh addresses");
});
