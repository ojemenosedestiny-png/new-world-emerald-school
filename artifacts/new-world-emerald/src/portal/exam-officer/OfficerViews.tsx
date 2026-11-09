import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetExamOfficerActivityQueryKey, getGetExamOfficerExamQueryKey, getGetExamOfficerOverviewQueryKey,
  useGetExamOfficerActivity, useGetExamOfficerExam, useManageExamOfficer,
  type ExamOfficerExam, type ExamOfficerOverview, type ExamOfficerStaff,
} from "@workspace/api-client-react";
import { CheckCircle2, Clock, Eye, FileCheck2, Inbox, Search, Send, ShieldCheck, Undo2, Users } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorPanel, Skeleton, StatusPill } from "../ui";
import { errorMessage } from "../lib";

export type OfficerTab = "overview" | "queue" | "exams" | "timetables" | "activity";
type Status = ExamOfficerExam["status"];

const MUTED = "text-[hsl(var(--p-ink)/0.62)]";
const lagos = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", ...opts }).format(new Date(iso));
const when = (iso: string) => lagos(iso, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const STATUS: Record<Status, { tone: "muted" | "gold" | "green" | "ink" | "red"; label: string }> = {
  draft: { tone: "muted", label: "Draft (not sent)" },
  awaiting: { tone: "gold", label: "Waiting for you" },
  returned: { tone: "red", label: "Returned to teacher" },
  scheduled: { tone: "green", label: "Published, not open yet" },
  open: { tone: "green", label: "Open now" },
  closed: { tone: "ink", label: "Closed, marking" },
  released: { tone: "ink", label: "Results released" },
};
const SECTION: Record<ExamOfficerExam["section"], string> = { primary: "Primary", secondary: "Secondary", other: "Other" };
const PUBLISHED: Status[] = ["scheduled", "open", "closed", "released"];

function useOfficerCommand() {
  const m = useManageExamOfficer();
  const qc = useQueryClient();
  const { toast } = useToast();
  const run = async (data: Parameters<typeof m.mutateAsync>[0]["data"]) => {
    try {
      const r = await m.mutateAsync({ data });
      toast({ title: r.message });
      await Promise.all([qc.invalidateQueries({ queryKey: getGetExamOfficerOverviewQueryKey() }), qc.invalidateQueries({ queryKey: getGetExamOfficerExamQueryKey(data.examId) }), qc.invalidateQueries({ queryKey: getGetExamOfficerActivityQueryKey() })]);
      return true;
    } catch (e) { toast({ variant: "destructive", title: "Not saved", description: errorMessage(e) }); return false; }
  };
  return { run, pending: m.isPending };
}

/* ---------------------------------------------------------------- Overview */

export function OverviewView({ data, name, onOpen, onView }: { data: ExamOfficerOverview; name: string; onOpen: (tab: OfficerTab) => void; onView: (id: number) => void }) {
  const n = (s: Status[]) => data.exams.filter((e) => s.includes(e.status)).length;
  const waiting = data.exams.filter((e) => e.status === "awaiting").sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const first = name.split(/\s+/).find((p) => !/^(mr|mrs|miss|ms|dr)\.?$/i.test(p)) ?? "";
  const term = data.terms.find((t) => t.key === data.term)?.label ?? "this term";
  return (
    <div className="space-y-6">
      {!data.configured && (
        <p className="rounded-2xl border border-[hsl(var(--p-gold)/0.5)] bg-[hsl(var(--p-gold-soft))] p-4 text-sm" data-testid="text-officer-not-configured">
          <b>Exams are not waiting for you yet.</b> Until the exam officer's email is saved in the school's settings (SCHOOL_EXAM_OFFICER_EMAILS), teachers still publish their own exams. You can watch everything here.
        </p>
      )}
      <section className="portal-hero rounded-3xl p-6 sm:p-8" aria-labelledby="officer-title">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--p-gold))]">Exam officer · {term}</p>
        <h2 id="officer-title" className="mt-2 font-serif text-3xl font-semibold sm:text-4xl">{waiting.length ? `${waiting.length} ${waiting.length === 1 ? "exam is" : "exams are"} waiting for you${first ? `, ${first}` : ""}` : `All caught up${first ? `, ${first}` : ""}`}</h2>
        <p className="mt-1 text-sm text-white/75">No exam reaches students until you publish it.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {([["Waiting to publish", n(["awaiting"]), "hero-waiting"], ["Published this term", n(PUBLISHED), "hero-published"], ["Open now", n(["open"]), "hero-open"], ["Returned to teachers", n(["returned"]), "hero-returned"]] as const).map(([label, value, id]) => (
            <div key={id} className="rounded-2xl border border-white/15 bg-white/[0.07] p-4" data-testid={id}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">{label}</p>
              <p className="mt-1.5 font-serif text-3xl font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
        {waiting.length > 0 && <button type="button" className="portal-btn portal-btn-gold mt-5" onClick={() => onOpen("queue")} data-testid="button-open-queue"><Inbox size={15} aria-hidden="true" /> Review the queue</button>}
      </section>

      <section className="portal-card overflow-x-auto !p-0" aria-labelledby="sections-title">
        <h2 id="sections-title" className="px-5 pt-4 font-serif text-xl font-semibold">Publishing by section</h2>
        <table className="mt-2 w-full min-w-[720px] text-sm" data-testid="table-sections">
          <thead className={"text-left text-xs uppercase tracking-wider " + MUTED}>
            <tr><th className="px-5 py-2">Section</th>{(["draft", "awaiting", "returned", "scheduled", "open", "closed", "released"] as Status[]).map((s) => <th key={s} className="px-3 py-2 text-right">{STATUS[s].label}</th>)}</tr>
          </thead>
          <tbody>
            {data.sections.map((s) => (
              <tr key={s.section} className="border-t border-[hsl(var(--p-line))]" data-testid={`section-${s.section}`}>
                <td className="px-5 py-3 font-semibold">{s.label}</td>
                {(["draft", "awaiting", "returned", "scheduled", "open", "closed", "released"] as Status[]).map((k) => <td key={k} className={"px-3 py-3 text-right tabular-nums " + (k === "awaiting" && s[k] ? "font-bold text-[hsl(var(--p-gold-ink))]" : "")}>{s[k]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {waiting.length > 0 && (
        <section aria-labelledby="next-title">
          <h2 id="next-title" className="mb-3 font-serif text-xl font-semibold">Next to review</h2>
          <ExamList exams={waiting.slice(0, 4)} onView={onView} />
        </section>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Lists */

export function ExamList({ exams, onView }: { exams: ExamOfficerExam[]; onView: (id: number) => void }) {
  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {exams.map((e) => {
        const st = STATUS[e.status];
        return (
          <li key={e.id} className={"portal-card flex flex-col gap-3 p-5 " + (e.status === "awaiting" ? "ring-2 ring-[hsl(var(--p-gold)/0.55)]" : "")} data-testid={`officer-exam-${e.id}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--p-emerald))]">{e.subject} · {e.className} · {SECTION[e.section]}</p>
                <h3 className="mt-0.5 font-serif text-xl font-semibold">{e.title}</h3>
              </div>
              <StatusPill tone={st.tone}>{st.label}</StatusPill>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
              <div><dt className={"text-xs " + MUTED}>Set by</dt><dd className="font-medium">{e.setBy || "Not recorded"}</dd></div>
              <div><dt className={"text-xs " + MUTED}>Opens</dt><dd className="font-medium">{when(e.startsAt)}</dd></div>
              <div><dt className={"text-xs " + MUTED}>Paper</dt><dd className="font-medium">{e.questionCount} questions · {e.totalMarks} marks</dd></div>
              <div><dt className={"text-xs " + MUTED}>Questions opened</dt><dd className="font-medium tabular-nums">{e.opened} {e.opened === 1 ? "time" : "times"}</dd></div>
            </dl>
            {e.status === "awaiting" && e.submittedAt && <p className={"text-xs " + MUTED}>Sent by {e.submittedBy || "a teacher"}, {when(e.submittedAt)}</p>}
            {e.status === "returned" && e.reviewNote && <p className="rounded-lg bg-[hsl(var(--p-red)/0.07)] px-3 py-2 text-xs">Your note: {e.reviewNote}</p>}
            {PUBLISHED.includes(e.status) && <p className={"text-xs " + MUTED}>{e.sat} of {e.students} sat · {e.marked} marked{e.reviewedBy ? ` · published by ${e.reviewedBy}` : ""}</p>}
            <div><button type="button" className={e.status === "awaiting" ? "portal-btn !min-h-[36px] text-sm" : "portal-btn-ghost !min-h-[36px] text-sm"} onClick={() => onView(e.id)} data-testid={`button-view-officer-exam-${e.id}`}><Eye size={14} aria-hidden="true" /> {e.status === "awaiting" ? "Review and publish" : "Open"}</button></div>
          </li>
        );
      })}
    </ul>
  );
}

export function QueueView({ data, onView }: { data: ExamOfficerOverview; onView: (id: number) => void }) {
  const waiting = data.exams.filter((e) => e.status === "awaiting").sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const returned = data.exams.filter((e) => e.status === "returned");
  return (
    <div className="space-y-6">
      {waiting.length ? <ExamList exams={waiting} onView={onView} /> : <EmptyState icon={<CheckCircle2 size={22} />} title="Nothing waiting" body="Exams teachers send to publish appear here, soonest first." />}
      {returned.length > 0 && (
        <section aria-labelledby="returned-title">
          <h2 id="returned-title" className="mb-3 font-serif text-xl font-semibold">Returned to teachers</h2>
          <ExamList exams={returned} onView={onView} />
        </section>
      )}
    </div>
  );
}

export function AllExamsView({ data, onTerm, onView }: { data: ExamOfficerOverview; onTerm: (key: string) => void; onView: (id: number) => void }) {
  const [section, setSection] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const s = search.trim().toLowerCase();
  const shown = data.exams.filter((e) => (!section || e.section === section) && (!status || e.status === status) && (!s || [e.title, e.subject, e.className, e.setBy].some((v) => v.toLowerCase().includes(s))))
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  if (!data.terms.length) return <EmptyState icon={<FileCheck2 size={22} />} title="No exams yet" body="Every exam teachers set appears here, term by term." />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Term">
        {data.terms.map((t) => (
          <button key={t.key} type="button" aria-pressed={data.term === t.key} onClick={() => onTerm(t.key)} data-testid={`officer-term-${t.key}`}
            className={"rounded-full border px-4 py-2 text-sm font-semibold " + (data.term === t.key ? "border-[hsl(var(--p-emerald))] bg-[hsl(var(--p-emerald))] text-white" : "border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface))]")}>{t.label} <span className="opacity-70">{t.count}</span></button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="relative min-w-[12rem] flex-1"><span className="sr-only">Search exams</span><Search size={15} className={"absolute left-3 top-1/2 -translate-y-1/2 " + MUTED} aria-hidden="true" />
          <input className="portal-input !pl-9" placeholder="Search a subject, title, class or teacher" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-officer-search" /></label>
        <label><span className="sr-only">Section</span><select className="portal-input !w-auto" value={section} onChange={(e) => setSection(e.target.value)} data-testid="select-officer-section"><option value="">All sections</option><option value="secondary">Secondary</option><option value="primary">Primary</option><option value="other">Other</option></select></label>
        <label><span className="sr-only">Status</span><select className="portal-input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="select-officer-status"><option value="">Any status</option>{(Object.keys(STATUS) as Status[]).map((k) => <option key={k} value={k}>{STATUS[k].label}</option>)}</select></label>
      </div>
      {shown.length ? <ExamList exams={shown} onView={onView} /> : <p className={"portal-card p-6 text-sm " + MUTED}>No exams match.</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- Paper */

export function PaperDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const q = useGetExamOfficerExam(id, { query: { queryKey: getGetExamOfficerExamQueryKey(id) } });
  const cmd = useOfficerCommand();
  const [mode, setMode] = useState<"" | "return" | "withdraw">("");
  const [note, setNote] = useState("");
  const p = q.data;
  const act = async (action: "publish" | "return" | "withdraw") => { if (await cmd.run({ action, examId: id, ...(note.trim() ? { note: note.trim() } : {}) })) onClose(); };
  const closed = p ? new Date(p.exam.endsAt) <= new Date() : false;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-h-[90vh] max-w-3xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">{p ? p.exam.title : "Exam paper"}</DialogTitle>
          <DialogDescription>{p ? `${p.exam.subject} · ${p.exam.className} · ${p.exam.durationMinutes} minutes · ${p.exam.totalMarks} marks · opens ${when(p.exam.startsAt)}${p.exam.setBy ? ` · set by ${p.exam.setBy}` : ""}` : "Loading"}</DialogDescription>
        </DialogHeader>
        {q.isLoading ? <Skeleton className="h-60" /> : q.isError || !p ? <ErrorPanel title="The paper did not load" message={errorMessage(q.error)} onRetry={() => void q.refetch()} /> : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="space-y-3" data-testid="officer-paper">
              <div className="flex flex-wrap items-center gap-2"><StatusPill tone={STATUS[p.exam.status].tone}>{STATUS[p.exam.status].label}</StatusPill>{p.exam.mode === "pdf" && <span className={"text-xs " + MUTED}>PDF paper: students see the uploaded file.</span>}</div>
              {p.instructions && <p className="whitespace-pre-line rounded-xl bg-[hsl(var(--p-paper-2)/0.7)] p-3 text-sm">{p.instructions}</p>}
              <ol className="space-y-2.5">
                {p.questions.map((qu, i) => (
                  <li key={qu.id} className="rounded-xl border border-[hsl(var(--p-line))] p-3">
                    {qu.passage && qu.passage !== p.questions[i - 1]?.passage && <p className={"mb-2 whitespace-pre-line border-l-2 border-[hsl(var(--p-gold))] pl-3 text-sm italic " + MUTED}>{qu.passage}</p>}
                    <div className="flex gap-3"><span className="font-serif font-semibold text-[hsl(var(--p-emerald))]">{i + 1}.</span><p className="min-w-0 flex-1 whitespace-pre-line text-sm">{qu.text}</p><span className={"shrink-0 text-xs " + MUTED}>{qu.marks} {qu.marks === 1 ? "mark" : "marks"}</span></div>
                    {qu.type === "mcq" ? (
                      <ul className="mt-2 grid gap-1 pl-6 sm:grid-cols-2">
                        {qu.options.map((o, k) => <li key={k} className={"rounded-lg px-2 py-1 text-sm " + (qu.correctAnswer === k ? "bg-[hsl(var(--p-emerald-soft))] font-semibold text-[hsl(var(--p-emerald))]" : "bg-[hsl(var(--p-paper-2)/0.6)]")}>{String.fromCharCode(65 + k)}. {o}{qu.correctAnswer === k ? " ✓" : ""}</li>)}
                      </ul>
                    ) : <p className={"mt-1 pl-6 text-xs " + MUTED}>Written answer, marked by the teacher.</p>}
                  </li>
                ))}
                {!p.questions.length && <li className={"text-sm " + MUTED}>No questions yet.</li>}
              </ol>
            </div>
            <aside className="space-y-3">
              <h3 className="font-semibold">History and access</h3>
              <ol className="max-h-[50vh] space-y-2 overflow-y-auto border-l-2 border-[hsl(var(--p-line))] pl-3 text-sm" data-testid="officer-history">
                {p.history.map((h, i) => <li key={i}><p className="font-medium">{h.label}</p><p className={"text-xs " + MUTED}><Clock size={10} className="mr-1 inline" aria-hidden="true" />{when(h.at)} · {h.who}</p></li>)}
              </ol>
            </aside>
          </div>
        )}
        {p && mode && (
          <label className="block text-sm font-semibold">{mode === "return" ? "What should the teacher change?" : "Reason (optional; the teacher sees it)"}
            <textarea className="portal-input mt-1 min-h-[80px]" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-officer-note" />
          </label>
        )}
        {p && (
          <DialogFooter className="flex-wrap gap-2">
            {!PUBLISHED.includes(p.exam.status) ? (mode === "return" ? (<>
              <button type="button" className="portal-btn-ghost" onClick={() => setMode("")}>Back</button>
              <button type="button" className="portal-btn" disabled={!note.trim() || cmd.pending} onClick={() => void act("return")} data-testid="button-confirm-return-exam"><Undo2 size={14} aria-hidden="true" /> Send back</button>
            </>) : (<>
              <button type="button" className="portal-btn-ghost" disabled={cmd.pending || p.exam.sat > 0} onClick={() => setMode("return")} data-testid="button-return-exam"><Undo2 size={14} aria-hidden="true" /> Return to teacher</button>
              <button type="button" className="portal-btn" disabled={cmd.pending || closed || (p.exam.mode !== "pdf" && !p.questions.length)} title={closed ? "The exam window has closed" : undefined} onClick={() => void act("publish")} data-testid="button-publish-exam"><Send size={14} aria-hidden="true" /> Publish to students</button>
            </>)) : mode === "withdraw" ? (<>
              <button type="button" className="portal-btn-ghost" onClick={() => setMode("")}>Back</button>
              <button type="button" className="portal-btn" disabled={cmd.pending} onClick={() => void act("withdraw")} data-testid="button-confirm-withdraw-exam">Withdraw from students</button>
            </>) : <button type="button" className="portal-btn-ghost" disabled={cmd.pending} onClick={() => setMode("withdraw")} data-testid="button-withdraw-exam">Withdraw from students</button>}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- Activity */

const COUNTS: [keyof ExamOfficerStaff["counts"], string][] = [
  ["saved", "Questions uploaded or edited"], ["pdf", "PDF papers uploaded"], ["diagram", "Diagrams added"], ["submitted", "Sent to publish"], ["opened", "Questions opened"],
  ["published", "Published"], ["returned", "Returned"], ["withdrawn", "Withdrawn"], ["hidden", "Hidden"], ["marked", "Scripts marked"], ["released", "Results released"], ["deleted", "Deleted"], ["attempt", "Attempts changed"],
];

export function ActivityView() {
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const params = { ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) };
  const q = useGetExamOfficerActivity(params, { query: { queryKey: getGetExamOfficerActivityQueryKey(params) } });
  const [who, setWho] = useState("");
  const staff = useMemo(() => (q.data?.staff ?? []).filter((s) => !who || s.email === who), [q.data, who]);
  return (
    <div className="space-y-5">
      <div className="portal-card flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm font-semibold">From<input type="date" className="portal-input mt-1 !w-auto" value={q.data?.from ?? range.from ?? ""} max={q.data?.today} onChange={(e) => setRange({ ...range, from: e.target.value || undefined })} data-testid="input-activity-from" /></label>
        <label className="text-sm font-semibold">To<input type="date" className="portal-input mt-1 !w-auto" value={q.data?.to ?? range.to ?? ""} max={q.data?.today} onChange={(e) => setRange({ ...range, to: e.target.value || undefined })} data-testid="input-activity-to" /></label>
        <label className="text-sm font-semibold">Staff<select className="portal-input mt-1 !w-auto" value={who} onChange={(e) => setWho(e.target.value)} data-testid="select-activity-staff"><option value="">Everyone</option>{(q.data?.staff ?? []).map((s) => <option key={s.email} value={s.email}>{s.name}</option>)}</select></label>
        <p className={"ml-auto text-xs " + MUTED}>Times are Nigerian time. Opening, copying and downloading questions in the staff portal is recorded.</p>
      </div>
      {q.isLoading ? <Skeleton className="h-60" /> : q.isError || !q.data ? <ErrorPanel title="Activity did not load" message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        : !staff.length ? <EmptyState icon={<Users size={22} />} title="No exam activity" body="Nothing was done with exams in these days." /> : (
          <div className="grid gap-3 lg:grid-cols-2">
            {staff.map((s) => (
              <article key={s.email} className="portal-card p-5" data-testid={`officer-staff-${s.email}`}>
                <header className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0"><h3 className="font-semibold">{s.name}</h3><p className={"break-all text-xs " + MUTED}>{s.email}</p></div>
                  <StatusPill tone={s.role === "exam officer" ? "gold" : s.role === "teacher" ? "green" : "ink"}>{s.role === "exam officer" ? <><ShieldCheck size={11} aria-hidden="true" /> Exam officer</> : s.role === "teacher" ? "Teacher" : "Office"}</StatusPill>
                </header>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {COUNTS.filter(([k]) => s.counts[k] > 0).map(([k, label]) => <span key={k} className={"rounded-full px-2.5 py-0.5 text-xs font-semibold " + (k === "opened" ? "bg-[hsl(var(--p-gold-soft))] text-[hsl(var(--p-gold-ink))]" : "bg-[hsl(var(--p-emerald-soft))] text-[hsl(var(--p-emerald))]")}>{label} · {s.counts[k]}</span>)}
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-semibold">Timeline ({s.events.length})</summary>
                  <ol className="mt-2 max-h-72 space-y-1.5 overflow-y-auto border-l-2 border-[hsl(var(--p-line))] pl-3">
                    {s.events.map((e, i) => <li key={i} className="text-sm"><span className={"mr-2 text-xs tabular-nums " + MUTED}>{when(e.at)}</span>{e.label}{e.examTitle ? <b className="font-semibold">: {e.examTitle}</b> : null}</li>)}
                  </ol>
                </details>
              </article>
            ))}
          </div>
        )}
    </div>
  );
}
