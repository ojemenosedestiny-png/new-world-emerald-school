import { useEffect, useRef, useState } from "react";
import type { PortalChatMessage } from "@workspace/api-client-react";
import { Send } from "lucide-react";

export const MAX_MESSAGE = 1000;

const stamp = (iso: string) => new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/** Conversation bubbles; `mine` says which side is the viewer (staff or student). */
export function ChatMessages({ messages, mine, empty }: { messages: PortalChatMessage[]; mine: "staff" | "student"; empty: string }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }); }, [messages.length]);
  if (!messages.length) return <p className="py-10 text-center text-sm text-[hsl(var(--p-ink)/0.55)]">{empty}</p>;
  return (
    <div className="max-h-[55vh] space-y-2 overflow-y-auto p-4" data-testid="list-chat" aria-live="polite">
      {messages.map((m) => {
        const own = m.fromStaff === (mine === "staff");
        return (
          <div key={m.id} className={"flex " + (own ? "justify-end" : "justify-start")}>
            <div className={"max-w-[85%] rounded-2xl px-3.5 py-2 text-sm " + (own ? "rounded-br-md bg-[hsl(var(--p-emerald))] text-white" : "rounded-bl-md bg-[hsl(var(--p-paper-2))]")} data-testid={`message-${m.id}`}>
              {!own && <p className="mb-0.5 text-[11px] font-bold opacity-70">{m.senderName}</p>}
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <p className={"mt-1 text-right text-[10px] " + (own ? "text-white/70" : "opacity-55")}>{stamp(m.createdAt)}{own && m.read ? " / Seen" : ""}</p>
            </div>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}

/** Text box and send button; Enter sends, Shift+Enter adds a line. */
export function ChatComposer({ onSend, pending, placeholder }: { onSend: (body: string) => Promise<boolean>; pending: boolean; placeholder: string }) {
  const [body, setBody] = useState("");
  const send = async () => {
    const text = body.trim();
    if (!text || pending) return;
    if (await onSend(text)) setBody("");
  };
  return (
    <div className="flex items-end gap-2 border-t border-[hsl(var(--p-line))] p-3">
      <textarea className="portal-input min-h-11 flex-1 resize-none !py-2.5" rows={1} maxLength={MAX_MESSAGE} value={body} placeholder={placeholder} aria-label="Message"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
        data-testid="input-chat" />
      <button type="button" className="portal-btn !px-3.5" disabled={pending || !body.trim()} onClick={() => void send()} aria-label="Send message" data-testid="button-chat-send"><Send size={16} /></button>
    </div>
  );
}
