import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool, portalClasses, portalPrincipals, portalReportWorkflow, portalTerms } from "@workspace/db";
import portalRouter from "../routes/portal";
import { setApprovedIdentitiesForTest } from "./approved-identities";

// Report card signatures: primary results are approved and signed by the Head Teacher (the Head of School), secondary
// by the principal; the Director's signature prints on both; the primary principal no longer signs.
test("signatures: Head Teacher signs primary, Director on every card, primary principal cannot sign", async () => {
  const marker = `QA-SIG-${randomUUID().slice(0, 8)}`.toUpperCase();
  const m = marker.toLowerCase();
  const office = `office-${m}@example.test`, head = `head-${m}@example.test`, director = `director-${m}@example.test`, primaryPrincipal = `pp-${m}@example.test`;
  const keys = ["SCHOOL_ADMIN_EMAILS", "SCHOOL_SUPER_ADMIN_EMAILS", "SCHOOL_HEAD_EMAILS", "SCHOOL_DIRECTOR_EMAILS", "SCHOOL_PRIMARY_PRINCIPAL_EMAILS"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const before = await db.select().from(portalPrincipals).where(inArray(portalPrincipals.section, ["head", "director"]));
  process.env.SCHOOL_ADMIN_EMAILS = `${office}, ${director}`;
  process.env.SCHOOL_SUPER_ADMIN_EMAILS = `owner-${m}@example.test`;
  process.env.SCHOOL_HEAD_EMAILS = head;
  process.env.SCHOOL_DIRECTOR_EMAILS = director;
  process.env.SCHOOL_PRIMARY_PRINCIPAL_EMAILS = primaryPrincipal;
  setApprovedIdentitiesForTest([office, head, director, primaryPrincipal].map((e) => [`id-${e}`, { email: e, mfa: true }]));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error() {}, warn() {}, info() {} } as unknown as typeof req.log;
    const who = req.headers["x-test-user"];
    if (typeof who === "string") { req.dbUser = { id: `id-${who}` } as NonNullable<typeof req.dbUser>; req.identity = { email: who, emailVerified: true, mfa: true }; }
    next();
  });
  app.use("/api/portal", portalRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/portal`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (path: string, who: string, body?: unknown): Promise<{ status: number; data: any }> => {
    const r = await fetch(root + path, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", "X-Test-User": who }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const sig = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const classIds: number[] = [];
  let termId = 0;
  try {
    const [y3, jss1] = await db.insert(portalClasses).values([{ name: `${marker} Year 3 Ruby` }, { name: `${marker} JSS 1 Gold` }]).returning();
    classIds.push(y3.id, jss1.id);
    const [term] = await db.insert(portalTerms).values({ session: marker, term: "First Term" }).returning();
    termId = term.id;
    for (const c of [y3, jss1]) await db.insert(portalReportWorkflow).values({ termId, classId: c.id, status: "review", teacherName: "Class teacher" });

    // Who may set which signature.
    assert.deepEqual((await call("/signatures", head)).data.roles, ["head"]);
    assert.deepEqual((await call("/signatures", director)).data.roles, ["director"]);
    assert.equal((await call("/signatures", office, { role: "head", name: "Office", signature: sig })).status, 403);
    assert.equal((await call("/signatures", director, { role: "head", name: "Director", signature: sig })).status, 403);

    // Primary results: the office cannot approve; the Head Teacher must save a signature first.
    const approve = (who: string, classId: number) => call("/reports/manage", who, { action: "workflow", workflow: { termId, classId, action: "approve" } });
    assert.equal((await approve(office, y3.id)).status, 403);
    await db.delete(portalPrincipals).where(eq(portalPrincipals.section, "head"));
    assert.equal((await approve(head, y3.id)).status, 409, "signature first");
    assert.equal((await call("/signatures", head, { role: "head", name: "Mrs Head", signature: sig })).status, 200);
    assert.equal((await call("/signatures", director, { role: "director", name: "Dr Director", signature: sig })).status, 200);
    assert.equal((await approve(head, y3.id)).status, 200);
    const [row] = await db.select().from(portalReportWorkflow).where(and(eq(portalReportWorkflow.termId, termId), eq(portalReportWorkflow.classId, y3.id)));
    assert.equal(row.principalName, "Mrs Head");

    // The cards carry the Head Teacher (primary) and the Director.
    const ws = await call(`/reports/manage?termId=${termId}&classId=${y3.id}`, office);
    assert.equal(ws.status, 200);
    assert.equal(ws.data.cardPrincipalName, "Mrs Head");
    assert.equal(ws.data.cardDirectorName, "Dr Director");
    // Secondary: the office still approves; the Director prints there too.
    assert.equal((await approve(office, jss1.id)).status, 200);
    assert.equal((await call(`/reports/manage?termId=${termId}&classId=${jss1.id}`, office)).data.cardDirectorName, "Dr Director");

    // The primary principal no longer signs results.
    await db.update(portalReportWorkflow).set({ status: "review" }).where(and(eq(portalReportWorkflow.termId, termId), eq(portalReportWorkflow.classId, y3.id)));
    const pp = await call("/principal/results", primaryPrincipal, { action: "approve", section: "primary", termId, classId: y3.id });
    assert.equal(pp.status, 403);
    assert.match(pp.data.error, /Head Teacher/);
  } finally {
    server.close();
    if (termId) { await db.delete(portalReportWorkflow).where(eq(portalReportWorkflow.termId, termId)); await db.delete(portalTerms).where(eq(portalTerms.id, termId)); }
    if (classIds.length) await db.delete(portalClasses).where(inArray(portalClasses.id, classIds));
    await db.delete(portalPrincipals).where(inArray(portalPrincipals.section, ["head", "director"]));
    if (before.length) await db.insert(portalPrincipals).values(before);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await pool.end();
  }
});
