import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetSchoolEmailMessageQueryKey, getGetSchoolEmailQueryKey, useGetSchoolEmail, useGetSchoolEmailMessage, useSendSchoolEmail,
  type SchoolEmailMessage, type SchoolEmailPerson, type SchoolEmailWorkspace,
} from "@workspace/api-client-react";
import { CheckCircle2, Clock, GraduationCap, Mail, Search, Send, Users, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorPanel, Skeleton, StatusPill } from "../ui";
import { errorMessage } from "../lib";

const MUTED = "text-[hsl(var(--p-ink)/0.62)]";
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const key = (p: Pick<SchoolEmailPerson, "kind" | "email">) => `${p.kind}:${p.email}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Write to teachers and parents. Choose people one by one, or everyone, or a class's parents; each person gets their
 * own private email addressed to them by name, and replies come back to the sender.
 */
export function SchoolEmail() {
  const q = useGetSchoolEmail({ query: { queryKey: getGetSchoolEmailQueryKey(), refetchInterval: (query) => (Array.isArray(query.state.data?.history) && query.state.data.history.some((h) => h.status === "sending") ? 4000 : false) } });
  const [open, setOpen] = useState<number | null>(null);
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.isError || !q.data || !Array.isArray(q.data.people)) return <ErrorPanel title="Email did not load" message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  return (
    <div className="space-y-6">
      <Composer data={q.data} />
      <History items={q.data.history} onOpen={setOpen} />
      {open !== null && <SentDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Composer({ data }: { data: SchoolEmailWorkspace }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const send = useSendSchoolEmail();
  const [tab, setTab] = useState<"teacher" | "parent">("teacher");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [classId, setClassId] = useState("");
  const teachers = data.people.filter((p) => p.kind === "teacher");
  const parents = data.people.filter((p) => p.kind === "parent");
  const list = (tab === "teacher" ? teachers : parents).filter((p) => !search.trim() || `${p.name} ${p.email} ${p.detail}`.toLowerCase().includes(search.trim().toLowerCase()));
  const chosen = data.people.filter((p) => picked.has(key(p)));
  const left = Math.max(0, data.dailyLimit - data.sentToday);
  const toggle = (p: SchoolEmailPerson) => setPicked((cur) => { const next = new Set(cur); if (next.has(key(p))) next.delete(key(p)); else next.add(key(p)); return next; });
  const add = (people: SchoolEmailPerson[]) => setPicked((cur) => new Set([...cur, ...people.map(key)]));
  const sample = chosen[0] ?? (tab === "teacher" ? teachers[0] : parents[0]);
  const greeting = sample ? (sample.kind === "teacher" ? `Dear ${sample.name}` : `Dear ${sample.name}`) : "Dear Mrs Eze";
  const title = data.sender.role === "director" ? "Director" : "Head of School";
  const problem = !data.emailReady ? "Email is not set up yet (RESEND_API_KEY and EMAIL_FROM)." : !chosen.length ? "Choose who to email." : chosen.length > left ? `Only ${left} more emails can go out today.` : !subject.trim() ? "Add a subject." : !message.trim() ? "Write a message." : "";

  const submit = async () => {
    if (problem) return;
    if (chosen.length > 20 && !window.confirm(`Send ${chosen.length} private emails? Each person gets their own copy.`)) return;
    try {
      const r = await send.mutateAsync({ data: { subject: subject.trim(), message: message.trim(), recipients: chosen.map(({ kind, email }) => ({ kind, email })) } });
      toast({ title: `Sending to ${r.recipients} ${r.recipients === 1 ? "person" : "people"}`, description: "Each gets their own private email. Follow delivery under Sent emails." });
      setPicked(new Set()); setSubject(""); setMessage("");
      await qc.invalidateQueries({ queryKey: getGetSchoolEmailQueryKey() });
    } catch (e) { toast({ variant: "destructive", title: "Not sent", description: errorMessage(e) }); }
  };

  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]" aria-label="Write an email">
      <div className="portal-card flex min-h-[32rem] min-w-0 flex-col !p-0">
        <div className="flex border-b border-[hsl(var(--p-line))]" role="tablist" aria-label="Who to email">
          {([["teacher", "Teachers", teachers.length, GraduationCap], ["parent", "Parents", parents.length, Users]] as const).map(([k, label, n, Icon]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`tab-email-${k}`}
              className={"flex flex-1 items-center justify-center gap-2 px-4 py-3 text-sm font-semibold " + (tab === k ? "border-b-2 border-[hsl(var(--p-emerald))] text-[hsl(var(--p-emerald))]" : MUTED)}><Icon size={15} aria-hidden="true" /> {label} <span className="opacity-70">{n}</span></button>
          ))}
        </div>
        <div className="space-y-2 border-b border-[hsl(var(--p-line))] p-3">
          <label className="relative block"><span className="sr-only">Search</span><Search size={15} className={"absolute left-3 top-1/2 -translate-y-1/2 " + MUTED} aria-hidden="true" />
            <input className="portal-input !pl-9" placeholder={tab === "teacher" ? "Search a teacher or class" : "Search a parent, child or class"} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-email-search" /></label>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button type="button" className="portal-btn-ghost !min-h-[30px] !px-2.5 text-xs" onClick={() => add(tab === "teacher" ? teachers : parents)} data-testid={`button-select-all-${tab}`}>Select all {tab === "teacher" ? "teachers" : "parents"}</button>
            {tab === "parent" && (
              <label className="flex items-center gap-1"><span className="sr-only">Parents of a class</span>
                <select className="portal-input !min-h-[30px] !w-auto !py-1 text-xs" value={classId} onChange={(e) => { setClassId(e.target.value); if (e.target.value) add(parents.filter((p) => p.classIds.includes(Number(e.target.value)))); }} data-testid="select-email-class">
                  <option value="">Add a class's parents</option>{data.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></label>
            )}
            {picked.size > 0 && <button type="button" className={"ml-auto underline underline-offset-2 " + MUTED} onClick={() => { setPicked(new Set()); setClassId(""); }} data-testid="button-clear-recipients">Clear ({picked.size})</button>}
          </div>
        </div>
        <ul className="max-h-[26rem] flex-1 divide-y divide-[hsl(var(--p-line))] overflow-y-auto" data-testid="list-email-people">
          {list.map((p) => (
            <li key={key(p)}>
              <label className="flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-[hsl(var(--p-paper-2)/0.6)]">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-[hsl(var(--p-emerald))]" checked={picked.has(key(p))} onChange={() => toggle(p)} data-testid={`check-${p.kind}-${p.email}`} />
                <span className="min-w-0"><span className="block text-sm font-semibold">{p.name}</span><span className={"block truncate text-xs " + MUTED}>{p.email}{p.detail ? ` · ${p.detail}` : ""}</span></span>
              </label>
            </li>
          ))}
          {!list.length && <li className={"p-4 text-sm " + MUTED}>{(tab === "teacher" ? teachers : parents).length ? "Nobody matches." : tab === "teacher" ? "No active teachers yet." : "No parent emails on students yet. Add them on the Parents page."}</li>}
        </ul>
      </div>

      <div className="portal-card min-w-0 space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><h2 className="flex items-center gap-2 font-serif text-xl font-semibold"><Mail size={18} aria-hidden="true" /> New email</h2>
            <p className={"text-sm " + MUTED}>Each person gets their own private email, addressed to them. Replies come to you at {data.sender.email}.</p></div>
          <StatusPill tone={left ? "green" : "red"}>{left} of {data.dailyLimit} left today</StatusPill>
        </div>
        <p className="text-sm" data-testid="text-email-recipient-count"><b>{chosen.length}</b> {chosen.length === 1 ? "person" : "people"} chosen{chosen.length ? `: ${plural(chosen.filter((c) => c.kind === "teacher").length, "teacher")}, ${plural(chosen.filter((c) => c.kind === "parent").length, "parent")}` : ""}</p>
        <label className="block text-sm font-semibold">Subject<input className="portal-input mt-1" maxLength={150} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. PTA meeting on Friday" data-testid="input-email-subject" /></label>
        <label className="block text-sm font-semibold">Message<textarea className="portal-input mt-1 min-h-[180px]" maxLength={10000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Write your message. Leave a blank line between paragraphs." data-testid="input-email-message" /></label>
        <div className="rounded-2xl border border-[hsl(var(--p-line))] bg-white p-4 text-sm text-[#10232c]" aria-label="Preview" data-testid="email-preview">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b07d12]">Preview</p>
          <p className="mt-2 font-serif text-lg font-semibold">{subject || "Subject"}</p>
          <p className="mt-2">{greeting},</p>
          {(message.trim() || "Your message").split(/\n\s*\n/).map((para, i) => <p key={i} className="mt-2 whitespace-pre-line">{para}</p>)}
          <p className="mt-3">Yours sincerely,<br /><b>{data.sender.name}</b><br /><span className="text-[#5c6b70]">{title}, New World Emerald Private School</span></p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={"text-xs " + (problem ? "text-[hsl(var(--p-red))]" : MUTED)}>{problem || "Ready to send."}</p>
          <button type="button" className="portal-btn" disabled={!!problem || send.isPending} onClick={() => void submit()} data-testid="button-send-email"><Send size={15} aria-hidden="true" /> {send.isPending ? "Sending..." : `Send to ${chosen.length || ""} ${chosen.length === 1 ? "person" : "people"}`}</button>
        </div>
      </div>
    </section>
  );
}

function History({ items, onOpen }: { items: SchoolEmailMessage[]; onOpen: (id: number) => void }) {
  return (
    <section className="portal-card min-w-0 max-w-full overflow-hidden !p-0" aria-labelledby="sent-title">
      <h2 id="sent-title" className="px-5 pt-4 font-serif text-xl font-semibold">Sent emails</h2>
      {!items.length ? <div className="p-5"><EmptyState icon={<Mail size={22} />} title="Nothing sent yet" body="Emails you and the school leadership send appear here, with who each one reached." /></div> : (
        <div className="max-w-full overflow-x-auto"><table className="mt-2 w-full min-w-[640px] text-sm" data-testid="table-sent-emails">
          <thead className={"text-left text-xs uppercase tracking-wider " + MUTED}><tr><th className="px-5 py-2">Subject</th><th className="px-3 py-2">From</th><th className="px-3 py-2">Sent</th><th className="px-3 py-2 text-right">Delivered</th><th className="px-5 py-2"><span className="sr-only">Open</span></th></tr></thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id} className="border-t border-[hsl(var(--p-line))]">
                <td className="px-5 py-3 font-semibold">{m.subject}</td>
                <td className="px-3 py-3">{m.senderName}<span className={"block text-xs " + MUTED}>{m.senderRole === "director" ? "Director" : "Head of School"}</span></td>
                <td className="whitespace-nowrap px-3 py-3">{when(m.createdAt)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{m.status === "sending" ? <StatusPill tone="gold"><Clock size={11} aria-hidden="true" /> {m.sent + m.failed} of {m.recipients}</StatusPill> : <>{m.sent} of {m.recipients}{m.failed ? <span className="ml-1 text-[hsl(var(--p-red))]">({m.failed} failed)</span> : null}</>}</td>
                <td className="px-5 py-3 text-right"><button type="button" className="portal-btn-ghost !min-h-[32px] !px-3 text-xs" onClick={() => onOpen(m.id)} data-testid={`button-open-sent-${m.id}`}>Details</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </section>
  );
}

function SentDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const q = useGetSchoolEmailMessage(id, { query: { queryKey: getGetSchoolEmailMessageQueryKey(id), refetchInterval: (query) => (query.state.data?.message?.status === "sending" ? 3000 : false) } });
  const [filter, setFilter] = useState<"" | "sent" | "failed" | "pending">("");
  const rows = useMemo(() => (q.data?.recipients ?? []).filter((r) => !filter || r.status === filter), [q.data, filter]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-h-[88vh] max-w-2xl overflow-y-auto rounded-2xl">
        <DialogHeader><DialogTitle className="font-serif text-2xl">{q.data?.message.subject ?? "Email"}</DialogTitle>
          <DialogDescription>{q.data ? `From ${q.data.message.senderName} · ${when(q.data.message.createdAt)} · ${q.data.message.sent} delivered, ${q.data.message.failed} failed, of ${q.data.message.recipients}` : "Loading"}</DialogDescription></DialogHeader>
        {q.isLoading ? <Skeleton className="h-40" /> : q.isError || !q.data ? <ErrorPanel title="Not loaded" message={errorMessage(q.error)} onRetry={() => void q.refetch()} /> : (<>
          <p className="whitespace-pre-line rounded-xl bg-[hsl(var(--p-paper-2)/0.7)] p-3 text-sm">{q.data.message.body}</p>
          <div className="flex gap-1 text-xs" role="group" aria-label="Show">
            {([["", "Everyone"], ["sent", "Delivered"], ["failed", "Failed"], ["pending", "Waiting"]] as const).map(([k, label]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={"rounded-full px-3 py-1 font-semibold " + (filter === k ? "bg-[hsl(var(--p-ink))] text-white" : "border border-[hsl(var(--p-line))]")}>{label}</button>)}
          </div>
          <ul className="divide-y divide-[hsl(var(--p-line))] text-sm" data-testid="list-sent-recipients">
            {rows.map((r) => (
              <li key={`${r.kind}:${r.email}`} className="flex items-start gap-3 py-2">
                {r.status === "sent" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[hsl(var(--p-emerald))]" aria-label="Delivered" /> : r.status === "failed" ? <XCircle size={16} className="mt-0.5 shrink-0 text-[hsl(var(--p-red))]" aria-label="Failed" /> : <Clock size={16} className={"mt-0.5 shrink-0 " + MUTED} aria-label="Waiting" />}
                <span className="min-w-0 flex-1"><b>{r.name}</b> <span className={MUTED}>· {r.kind === "teacher" ? "Teacher" : "Parent"}</span><span className={"block truncate text-xs " + MUTED}>{r.email}{r.detail ? ` · ${r.detail}` : ""}</span></span>
                {r.sentAt && <span className={"shrink-0 text-xs " + MUTED}>{when(r.sentAt)}</span>}
              </li>
            ))}
          </ul>
        </>)}
      </DialogContent>
    </Dialog>
  );
}
