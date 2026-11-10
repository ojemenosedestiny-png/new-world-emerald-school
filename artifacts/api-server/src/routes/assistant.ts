import { Router, type Request } from "express";
import { and, asc, count, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { db, assistantConversations, assistantMessages } from "@workspace/db";
import { DeleteAssistantConversationParams, GetAssistantConversationParams } from "@workspace/api-zod";
import { check, portalActor } from "../lib/portal-auth";
import { isBursar, isExamOfficer, isSectionPrincipal, isWebsiteAdmin } from "../lib/website-admin";

/**
 * The staff AI assistant: a general helper for teachers, principals, the office and the Director. It drafts lesson
 * notes, exam questions, remarks and letters and answers questions. It is never given student records, and each
 * person sees only their own conversations. Powered by Claude; off until ANTHROPIC_API_KEY is set on the server.
 */
export const assistantRouter = Router();

const MODEL = "claude-opus-5-5";
const HISTORY = 40;
const MAX_CHARS = 8000;
export const dailyLimit = () => Math.max(1, Number(process.env.ASSISTANT_DAILY_LIMIT) || 40);
export const assistantEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY?.trim());

const SYSTEM = `You are the staff assistant inside the portal of New World Emerald Private School, a private nursery, primary and secondary school in Kubwa, Abuja, Nigeria. You help teachers, principals, the Head of School, the Director and the school office with their work.

The school: primary is Year 1 to Year 6; secondary is JSS 1 to JSS 3 and SS 1 to SS 3, following the Nigerian national curriculum. SS 3 students sit WAEC and NECO. Primary report cards use a First Half Term and a Second Half Term mark, each out of 100; secondary uses continuous assessment and an exam. The school year has three terms.

What you help with: lesson notes and schemes of work, exam and test questions with marking schemes, report-card remarks, letters and notices to parents, explaining topics, marking guidance, classroom management ideas, timetables, and everyday questions.

How to answer:
- Write in clear British English, the way a helpful, experienced colleague would. Use Nigerian examples, names and naira where they fit.
- Keep answers as short as the question allows; use headings and lists only when they make a long answer easier to use.
- For exam questions, give the answer key or marking scheme as well, unless asked not to.
- You cannot see the school's records (students, results, attendance, fees) and cannot change anything in the portal. If asked, say so plainly and suggest where in the portal to look.
- Do not ask for children's personal details. If someone pastes them, use only what the task needs and do not repeat them back unnecessarily.
- For medical, legal or safeguarding matters, give general guidance and advise involving the Head of School or a qualified professional.`;

/** The person's verified email when they may use the assistant; null otherwise. */
async function staffEmail(req: Request): Promise<string | null> {
  const email = req.identity?.email?.trim().toLowerCase();
  if (!req.dbUser || !email || !req.identity?.emailVerified) return null;
  if (isWebsiteAdmin(req) || isSectionPrincipal(req, "secondary") || isSectionPrincipal(req, "primary") || isExamOfficer(req) || isBursar(req)) return email;
  try { return (await portalActor(req)).role === "teacher" ? email : null; } catch { return null; }
}
async function owner(req: Request) {
  check(req.identity, "Sign in first.", 401);
  const email = await staffEmail(req);
  check(email, "The assistant is for school staff.", 403);
  return email;
}

const lagosMidnight = () => { const now = new Date(Date.now() + 3_600_000); return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 3_600_000); };
async function usedToday(email: string) {
  const [row] = await db.select({ n: count() }).from(assistantMessages)
    .innerJoin(assistantConversations, eq(assistantConversations.id, assistantMessages.conversationId))
    .where(and(eq(assistantConversations.ownerEmail, email), eq(assistantMessages.role, "user"), gte(assistantMessages.createdAt, lagosMidnight())));
  return Number(row?.n ?? 0);
}
async function home(email: string, allowed = true) {
  const conversations = await db.select().from(assistantConversations).where(eq(assistantConversations.ownerEmail, email)).orderBy(desc(assistantConversations.updatedAt)).limit(100);
  return {
    enabled: assistantEnabled(), allowed, dailyLimit: dailyLimit(), usedToday: await usedToday(email),
    conversations: conversations.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt.toISOString() })),
  };
}
async function ownConversation(id: number, email: string) {
  const [c] = await db.select().from(assistantConversations).where(eq(assistantConversations.id, id));
  check(c && c.ownerEmail === email, "Conversation not found.", 404);
  return c;
}

assistantRouter.get("/assistant", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  check(req.identity, "Sign in first.", 401);
  const email = await staffEmail(req);
  if (!email) { res.json({ enabled: assistantEnabled(), allowed: false, dailyLimit: dailyLimit(), usedToday: 0, conversations: [] }); return; }
  res.json(await home(email));
});

assistantRouter.get("/assistant/conversations/:id", async (req, res) => {
  const email = await owner(req);
  const { id } = GetAssistantConversationParams.parse(req.params);
  const c = await ownConversation(id, email);
  const messages = await db.select().from(assistantMessages).where(eq(assistantMessages.conversationId, c.id)).orderBy(asc(assistantMessages.id));
  res.setHeader("Cache-Control", "no-store");
  res.json({ id: c.id, title: c.title, messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt.toISOString() })) });
});

assistantRouter.delete("/assistant/conversations/:id", async (req, res) => {
  const email = await owner(req);
  const { id } = DeleteAssistantConversationParams.parse(req.params);
  await ownConversation(id, email);
  await db.delete(assistantConversations).where(eq(assistantConversations.id, id));
  res.json(await home(email));
});

export type Reply = { text: string; inputTokens: number; outputTokens: number; refused: boolean };
type Turn = { role: "user" | "assistant"; content: string };
/** Streams Claude's answer, calling onText for each piece; replaceable in tests. */
let streamReply = async (history: Turn[], onText: (t: string) => void, signal: AbortSignal): Promise<Reply> => {
  const client = new Anthropic();
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    // If the model declines on a safety category, the API retries on a fallback model inside the same call.
    fallbacks: "default",
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: history,
  }, { signal });
  stream.on("text", onText);
  const final = await stream.finalMessage();
  const text = final.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return { text, inputTokens: final.usage.input_tokens ?? 0, outputTokens: final.usage.output_tokens ?? 0, refused: final.stop_reason === "refusal" };
};
export function setAssistantReplyForTest(fn: typeof streamReply) { streamReply = fn; }

const ChatBody = z.object({ conversationId: z.number().int().positive().optional(), message: z.string() });

/** Send a message; the answer streams back as one JSON object per line (start, delta, done or error). */
assistantRouter.post("/assistant/chat", async (req, res) => {
  const email = await owner(req);
  check(assistantEnabled(), "The AI assistant is not switched on yet. The school owner adds the AI key on the server.", 503);
  const body = ChatBody.safeParse(req.body);
  check(body.success, "Type a message.");
  const message = body.data.message.trim();
  check(message.length > 0, "Type a message.");
  check(message.length <= MAX_CHARS, `Messages can be up to ${MAX_CHARS.toLocaleString("en-GB")} characters. Split it into parts.`);
  check(await usedToday(email) < dailyLimit(), `You have used today's ${dailyLimit()} questions. The assistant is available again tomorrow.`, 429);

  const conversation = body.data.conversationId
    ? await ownConversation(body.data.conversationId, email)
    : (await db.insert(assistantConversations).values({ ownerEmail: email, title: message.replace(/\s+/g, " ").slice(0, 60) }).returning())[0];
  const earlier = await db.select().from(assistantMessages).where(eq(assistantMessages.conversationId, conversation.id)).orderBy(desc(assistantMessages.id)).limit(HISTORY);
  const history: Turn[] = [...earlier.reverse().map((m) => ({ role: m.role as Turn["role"], content: m.content })), { role: "user", content: message }];
  // Turns must alternate and start with the user: drop a leading answer left over from trimming.
  while (history.length > 1 && history[0].role === "assistant") history.shift();
  await db.insert(assistantMessages).values({ conversationId: conversation.id, role: "user", content: message });

  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");
  const send = (o: object) => { if (!res.writableEnded) res.write(JSON.stringify(o) + "\n"); };
  send({ type: "start", conversationId: conversation.id, title: conversation.title });
  const abort = new AbortController();
  res.on("close", () => { if (!res.writableFinished) abort.abort(); });
  try {
    const reply = await streamReply(history, (text) => send({ type: "delta", text }), abort.signal);
    const text = reply.refused || !reply.text.trim()
      ? "Sorry, I can't help with that request. Try asking in a different way, or ask the Head of School."
      : reply.text;
    if (reply.refused) send({ type: "delta", text });
    const [saved] = await db.insert(assistantMessages).values({ conversationId: conversation.id, role: "assistant", content: text, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens }).returning();
    await db.update(assistantConversations).set({ updatedAt: new Date() }).where(eq(assistantConversations.id, conversation.id));
    send({ type: "done", messageId: saved.id });
  } catch (error) {
    if (abort.signal.aborted) return;
    const status = error instanceof Anthropic.APIError ? error.status : undefined;
    req.log.error({ err: error, status }, "Assistant reply failed");
    const friendly = status === 429 || status === 529 ? "The assistant is busy right now. Please try again in a minute."
      : status === 401 || status === 403 ? "The assistant's AI key is not working. Ask the school owner to check it on the server."
      : "The assistant could not answer just now. Please try again.";
    send({ type: "error", error: friendly });
  } finally {
    res.end();
  }
});
