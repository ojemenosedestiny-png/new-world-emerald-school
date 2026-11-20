import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMyMessages, getGetMyMessagesQueryKey, useSendMyMessage, useMarkMyMessagesRead,
  type MessageTeacher, type StudentThread,
} from "@workspace/api-client-react";
import { ArrowLeft, Building2, GraduationCap, Lock, PenSquare, Search, ShieldCheck, Users, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ErrorPanel, Skeleton } from "./ui";
import { errorMessage } from "./lib";
import { Avatar } from "./photos";
import { ChatComposer, ChatMessages } from "./chat";

type Sel = { channel: "class" | "office" } | { channel: "teacher"; teacherId: number };
const keyOf = (p: Sel) => (p.channel === "teacher" ? `teacher-${p.teacherId}` : p.channel);
const threadKey = (t: StudentThread) => (t.channel === "teacher" ? `teacher-${t.teacherId}` : t.channel);
const HUES = ["156 62% 30%", "28 78% 42%", "212 60% 42%", "340 52% 42%", "262 42% 46%", "190 62% 32%"];
const hueOf = (id: number) => HUES[id % HUES.length];
const preview = (t: StudentThread) => { const m = t.messages[t.messages.length - 1]; return m ? (m.fromStaff ? "" : "You: ") + m.body : ""; };

const SUGGEST: Record<string, string[]> = {
  class: ["I will be absent tomorrow.", "I was sick and missed class.", "Please can you explain today's homework?"],
  office: ["When is the next PTA meeting?", "How do I pay my school fees?", "I need a new ID card."],
  teacher: ["Please can you explain this topic again?", "I need help with my assignment.", "Thank you for today's lesson."],
};

/** Picks a teacher to write to privately: the class teacher first, then the teachers of the student's subjects. */
function TeacherPicker({ teachers, onPick, onClose }: { teachers: MessageTeacher[]; onPick: (t: MessageTeacher) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const s = q.trim().toLowerCase();
  const shown = teachers.filter((t) => !s || t.name.toLowerCase().includes(s) || t.subjects.some((x) => x.toLowerCase().includes(s)));
  return (
    <section className="portal-card overflow-hidden" aria-labelledby="pick-teacher" data-testid="teacher-picker">
      <header className="flex items-center gap-3 border-b border-[hsl(var(--p-line))] p-4">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-[hsl(var(--p-emerald))] text-[hsl(var(--p-paper))]"><PenSquare size={18} aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h3 id="pick-teacher" className="font-serif text-xl font-semibold">Message a teacher</h3>
          <p className="text-xs text-[hsl(var(--p-ink)/0.6)]">Choose who to write to. Only that teacher can read and answer it.</p>
        </div>
        <button type="button" className="portal-btn-ghost !px-2" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </header>
      <div className="p-4">
        <label className="relative block"><span className="sr-only">Search teachers</span>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--p-ink)/0.45)]" aria-hidden />
          <input className="portal-input !pl-9" placeholder="Search by name or subject" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-teacher-search" />
        </label>
        {!teachers.length ? <p className="py-8 text-center text-sm text-[hsl(var(--p-ink)/0.6)]">No teachers are listed for your class yet. Write to the school office instead.</p>
          : !shown.length ? <p className="py-8 text-center text-sm text-[hsl(var(--p-ink)/0.6)]">No teacher matches "{q}".</p> : (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {shown.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => onPick(t)} className="group flex w-full items-center gap-3 rounded-2xl border border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface))] p-3 text-left transition hover:-translate-y-0.5 hover:border-[hsl(var(--p-emerald)/0.5)] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--p-emerald))]" data-testid={`pick-teacher-${t.id}`}>
                    <Avatar name={t.name} photoId={t.photoId} size={46} hue={hueOf(t.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5"><span className="truncate font-semibold">{t.name}</span>{t.classTeacher && <span className="shrink-0 rounded-full bg-[hsl(var(--p-gold-soft))] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[hsl(var(--p-gold-ink))]">Class teacher</span>}</span>
                      <span className="block truncate text-xs text-[hsl(var(--p-ink)/0.6)]">{t.subjects.length ? t.subjects.join(" · ") : t.title || "Teacher"}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>
    </section>
  );
}

/** The student's conversations: their class teacher, the school office, and private conversations with any of their teachers. */
export function StudentMessages() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const q = useGetMyMessages({ query: { queryKey: getGetMyMessagesQueryKey(), refetchInterval: 20000 } });
  const send = useSendMyMessage();
  const markRead = useMarkMyMessagesRead();
  const [pick, setPick] = useState<Sel>({ channel: "class" });
  const [picking, setPicking] = useState(false);
  const [mobileChat, setMobileChat] = useState(false);
  const teachers = q.data?.teachers ?? [];
  const threads = q.data?.threads ?? [];
  const pickedTeacher = pick.channel === "teacher" ? teachers.find((t) => t.id === pick.teacherId) : undefined;
  const thread: StudentThread | undefined = useMemo(() => threads.find((t) => threadKey(t) === keyOf(pick))
    ?? (pick.channel === "teacher" ? { channel: "teacher", title: pickedTeacher?.name ?? "Teacher", unread: 0, messages: [], teacherId: pick.teacherId, closed: !pickedTeacher } : undefined), [threads, pick, pickedTeacher]);
  const unread = thread?.unread ?? 0;
  const privateThreads = threads.filter((t) => t.channel === "teacher");
  const generalThreads = threads.filter((t) => t.channel !== "teacher");

  // Opening a conversation (or a new reply arriving while it is open) marks the replies read.
  useEffect(() => {
    if (!unread || markRead.isPending) return;
    const data = pick.channel === "teacher" ? { channel: pick.channel, teacherId: pick.teacherId } : { channel: pick.channel };
    markRead.mutate({ data }, { onSuccess: (d) => queryClient.setQueryData(getGetMyMessagesQueryKey(), d) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyOf(pick), unread]);

  if (q.isLoading) return <Skeleton className="h-80" />;
  if (q.isError || !q.data || !thread) return <ErrorPanel title="Messages could not load" message={errorMessage(q.error)} onRetry={() => q.refetch()} />;

  const open = (p: Sel) => { setPick(p); setPicking(false); setMobileChat(true); };
  const onSend = async (body: string) => {
    try {
      const data = pick.channel === "teacher" ? { channel: pick.channel, body, teacherId: pick.teacherId } : { channel: pick.channel, body };
      queryClient.setQueryData(getGetMyMessagesQueryKey(), await send.mutateAsync({ data }));
      return true;
    } catch (e) { toast({ variant: "destructive", title: "Message not sent", description: errorMessage(e) }); return false; }
  };

  const Row = ({ t }: { t: StudentThread }) => {
    const on = threadKey(t) === keyOf(pick) && !picking;
    const teacher = t.channel === "teacher" ? teachers.find((x) => x.id === t.teacherId) : undefined;
    const last = preview(t);
    return (
      <button type="button" role="tab" aria-selected={on} onClick={() => open(t.channel === "teacher" ? { channel: "teacher", teacherId: t.teacherId! } : { channel: t.channel as "class" | "office" })}
        className={"flex w-full items-center gap-3 rounded-2xl p-3 text-left transition " + (on ? "bg-[hsl(var(--p-emerald))] text-[hsl(var(--p-paper))] shadow-md" : "hover:bg-[hsl(var(--p-paper-2))]")}
        data-testid={t.channel === "teacher" ? `tab-thread-teacher-${t.teacherId}` : `tab-thread-${t.channel}`}>
        {t.channel === "teacher"
          ? <Avatar name={t.title} photoId={teacher?.photoId} size={42} hue={hueOf(t.teacherId ?? 0)} />
          : <span className={"grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full " + (on ? "bg-[hsl(var(--p-paper)/0.18)]" : "bg-[hsl(var(--p-emerald-soft))] text-[hsl(var(--p-emerald))]")}>{t.channel === "office" ? <Building2 size={18} /> : <GraduationCap size={18} />}</span>}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5"><span className="truncate text-sm font-semibold">{t.title}</span>{t.channel === "teacher" && <Lock size={11} className="shrink-0 opacity-70" aria-label="Private" />}</span>
          <span className={"block truncate text-xs " + (on ? "text-[hsl(var(--p-paper)/0.8)]" : "text-[hsl(var(--p-ink)/0.6)]")}>{last || (t.channel === "teacher" ? (teacher?.subjects.join(" · ") || "Private conversation") : t.channel === "office" ? "Fees, forms and anything else" : "Everyday school matters")}</span>
        </span>
        {t.unread > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[hsl(var(--p-red))] px-1.5 text-[11px] font-bold text-white" data-testid={t.channel === "teacher" ? `badge-thread-teacher-${t.teacherId}` : `badge-thread-${t.channel}`}>{t.unread}</span>}
      </button>
    );
  };

  const who = thread.channel === "office" ? "the school office" : thread.channel === "class" ? "your class teachers" : thread.title;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <aside className={"space-y-3 " + (mobileChat || picking ? "hidden lg:block" : "")} aria-label="Conversations">
        <button type="button" className="portal-btn w-full justify-center" onClick={() => { setPicking(true); setMobileChat(true); }} data-testid="button-new-teacher-message"><PenSquare size={16} /> Message a teacher</button>
        <div className="portal-card p-2" role="tablist" aria-label="Conversations">
          <p className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[hsl(var(--p-ink)/0.5)]">School</p>
          {generalThreads.map((t) => <Row key={threadKey(t)} t={t} />)}
          {privateThreads.length > 0 && <p className="px-2 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[hsl(var(--p-ink)/0.5)]">Private with a teacher</p>}
          {privateThreads.map((t) => <Row key={threadKey(t)} t={t} />)}
        </div>
        <p className="flex items-start gap-1.5 px-1 text-[11px] leading-relaxed text-[hsl(var(--p-ink)/0.55)]"><ShieldCheck size={13} className="mt-0.5 shrink-0" aria-hidden /> Messages are kept by the school. The school office can read them to keep students safe. Be polite and never share your password.</p>
      </aside>

      <div className={mobileChat || picking ? "" : "hidden lg:block"}>
        <button type="button" className="portal-btn-ghost mb-3 lg:hidden" onClick={() => { setMobileChat(false); setPicking(false); }} data-testid="button-messages-back"><ArrowLeft size={15} /> Conversations</button>
        {picking ? <TeacherPicker teachers={teachers} onPick={(t) => open({ channel: "teacher", teacherId: t.id })} onClose={() => setPicking(false)} /> : (
          <section className="portal-card overflow-hidden" aria-label={thread.title}>
            <header className="flex items-center gap-3 border-b border-[hsl(var(--p-line))] p-4" data-testid="chat-header">
              {thread.channel === "teacher"
                ? <Avatar name={thread.title} photoId={pickedTeacher?.photoId} size={44} hue={hueOf(thread.teacherId ?? 0)} />
                : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[hsl(var(--p-emerald-soft))] text-[hsl(var(--p-emerald))]">{thread.channel === "office" ? <Building2 size={19} /> : <GraduationCap size={19} />}</span>}
              <div className="min-w-0 flex-1">
                <p className="truncate font-serif text-lg font-semibold">{thread.title}</p>
                <p className="flex items-center gap-1 text-xs text-[hsl(var(--p-ink)/0.6)]" data-testid="text-chat-privacy">
                  {thread.channel === "teacher" ? <><Lock size={11} aria-hidden /> Private: only {thread.title} can read and answer this</> : thread.channel === "office" ? <><Building2 size={11} aria-hidden /> The school office</> : <><Users size={11} aria-hidden /> Your class teachers can read this</>}
                </p>
              </div>
              {pickedTeacher && pickedTeacher.subjects.length > 0 && <div className="hidden flex-wrap justify-end gap-1 sm:flex">{pickedTeacher.subjects.slice(0, 3).map((s) => <span key={s} className="rounded-full bg-[hsl(var(--p-paper-2))] px-2 py-0.5 text-[10px] font-semibold">{s}</span>)}</div>}
            </header>
            <ChatMessages messages={thread.messages} mine="student"
              empty={thread.channel === "office" ? "Ask the school office about fees, forms, uniforms or anything else." : thread.channel === "teacher" ? `Start a private conversation with ${thread.title}. Other teachers will not see it.` : "Send your class teacher a message about school work or being away."} />
            {thread.closed
              ? <p className="border-t border-[hsl(var(--p-line))] p-4 text-sm text-[hsl(var(--p-ink)/0.65)]">This teacher no longer teaches your class, so new messages cannot be sent. Write to the school office instead.</p>
              : <ChatComposer onSend={onSend} pending={send.isPending} suggestions={SUGGEST[thread.channel] ?? []} placeholder={`Message ${who}`} />}
          </section>
        )}
      </div>
    </div>
  );
}
