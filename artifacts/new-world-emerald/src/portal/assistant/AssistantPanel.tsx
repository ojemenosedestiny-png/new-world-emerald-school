import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAssistantConversationQueryKey, getGetAssistantQueryKey, useDeleteAssistantConversation, useGetAssistant, useGetAssistantConversation,
  type AssistantMessage,
} from "@workspace/api-client-react";
import { Bot, Check, Copy, Loader2, MessageSquarePlus, SendHorizontal, Sparkles, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ErrorPanel, Skeleton } from "../ui";
import { errorMessage } from "../lib";

const MUTED = "text-[hsl(var(--p-ink)/0.6)]";
const STARTERS = [
  "Write a lesson note on photosynthesis for JSS 2, with objectives and an evaluation.",
  "Give me 10 multiple-choice questions on fractions for Year 5, with the answer key.",
  "Draft a polite letter to parents about the mid-term break and resumption date.",
  "Suggest three report-card remarks for a hardworking student who struggles with Mathematics.",
];

/** Bold (**text**) and inline code (`code`) inside one line, as React elements (never raw HTML). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part.startsWith("`") && part.endsWith("`") ? <code key={i} className="rounded bg-[hsl(var(--p-paper-2))] px-1 font-mono text-[0.9em]">{part.slice(1, -1)}</code>
      : <Fragment key={i}>{part}</Fragment>);
}
/** A small, safe Markdown reader: headings, lists, numbered lists, code blocks and paragraphs. */
export function Rich({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) code.push(lines[i]);
      out.push(<pre key={i} className="overflow-x-auto rounded-lg bg-[hsl(var(--p-ink))] p-3 font-mono text-xs text-white">{code.join("\n")}</pre>);
    } else if (/^#{1,4}\s/.test(line)) {
      out.push(<p key={i} className="mt-2 font-semibold">{inline(line.replace(/^#+\s/, ""))}</p>);
    } else if (/^\s*[-*•]\s/.test(line)) {
      const items: string[] = [];
      for (; i < lines.length && /^\s*[-*•]\s/.test(lines[i]); i++) items.push(lines[i].replace(/^\s*[-*•]\s/, ""));
      i--;
      out.push(<ul key={i} className="ml-5 list-disc space-y-0.5">{items.map((t, k) => <li key={k}>{inline(t)}</li>)}</ul>);
    } else if (/^\s*\d+[.)]\s/.test(line)) {
      const items: string[] = [];
      for (; i < lines.length && /^\s*\d+[.)]\s/.test(lines[i]); i++) items.push(lines[i].replace(/^\s*\d+[.)]\s/, ""));
      i--;
      out.push(<ol key={i} className="ml-5 list-decimal space-y-0.5">{items.map((t, k) => <li key={k}>{inline(t)}</li>)}</ol>);
    } else if (line.trim()) {
      out.push(<p key={i}>{inline(line)}</p>);
    }
  }
  return <div className="space-y-2 text-sm leading-relaxed">{out}</div>;
}

function Bubble({ m, streaming = false }: { m: Pick<AssistantMessage, "role" | "content">; streaming?: boolean }) {
  const [copied, setCopied] = useState(false);
  const mine = m.role === "user";
  const copy = async () => { try { await navigator.clipboard.writeText(m.content); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } };
  return (
    <div className={"flex gap-3 " + (mine ? "justify-end" : "")}>
      {!mine && <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[hsl(var(--p-emerald))] text-white" aria-hidden="true"><Sparkles size={15} /></span>}
      <div className={"max-w-[85%] rounded-2xl px-4 py-3 " + (mine ? "bg-[hsl(var(--p-emerald))] text-white" : "border border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface))]")}>
        {mine ? <p className="whitespace-pre-wrap text-sm">{m.content}</p> : m.content ? <Rich text={m.content} /> : <Loader2 size={16} className="animate-spin" aria-label="Thinking" />}
        {!mine && !streaming && m.content && <button type="button" onClick={() => void copy()} className={"mt-2 inline-flex items-center gap-1 text-xs " + MUTED}>{copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}</button>}
      </div>
    </div>
  );
}

/** Sends one message and reads the answer as it streams (one JSON object per line). */
async function chat(body: { conversationId?: number; message: string }, onEvent: (e: { type: string; text?: string; error?: string; conversationId?: number }) => void, signal: AbortSignal) {
  const r = await fetch(import.meta.env.BASE_URL.replace(/\/$/, "") + "/api/portal/assistant/chat", {
    method: "POST", credentials: "include", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok || !r.body) { const e = await r.json().catch(() => null) as { error?: string } | null; throw new Error(e?.error ?? `The assistant could not answer (${r.status}).`); }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
}

/** The staff AI assistant: past chats on the left, the conversation on the right. */
export function AssistantPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const homeQ = useGetAssistant();
  const [active, setActive] = useState<number | null>(null);
  const convQ = useGetAssistantConversation(active ?? 0, { query: { enabled: !!active, queryKey: getGetAssistantConversationQueryKey(active ?? 0) } });
  const remove = useDeleteAssistantConversation();
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState<{ question: string; answer: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }); }, [live?.answer, convQ.data?.messages.length]);
  useEffect(() => () => abort.current?.abort(), []);

  if (homeQ.isLoading) return <Skeleton className="h-96" />;
  if (homeQ.isError || !homeQ.data) return <ErrorPanel title="The assistant did not load" message={errorMessage(homeQ.error)} onRetry={() => void homeQ.refetch()} />;
  const h = homeQ.data;
  if (!h.allowed) return <ErrorPanel title="For school staff" message="The AI assistant is for teachers, principals, the office and the Director." />;
  if (!h.enabled) return (
    <section className="portal-card p-6 text-center">
      <Bot size={28} className="mx-auto text-[hsl(var(--p-emerald))]" aria-hidden="true" />
      <h2 className="mt-2 font-serif text-xl font-semibold">The AI assistant is not switched on yet</h2>
      <p className={"mx-auto mt-1 max-w-md text-sm " + MUTED}>The school owner turns it on by adding the AI key on the server. It will appear here straight away.</p>
    </section>
  );
  const left = Math.max(0, h.dailyLimit - h.usedToday);
  const messages = convQ.data?.messages ?? [];

  const send = async (text = draft) => {
    const message = text.trim();
    if (!message || live) return;
    setDraft("");
    setLive({ question: message, answer: "" });
    abort.current = new AbortController();
    let conversationId = active ?? undefined;
    try {
      await chat({ ...(active ? { conversationId: active } : {}), message }, (e) => {
        if (e.type === "start" && e.conversationId) conversationId = e.conversationId;
        else if (e.type === "delta" && e.text) setLive((l) => (l ? { ...l, answer: l.answer + e.text } : l));
        else if (e.type === "error") throw new Error(e.error);
      }, abort.current.signal);
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast({ variant: "destructive", title: "No answer", description: errorMessage(e) });
    } finally {
      if (conversationId) {
        setActive(conversationId);
        await qc.invalidateQueries({ queryKey: getGetAssistantConversationQueryKey(conversationId) });
      }
      await qc.invalidateQueries({ queryKey: getGetAssistantQueryKey() });
      setLive(null);
    }
  };
  const del = async (id: number) => {
    if (!window.confirm("Delete this conversation?")) return;
    try {
      const next = await remove.mutateAsync({ id });
      qc.setQueryData(getGetAssistantQueryKey(), next);
      if (active === id) setActive(null);
    } catch (e) { toast({ variant: "destructive", title: "Not deleted", description: errorMessage(e) }); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]" data-testid="assistant-panel">
      <aside className="portal-card flex max-h-[70vh] flex-col !p-3">
        <button type="button" className="portal-btn w-full justify-center" disabled={!!live} onClick={() => setActive(null)} data-testid="button-new-chat"><MessageSquarePlus size={15} /> New chat</button>
        <p className={"mt-2 px-1 text-xs " + MUTED} data-testid="text-assistant-left">{left} of {h.dailyLimit} questions left today</p>
        <ul className="mt-2 flex-1 space-y-1 overflow-y-auto">
          {h.conversations.map((c) => (
            <li key={c.id} className={"group flex items-center gap-1 rounded-lg " + (active === c.id ? "bg-[hsl(var(--p-emerald)/0.1)]" : "hover:bg-[hsl(var(--p-paper-2))]")}>
              <button type="button" className="min-w-0 flex-1 truncate px-2 py-2 text-left text-sm" disabled={!!live} onClick={() => setActive(c.id)} data-testid={`button-chat-${c.id}`}>{c.title}</button>
              <button type="button" className="p-2 opacity-60 hover:opacity-100" aria-label={`Delete ${c.title}`} onClick={() => void del(c.id)}><Trash2 size={13} /></button>
            </li>
          ))}
          {!h.conversations.length && <li className={"px-2 py-3 text-xs " + MUTED}>Your conversations appear here. Only you can see them.</li>}
        </ul>
      </aside>
      <section className="portal-card flex min-h-[60vh] flex-col !p-0">
        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5" aria-live="polite">
          {!active && !live && (
            <div className="py-6 text-center">
              <Sparkles size={26} className="mx-auto text-[hsl(var(--p-gold))]" aria-hidden="true" />
              <h2 className="mt-2 font-serif text-2xl font-semibold">How can I help today?</h2>
              <p className={"mx-auto mt-1 max-w-md text-sm " + MUTED}>Lesson notes, exam questions with answers, report-card remarks, letters to parents, or any question. I can't see student records.</p>
              <div className="mx-auto mt-5 grid max-w-2xl gap-2 sm:grid-cols-2">
                {STARTERS.map((s) => <button key={s} type="button" className="rounded-xl border border-[hsl(var(--p-line))] p-3 text-left text-sm hover:bg-[hsl(var(--p-paper-2))]" disabled={left === 0} onClick={() => void send(s)}>{s}</button>)}
              </div>
            </div>
          )}
          {active && convQ.isLoading && <Skeleton className="h-40" />}
          {messages.map((m) => <Bubble key={m.id} m={m} />)}
          {live && <><Bubble m={{ role: "user", content: live.question }} /><Bubble m={{ role: "assistant", content: live.answer }} streaming /></>}
          <div ref={end} />
        </div>
        <form className="flex items-end gap-2 border-t border-[hsl(var(--p-line))] p-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <textarea className="portal-input min-h-[48px] flex-1 resize-y" rows={2} maxLength={8000} value={draft} disabled={left === 0}
            placeholder={left === 0 ? "You have used today's questions. Back tomorrow." : "Ask anything… (Enter to send, Shift+Enter for a new line)"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} data-testid="input-assistant" />
          {live
            ? <button type="button" className="portal-btn-ghost" onClick={() => abort.current?.abort()}>Stop</button>
            : <button type="submit" className="portal-btn" disabled={!draft.trim() || left === 0} aria-label="Send" data-testid="button-assistant-send"><SendHorizontal size={16} /></button>}
        </form>
        <p className={"px-4 pb-3 text-[11px] " + MUTED}>AI can make mistakes. Check facts, figures and dates before you use them.</p>
      </section>
    </div>
  );
}
