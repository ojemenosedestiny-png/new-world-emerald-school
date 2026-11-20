import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListMessageThreads, getListMessageThreadsQueryKey, useGetMessageThread, getGetMessageThreadQueryKey, useReplyMessageThread,
  useGetPrivateMessageThread, getGetPrivateMessageThreadQueryKey, useReplyPrivateMessageThread,
  type MessageChannel, type MessageThreadSummary, type StaffMessageThread,
} from "@workspace/api-client-react";
import { ArrowLeft, Building2, GraduationCap, Lock, MessagesSquare, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorPanel, Skeleton } from "../ui";
import { errorMessage } from "../lib";
import { Avatar } from "../photos";
import { ChatComposer, ChatMessages } from "../chat";

const when = (iso: string) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat("en-NG", sameDay ? { hour: "numeric", minute: "2-digit" } : { day: "numeric", month: "short" }).format(d);
};
type Open = { studentId: number; channel: MessageChannel; teacherId?: number | null };
const rowKey = (t: { studentId: number; channel: MessageChannel; teacherId?: number | null }) => t.channel === "teacher" ? `${t.studentId}-teacher-${t.teacherId}` : `${t.studentId}-${t.channel}`;

function ThreadView({ data, channel, onSend, pending }: { data: StaffMessageThread; channel: MessageChannel; onSend: (body: string) => Promise<boolean>; pending: boolean }) {
  const isPrivate = channel === "teacher";
  return (
    <section className="portal-card overflow-hidden">
      <header className="flex items-center gap-3 border-b border-[hsl(var(--p-line))] p-4">
        <Avatar name={data.studentName} size={44} hue="156 62% 30%" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold" data-testid="text-thread-student">{data.studentName}</p>
          <p className="flex flex-wrap items-center gap-1 text-xs text-[hsl(var(--p-ink)/0.6)]">{data.studentCode} / {data.className} / {isPrivate
            ? <span className="inline-flex items-center gap-1 font-semibold text-[hsl(var(--p-gold-ink))]" data-testid="text-thread-private"><Lock size={11} aria-hidden /> Private to {data.teacherName || "one teacher"}</span>
            : channel === "office" ? "To the school office" : "To the class teacher"}</p>
        </div>
      </header>
      <ChatMessages messages={data.messages} mine="staff" empty="No messages yet." />
      {data.canReply === false
        ? <p className="border-t border-[hsl(var(--p-line))] bg-[hsl(var(--p-paper-2)/0.5)] p-4 text-sm text-[hsl(var(--p-ink)/0.7)]" data-testid="text-thread-readonly">You can read this conversation to keep students safe. Only {data.teacherName || "the teacher"} can answer it.</p>
        : <ChatComposer onSend={onSend} pending={pending} placeholder={isPrivate ? `Reply privately to ${data.studentName}` : "Write a reply"} />}
    </section>
  );
}

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
      {t.isLoading ? <Skeleton className="h-80" /> : t.isError || !t.data ? <ErrorPanel title="Conversation did not load" message={errorMessage(t.error)} onRetry={() => t.refetch()} />
        : <ThreadView data={t.data} channel={channel} onSend={onSend} pending={reply.isPending} />}
    </div>
  );
}

function PrivateThread({ studentId, teacherId, onBack }: { studentId: number; teacherId: number; onBack: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const key = getGetPrivateMessageThreadQueryKey(studentId, teacherId);
  const t = useGetPrivateMessageThread(studentId, teacherId, { query: { queryKey: key, refetchInterval: 15000 } });
  const reply = useReplyPrivateMessageThread();
  const onSend = async (body: string) => {
    try {
      queryClient.setQueryData(key, await reply.mutateAsync({ studentId, teacherId, data: { body } }));
      void queryClient.invalidateQueries({ queryKey: getListMessageThreadsQueryKey() });
      return true;
    } catch (e) { toast({ variant: "destructive", title: "Reply not sent", description: errorMessage(e) }); return false; }
  };
  return (
    <div className="space-y-3">
      <button type="button" className="portal-btn-ghost" onClick={() => { void queryClient.invalidateQueries({ queryKey: getListMessageThreadsQueryKey() }); onBack(); }} data-testid="button-thread-back"><ArrowLeft size={15} /> All messages</button>
      {t.isLoading ? <Skeleton className="h-80" /> : t.isError || !t.data ? <ErrorPanel title="Conversation did not load" message={errorMessage(t.error)} onRetry={() => t.refetch()} />
        : <ThreadView data={t.data} channel="teacher" onSend={onSend} pending={reply.isPending} />}
    </div>
  );
}

type Filter = "all" | "unread" | "private" | "office" | "class";

/** Staff inbox: conversations students started with their class teacher, the office, or one teacher privately. */
export function MessagesPanel({ isAdmin }: { isAdmin: boolean }) {
  const list = useListMessageThreads({ query: { queryKey: getListMessageThreadsQueryKey(), refetchInterval: 20000 } });
  const [open, setOpen] = useState<Open | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  if (open) return open.channel === "teacher" && open.teacherId
    ? <PrivateThread studentId={open.studentId} teacherId={open.teacherId} onBack={() => setOpen(null)} />
    : <Thread studentId={open.studentId} channel={open.channel} onBack={() => setOpen(null)} />;
  if (list.isLoading) return <Skeleton className="h-64" />;
  if (list.isError || !list.data) return <ErrorPanel title="Messages did not load" message={errorMessage(list.error)} onRetry={() => list.refetch()} />;
  const s = search.trim().toLowerCase();
  const keep = (t: MessageThreadSummary) => (filter === "all" || (filter === "unread" ? t.unread > 0 : filter === "private" ? t.channel === "teacher" : t.channel === filter))
    && (!s || [t.studentName, t.studentCode, t.className, t.teacherName ?? ""].some((v) => v.toLowerCase().includes(s)));
  const rows = list.data.filter(keep);
  const filters: Filter[] = isAdmin ? ["all", "unread", "private", "office", "class"] : ["all", "unread", "private"];
  const label: Record<Filter, string> = { all: "All", unread: "Unread", private: "Private", office: "Office", class: "Class teachers" };
  const unreadTotal = list.data.reduce((n, t) => n + t.unread, 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={"inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-semibold transition " + (filter === f ? "border-[hsl(var(--p-emerald))] bg-[hsl(var(--p-emerald))] text-white" : "border-[hsl(var(--p-line))] hover:border-[hsl(var(--p-emerald)/0.5)]")} data-testid={`filter-messages-${f}`}>
            {f === "private" && <Lock size={12} aria-hidden />}{label[f]}{f === "unread" && unreadTotal > 0 ? ` (${unreadTotal})` : ""}
          </button>
        ))}
        <label className="relative ml-auto min-w-[12rem]"><span className="sr-only">Search messages</span>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--p-ink)/0.45)]" aria-hidden />
          <input className="portal-input !py-1.5 !pl-8 text-sm" placeholder="Search a student or class" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-messages-search" />
        </label>
      </div>
      <p className="text-xs text-[hsl(var(--p-ink)/0.55)]">{isAdmin ? "The office can read every conversation, including private ones, to keep students safe. Only the teacher a student chose answers a private conversation." : "Messages from students in your classes, and private messages students sent to you alone. Other teachers do not see your private messages."}</p>
      {!rows.length ? <EmptyState icon={<MessagesSquare size={22} />} title={list.data.length ? "Nothing here" : "No messages yet"} body="When a student writes from their portal, the conversation appears here." /> : (
        <ul className="portal-card divide-y divide-[hsl(var(--p-line))] overflow-hidden" data-testid="list-threads">
          {rows.map((t) => {
            const isPrivate = t.channel === "teacher";
            return (
              <li key={rowKey(t)}>
                <button type="button" onClick={() => setOpen({ studentId: t.studentId, channel: t.channel, teacherId: t.teacherId })} className={"flex w-full items-center gap-3 p-4 text-left transition hover:bg-[hsl(var(--p-paper-2))] " + (t.unread ? "bg-[hsl(var(--p-emerald-soft)/0.25)]" : "")} data-testid={`thread-${rowKey(t)}`}>
                  <span className="relative">
                    <Avatar name={t.studentName} size={42} hue="156 62% 30%" />
                    <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full border-2 border-[hsl(var(--p-surface))] bg-[hsl(var(--p-surface))] text-[hsl(var(--p-emerald))]" aria-hidden>
                      {isPrivate ? <Lock size={10} /> : t.channel === "office" ? <Building2 size={10} /> : <GraduationCap size={10} />}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={"truncate " + (t.unread ? "font-bold" : "font-semibold")}>{t.studentName}</span>
                      <span className="shrink-0 rounded-full bg-[hsl(var(--p-paper-2))] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">{t.channel === "office" ? "Office" : t.className}</span>
                      {isPrivate && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[hsl(var(--p-gold-soft))] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[hsl(var(--p-gold-ink))]"><Lock size={9} aria-hidden /> {isAdmin && t.teacherName ? `Private to ${t.teacherName}` : "Private"}</span>}
                    </span>
                    <span className="block truncate text-sm text-[hsl(var(--p-ink)/0.65)]">{t.lastFromStaff ? "You: " : ""}{t.lastBody}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-xs text-[hsl(var(--p-ink)/0.55)]">{when(t.lastAt)}</span>
                    {t.unread > 0 && <span className="rounded-full bg-[hsl(var(--p-red))] px-2 text-xs font-bold text-white">{t.unread}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
