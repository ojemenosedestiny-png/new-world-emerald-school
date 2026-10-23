import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { serveFrontend } from "./frontend";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const serviceAccount = {
  type: "service_account", project_id: "school-test", client_email: "uploader@school-test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};
// The storage client is configured when its module loads, so set this before any import of it.
process.env.GCS_SERVICE_ACCOUNT_JSON = JSON.stringify(serviceAccount);
process.env.PRIVATE_OBJECT_DIR = "/school-bucket/private";

test("storage credentials come from a service account key outside Replit", async () => {
  const { storageClientOptions } = await import("./objectStorage");
  const fromJson = storageClientOptions(JSON.stringify(serviceAccount));
  assert.equal((fromJson.credentials as { client_email: string }).client_email, serviceAccount.client_email);
  assert.equal(fromJson.projectId, "school-test");
  const fromBase64 = storageClientOptions(Buffer.from(JSON.stringify(serviceAccount)).toString("base64"));
  assert.equal((fromBase64.credentials as { client_email: string }).client_email, serviceAccount.client_email);
  assert.throws(() => storageClientOptions("not json"), /service account key/);
  assert.throws(() => storageClientOptions(JSON.stringify({ type: "service_account" })), /client_email or private_key/);
  // Unset keeps the existing Replit sidecar behaviour.
  assert.equal((storageClientOptions("").credentials as { audience: string }).audience, "replit");
  assert.equal((storageClientOptions("   ").credentials as { audience: string }).audience, "replit");
});

test("upload URLs are signed locally with the service account and map back to /objects paths", async () => {
  const { ObjectStorageService } = await import("./objectStorage");
  const service = new ObjectStorageService();
  const url = new URL(await service.getObjectEntityUploadURL());
  assert.equal(url.origin, "https://storage.googleapis.com");
  assert.match(url.pathname, /^\/school-bucket\/private\/uploads\/[0-9a-f-]{36}$/);
  assert.equal(url.searchParams.get("X-Goog-Algorithm"), "GOOG4-RSA-SHA256");
  assert.match(url.searchParams.get("X-Goog-Credential") ?? "", /^uploader@school-test\.iam\.gserviceaccount\.com\//);
  assert.equal(url.searchParams.get("X-Goog-Expires"), "900");
  assert.match(service.normalizeObjectEntityPath(url.toString()), /^\/objects\/uploads\/[0-9a-f-]{36}$/);
});

test("the API process can serve the built website without hiding API routes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "school-frontend-"));
  await mkdir(path.join(dir, "assets"));
  await writeFile(path.join(dir, "index.html"), "<!doctype html><title>School</title>");
  await writeFile(path.join(dir, "assets", "app-abc123.js"), "console.log(1)");
  await writeFile(path.join(dir, "robots.txt"), "User-agent: *");
  const app = express();
  assert.equal(serveFrontend(app, undefined), false);
  assert.equal(serveFrontend(app, dir), true);
  app.get("/api/healthz", (_req, res) => { res.json({ status: "ok" }); });
  app.use("/api", (_req, res) => { res.status(404).json({ error: "Not found" }); });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const route of ["/", "/admin", "/portal/exam/3", "/sign-in/factor-one"]) {
      const res = await fetch(root + route);
      assert.equal(res.status, 200, route);
      assert.match(await res.text(), /<title>School<\/title>/);
      assert.equal(res.headers.get("cache-control"), "no-cache");
    }
    const asset = await fetch(root + "/assets/app-abc123.js");
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("cache-control") ?? "", /immutable/);
    assert.equal((await fetch(root + "/assets/missing.js")).status, 404);
    assert.equal(await (await fetch(root + "/robots.txt")).text(), "User-agent: *");
    assert.deepEqual(await (await fetch(root + "/api/healthz")).json(), { status: "ok" });
    const unknownApi = await fetch(root + "/api/not-a-route");
    assert.equal(unknownApi.status, 404);
    assert.deepEqual(await unknownApi.json(), { error: "Not found" });
    assert.equal((await fetch(root + "/", { method: "POST" })).status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
  await assert.rejects(async () => serveFrontend(express(), path.join(dir, "missing")), /no index.html/);
});
