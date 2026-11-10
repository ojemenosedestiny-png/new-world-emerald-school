import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { inArray } from "drizzle-orm";
import { db, pool, assistantConversations } from "@workspace/db";
import portalRouter from "../routes/portal";
import { setApprovedIdentitiesForTest } from "./approved-identities";
import { setAssistantReplyForTest } from "../routes/assistant";

// The staff AI assistant (with a stand-in for Claude): staff only, each person's chats private, history sent back,
// answers streamed and saved, a daily limit, and friendly errors.
test("assistant: staff chat with history, private conversations, daily limit", async () => {
  const marker = randomUUID().slice(0, 8);
  const head = `head-${marker}@example.test`, office = `office-${marker}@example.test`, outsider = `parent-${marker}@example.test`;
  const keys = ["SCHOOL_ADMIN_EMAILS", "SCHOOL_HEAD_EMAILS", "ANTHROPIC_API_KEY", "ASSISTANT_DAILY_LIMIT"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.SCHOOL_ADMIN_EMAILS = office;
  process.env.SCHOOL_HEAD_EMAILS = head;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.ASSISTANT_DAILY_LIMIT = "3";
  setApprovedIdentitiesForTest([head, office].map((e) => [`id-${e}`, { email: e, mfa: true }]));
  const seen: { role: string; content: string }[][] = [];
  let fail = false;
  setAssistantReplyForTest(async (history, onText) => {
    seen.push(history);
    if (fail) throw new Error("upstream down");
    for (const part of ["Here is ", "a lesson note."]) onText(part);
    return { text: "Here is a lesson note.", inputTokens: 120, outputTokens: 8, refused: false };
  });
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
  const get = async (path: string, who: string, method = "GET"): Promise<{ status: number; data: any }> => {
    const r = await fetch(root + path, { method, headers: { "X-Test-User": who } });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const chat = async (who: string, body: object) => {
    const r = await fetch(root + "/assistant/chat", { method: "POST", headers: { "Content-Type": "application/json", "X-Test-User": who }, body: JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, events: r.headers.get("content-type")?.includes("ndjson") ? text.trim().split("\n").map((l) => JSON.parse(l)) : [], text };
  };
  try {
    // Off until the key is set; not for parents.
    assert.equal((await get("/assistant", head)).data.enabled, false);
    assert.equal((await chat(head, { message: "Hello" })).status, 503);
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    assert.equal((await get("/assistant", outsider)).data.allowed, false);
    assert.equal((await chat(outsider, { message: "Hello" })).status, 403);
    assert.equal((await chat(head, { message: "   " })).status, 400);
    assert.equal((await chat(head, { message: "x".repeat(8001) })).status, 400);

    // A new chat streams the answer and is saved.
    const first = await chat(head, { message: "Write a lesson note on photosynthesis for JSS 2" });
    assert.equal(first.status, 200);
    assert.deepEqual(first.events.map((e) => e.type), ["start", "delta", "delta", "done"]);
    const id = first.events[0].conversationId;
    assert.equal(first.events[0].title, "Write a lesson note on photosynthesis for JSS 2");
    const conv = await get(`/assistant/conversations/${id}`, head);
    assert.deepEqual(conv.data.messages.map((m: { role: string }) => m.role), ["user", "assistant"]);
    assert.equal(conv.data.messages[1].content, "Here is a lesson note.");

    // The follow-up carries the history.
    await chat(head, { conversationId: id, message: "Shorter please" });
    assert.deepEqual(seen.at(-1)!.map((m) => m.role), ["user", "assistant", "user"]);
    assert.equal(seen.at(-1)![2].content, "Shorter please");

    // Conversations are private to their owner.
    assert.equal((await get(`/assistant/conversations/${id}`, office)).status, 404);
    assert.equal((await chat(office, { conversationId: id, message: "peek" })).status, 404);
    assert.equal((await get("/assistant", office)).data.conversations.length, 0);

    // An upstream failure is reported kindly, not as a crash.
    fail = true;
    const broken = await chat(head, { conversationId: id, message: "again" });
    assert.equal(broken.events.at(-1).type, "error");
    assert.match(broken.events.at(-1).error, /try again/);
    fail = false;

    // Daily limit: three questions (the failed one counts too).
    const home = await get("/assistant", head);
    assert.equal(home.data.usedToday, 3);
    assert.equal((await chat(head, { message: "one more" })).status, 429);

    // Deleting removes it.
    const after = await get(`/assistant/conversations/${id}`, head, "DELETE");
    assert.equal(after.status, 200);
    assert.equal(after.data.conversations.length, 0);
    assert.equal((await get(`/assistant/conversations/${id}`, head)).status, 404);
  } finally {
    server.close();
    await db.delete(assistantConversations).where(inArray(assistantConversations.ownerEmail, [head, office, outsider]));
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await pool.end();
  }
});
