import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListMessageThreads, getListMessageThreadsQueryKey, useGetMessageThread, getGetMessageThreadQueryKey, useReplyMessageThread,
  type MessageChannel, type MessageThreadSummary,
} from "@workspace/api-client-react";
import { ArrowLeft, MessagesSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorPanel, Skeleton } from "../ui";
import { errorMessage } from "../lib";
import { ChatComposer, ChatMessages } from "../chat";

const when = (iso: string) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat("en-NG", sameDay ? { hour: "numeric", minute: "2-digit" } : { day: "numeric", month: "short" }).format(d);
};

function Thread({ studentId, channel, onBack }: { studentId: number; channel: MessageChannel; onBack: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const key = getGetMessageThreadQueryKey(studentId, channel);
  const t = useGetMessageThread(studentId, channel, { query: { queryKey: key, refetchInterval: 15000 } });
  const reply = useReplyMessageThread();
  const onSend = async (body: string) => {
    try {
      queryClient.setQueryData(key, await reply.mutateAsync({ studentId, channel, data: { body } }));
      void queryClient.invalidateQueries({ queryKey: getListMessageThreadsQueryKey() });
      return true;
    } catch (e) { toast({ variant: "destructive", title: "Reply not sent", description: errorMessage(e) }); return false; }
  };
  return (
    <div className="space-y-3">
      <button type="button" className="portal-btn-ghost" onClick={() => { void queryClient.invalidateQueries({ queryKey: getListMessageThreadsQueryKey() }); onBack(); }} data-testid="button-thread-back"><ArrowLeft size={15} /> All messages</button>
      {t.isLoading ? <Skeleton className="h-80" /> : t.isError || !t.data ? <ErrorPanel title="Conversation did not load" message={errorMessage(t.error)} onRetry={() => t.refetch()} /> : (
        <section className="portal-card overflow-hidden">
          <header className="border-b border-[hsl(var(--p-line))] p-4">
            <p className="font-semibold" data-testid="text-thread-student">{t.data.studentName}</p>
            <p className="text-xs text-[hsl(var(--p-ink)/0.6)]">{t.data.studentCode} / {t.data.className} / {channel === "office" ? "To the school office" : "To the class teacher"}</p>
          </header>
          <ChatMessages messages={t.data.messages} mine="staff" empty="No messages yet." />
          <ChatComposer onSend={onSend} pending={reply.isPending} placeholder="Write a reply" />
        </section>
      )}
    </div>
  );
}

/** Staff inbox: conversations students started with their class teacher or the office. */
export function MessagesPanel({ isAdmin }: { isAdmin: boolean }) {
  const list = useListMessageThreads({ query: { queryKey: getListMessageThreadsQueryKey(), refetchInterval: 20000 } });
  const [open, setOpen] = useState<{ studentId: number; channel: MessageChannel } | null>(null);
  const [filter, setFilter] = useState<"all" | "unread" | MessageChannel>("all");
  if (open) return <Thread {...open} onBack={() => setOpen(null)} />;
  if (list.isLoading) return <Skeleton className="h-64" />;
  if (list.isError || !list.data) return <ErrorPanel title="Messages did not load" message={errorMessage(list.error)} onRetry={() => list.refetch()} />;
  const keep = (t: MessageThreadSummary) => filter === "all" || (filter === "unread" ? t.unread > 0 : t.channel === filter);
  const rows = list.data.filter(keep);
  const filters = (isAdmin ? ["all", "unread", "office", "class"] : ["all", "unread"]) as ("all" | "unread" | MessageChannel)[];
  const label = { all: "All", unread: "Unread", office: "Office", class: "Class teachers" };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={"rounded-full border px-3 py-1 text-sm font-semibold " + (filter === f ? "border-[hsl(var(--p-emerald))] bg-[hsl(var(--p-emerald))] text-white" : "border-[hsl(var(--p-line))]")} data-testid={`filter-messages-${f}`}>{label[f]}</button>
        ))}
        <p className="ml-auto text-xs text-[hsl(var(--p-ink)/0.55)]">{isAdmin ? "The office can read every conversation." : "Messages from students in your classes."}</p>
      </div>
      {!rows.length ? <EmptyState icon={<MessagesSquare size={22} />} title={list.data.length ? "Nothing here" : "No messages yet"} body="When a student writes from their portal, the conversation appears here." /> : (
        <ul className="portal-card divide-y divide-[hsl(var(--p-line))] overflow-hidden" data-testid="list-threads">
          {rows.map((t) => (
            <li key={`${t.studentId}-${t.channel}`}>
              <button type="button" onClick={() => setOpen({ studentId: t.studentId, channel: t.channel })} className="flex w-full items-center gap-3 p-4 text-left hover:bg-[hsl(var(--p-paper-2))]" data-testid={`thread-${t.studentId}-${t.channel}`}>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2"><span className={"truncate " + (t.unread ? "font-bold" : "font-semibold")}>{t.studentName}</span><span className="shrink-0 rounded-full bg-[hsl(var(--p-paper-2))] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">{t.channel === "office" ? "Office" : t.className}</span></span>
                  <span className="block truncate text-sm text-[hsl(var(--p-ink)/0.65)]">{t.lastFromStaff ? "You: " : ""}{t.lastBody}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-xs text-[hsl(var(--p-ink)/0.55)]">{when(t.lastAt)}</span>
                  {t.unread > 0 && <span className="rounded-full bg-[hsl(var(--p-red))] px-2 text-xs font-bold text-white">{t.unread}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
