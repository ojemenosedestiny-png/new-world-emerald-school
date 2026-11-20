import { Fragment, useEffect, useRef, useState } from "react";
import type { PortalChatMessage } from "@workspace/api-client-react";
import { CheckCheck, Send } from "lucide-react";
import { dayHeading } from "./lib";

export const MAX_MESSAGE = 1000;

const time = (iso: string) => new Intl.DateTimeFormat("en-NG", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const dayKey = (iso: string) => new Date(iso).toDateString();

/** Conversation bubbles grouped by day; `mine` says which side is the viewer (staff or student). */
export function ChatMessages({ messages, mine, empty }: { messages: PortalChatMessage[]; mine: "staff" | "student"; empty: string }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }); }, [messages.length]);
  if (!messages.length) return <p className="px-6 py-14 text-center text-sm text-[hsl(var(--p-ink)/0.55)]">{empty}</p>;
  return (
    <div className="max-h-[55vh] space-y-2 overflow-y-auto p-4" data-testid="list-chat" aria-live="polite">
      {messages.map((m, i) => {
        const own = m.fromStaff === (mine === "staff");
        const newDay = i === 0 || dayKey(messages[i - 1].createdAt) !== dayKey(m.createdAt);
        return (
          <Fragment key={m.id}>
            {newDay && (
              <div className="flex items-center gap-3 py-2" aria-hidden="true">
                <span className="h-px flex-1 bg-[hsl(var(--p-line))]" />
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--p-ink)/0.5)]">{dayHeading(m.createdAt)}</span>
                <span className="h-px flex-1 bg-[hsl(var(--p-line))]" />
              </div>
            )}
            <div className={"flex " + (own ? "justify-end" : "justify-start")}>
              <div className={"max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm " + (own ? "rounded-br-md bg-[hsl(var(--p-emerald))] text-white" : "rounded-bl-md border border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface))]")} data-testid={`message-${m.id}`}>
                {!own && <p className="mb-0.5 text-[11px] font-bold text-[hsl(var(--p-emerald))]">{m.senderName}</p>}
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className={"mt-1 flex items-center justify-end gap-1 text-[10px] " + (own ? "text-white/75" : "opacity-55")}>{time(m.createdAt)}{own && m.read ? <><CheckCheck size={12} aria-hidden /> Seen</> : null}</p>
              </div>
            </div>
          </Fragment>
        );
      })}
      <div ref={end} />
    </div>
  );
}

/** Text box and send button; Enter sends, Shift+Enter adds a line. Suggestions fill the box with one tap. */
export function ChatComposer({ onSend, pending, placeholder, suggestions = [], disabled = false }: { onSend: (body: string) => Promise<boolean>; pending: boolean; placeholder: string; suggestions?: string[]; disabled?: boolean }) {
  const [body, setBody] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const send = async () => {
    const text = body.trim();
    if (!text || pending || disabled) return;
    if (await onSend(text)) setBody("");
  };
  const left = MAX_MESSAGE - body.length;
  return (
    <div className="border-t border-[hsl(var(--p-line))] bg-[hsl(var(--p-paper-2)/0.4)] p-3">
      {!body && suggestions.length > 0 && !disabled && (
        <div className="mb-2 flex flex-wrap gap-1.5" data-testid="chat-suggestions">
          {suggestions.map((s) => (
            <button key={s} type="button" className="rounded-full border border-[hsl(var(--p-emerald)/0.35)] bg-[hsl(var(--p-surface))] px-3 py-1 text-xs font-medium text-[hsl(var(--p-emerald))] transition hover:bg-[hsl(var(--p-emerald-soft))]"
              onClick={() => { setBody(s); box.current?.focus(); }}>{s}</button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea ref={box} className="portal-input min-h-11 flex-1 resize-none !py-2.5" rows={body.includes("\n") ? 3 : 1} maxLength={MAX_MESSAGE} value={body} placeholder={placeholder} aria-label="Message" disabled={disabled}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
          data-testid="input-chat" />
        <button type="button" className="portal-btn !px-3.5" disabled={pending || disabled || !body.trim()} onClick={() => void send()} aria-label="Send message" data-testid="button-chat-send"><Send size={16} /></button>
      </div>
      {body.length > 800 && <p className={"mt-1 text-right text-[11px] " + (left < 50 ? "font-semibold text-[hsl(var(--p-red))]" : "text-[hsl(var(--p-ink)/0.5)]")}>{left} characters left</p>}
    </div>
  );
}
