import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import type { AddressInfo } from "node:net";
import { pool } from "@workspace/db";
import router from "../routes";

/**
 * Every API address, called by a stranger (not signed in, no cookies): only the deliberately public ones may answer
 * with success. A new route that forgets its sign-in check fails this test. Addresses come from the OpenAPI spec,
 * plus the few that are not in it.
 */
const PUBLIC = new Set([
  // Reviewed 2026-11-11: each returns only public website information, or nothing private.
  "GET /healthz", "GET /site-content", "GET /academic-calendar", "GET /live-updates",
  "GET /school-commerce/products", "GET /school-commerce/fee-schedules", "GET /school-commerce/settings",
  // "Are you signed in?" checks and signing out: they reveal nothing to a stranger.
  "GET /portal/session", "DELETE /portal/session", "GET /website-admin/access",
]);

// Tests run from artifacts/api-server (the bundle itself lives in a temporary folder).
const SPEC_DIR = resolve(process.cwd(), "../../lib/api-spec");
const spec = readFileSync(resolve(SPEC_DIR, "openapi.yaml"), "utf8");
function routes() {
  const out: { method: string; path: string }[] = [];
  const refs = new Map<string, string>();
  // openapi.yaml lists each path, often as a $ref into a split file; read the methods from wherever it points.
  const lines = spec.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^  (\/[^:]+):\s*$/.exec(lines[i]);
    if (!m) continue;
    const next = lines[i + 1] ?? "";
    const ref = /\$ref: "\.\/([^#]+)#\/paths\/([^"]+)"/.exec(next);
    if (ref) refs.set(m[1], `${ref[1]}#${ref[2]}`);
    else for (let j = i + 1; j < lines.length && /^ {4}/.test(lines[j]); j++) {
      const mm = /^ {4}(get|post|put|patch|delete):/.exec(lines[j]);
      if (mm) out.push({ method: mm[1].toUpperCase(), path: m[1] });
    }
  }
  const files = new Map<string, string[]>();
  for (const [path, target] of refs) {
    const [file, key] = target.split("#");
    if (!files.has(file)) files.set(file, readFileSync(resolve(SPEC_DIR, file), "utf8").replace(/\r/g, "").split("\n"));
    const f = files.get(file)!;
    const start = f.findIndex((l) => l === `  ${key}:`);
    assert.ok(start >= 0, `${file}#${key} not found`);
    for (let j = start + 1; j < f.length && /^ {4}/.test(f[j]); j++) {
      const mm = /^ {4}(get|post|put|patch|delete):/.exec(f[j]);
      if (mm) out.push({ method: mm[1].toUpperCase(), path });
    }
  }
  // Not in the spec (streams, files and reports).
  out.push({ method: "POST", path: "/portal/assistant/chat" }, { method: "GET", path: "/portal/export/everything" });
  return out;
}

test("route security: a stranger gets no success from any private address", async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.log = { error() {}, warn() {}, info() {} } as unknown as typeof req.log; next(); });
  app.use("/api", router);
  // Anything that throws (for example Clerk's getAuth without Clerk) is a refusal, not a success.
  app.use((_e: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { if (!res.headersSent) res.status(500).end(); });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const open: string[] = [];
  try {
    const all = routes();
    assert.ok(all.length > 150, `found ${all.length} routes`);
    for (const r of all) {
      const key = `${r.method} ${r.path}`;
      if (PUBLIC.has(key) && !process.env.ROUTE_SECURITY_ALL) continue;
      const url = base + r.path.replace(/\{[^}]+\}/g, "1");
      const res = await fetch(url, { method: r.method, headers: { "Content-Type": "application/json" }, body: ["GET", "HEAD"].includes(r.method) ? undefined : "{}", redirect: "manual" });
      await res.arrayBuffer().catch(() => undefined);
      if (res.status < 300) open.push(`${key} -> ${res.status}`);
    }
    assert.deepEqual(open, [], `These private addresses answered a stranger:\n${open.join("\n")}`);
  } finally {
    server.close();
    await pool.end();
  }
});
