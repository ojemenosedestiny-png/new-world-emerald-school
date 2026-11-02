import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetPrincipalDashboardQueryKey, getGetPrincipalExamQueryKey, getGetPrincipalExamsQueryKey, getGetPrincipalResultsQueryKey, getReportWorkspace,
  useGetPrincipalDashboard, useGetPrincipalExam, useGetPrincipalExams, useGetPrincipalResults, useManagePrincipalResults,
  type GetPrincipalDashboardSection, type PrincipalDashboard, type PrincipalExamSummary, type PrincipalResultClass, type PrincipalResultsCommand,
  type PrincipalTeacherWeek,
} from "@workspace/api-client-react";
import {
  AlertTriangle, BookOpenCheck, CalendarCheck2, CheckCircle2, ClipboardList, Eye, FileSignature, PenLine, Printer, Search, Send, Undo2, Users,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorPanel, Skeleton, StatusPill } from "../ui";
import { errorMessage } from "../lib";
import { SignatureField } from "../reports/ResultSettings";
import { printableFor } from "../reports/RemarksBroadsheet";
import { printReportCards } from "../reports/reportCard";

type SchoolSection = GetPrincipalDashboardSection;
export type PrincipalTab = "overview" | "classes" | "exams" | "results" | "teachers" | "activity";

const MUTED = "text-[hsl(var(--p-ink)/0.62)]";
const lagos = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", ...opts }).format(new Date(iso));
const clock = (iso: string) => lagos(iso, { hour: "2-digit", minute: "2-digit" });
const dayName = (d: string, style: "short" | "narrow" | "long" = "short") => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: style }).format(new Date(d + "T12:00:00Z"));
const longDate = (d: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(d + "T12:00:00Z"));
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const initials = (name: string) => name.split(/\s+/).filter((p) => !/^(mr|mrs|miss|ms|dr)\.?$/i.test(p)).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";

/** "Today 14:10", "Yesterday 09:02", "Tuesday", or "Not this week". */
export function lastSeenLabel(iso: string | null, days: string[]) {
  if (!iso) return "Not this week";
  const d = lagos(iso, { year: "numeric", month: "2-digit", day: "2-digit" }).split("/").reverse().join("-");
  const at = days.indexOf(d);
  if (at === days.length - 1) return `Today ${clock(iso)}`;
  if (at === days.length - 2) return `Yesterday ${clock(iso)}`;
  return at >= 0 ? dayName(d, "long") : "Not this week";
}

function greeting(now = new Date()) {
  const h = Number(lagos(now.toISOString(), { hour: "2-digit", hour12: false }));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function Meter({ value, max, tone = "emerald", label }: { value: number; max: number; tone?: "emerald" | "gold" | "light"; label: string }) {
  const fill = tone === "light" ? "bg-[hsl(var(--p-gold))]" : tone === "gold" ? "bg-[hsl(var(--p-gold))]" : "bg-[hsl(var(--p-emerald))]";
  const track = tone === "light" ? "bg-white/15" : "bg-[hsl(var(--p-line)/0.7)]";
  return (
    <div className={"h-1.5 w-full overflow-hidden rounded-full " + track} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div className={"h-full rounded-full transition-[width] duration-500 " + fill} style={{ width: `${Math.min(100, pct(value, max))}%` }} />
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[hsl(var(--p-emerald-soft))] text-xs font-bold text-[hsl(var(--p-emerald))]">{initials(name)}</span>;
}

const RESULT_STATUS: Record<PrincipalResultClass["status"], { tone: "muted" | "gold" | "green" | "ink"; label: string }> = {
  draft: { tone: "muted", label: "With the class teacher" },
  review: { tone: "gold", label: "Waiting for your signature" },
  approved: { tone: "green", label: "Signed, not yet published" },
  published: { tone: "ink", label: "Published" },
};

const EXAM_STATUS: Record<PrincipalExamSummary["status"], { tone: "muted" | "gold" | "green" | "ink" | "red"; label: string }> = {
  draft: { tone: "muted", label: "Draft" },
  scheduled: { tone: "ink", label: "Scheduled" },
  open: { tone: "green", label: "Open now" },
  closed: { tone: "gold", label: "Closed, marking" },
  released: { tone: "ink", label: "Results released" },
};

/* ---------------------------------------------------------------- Overview */

/** The principal's home: today in figures, what needs attention, each teacher's week and each class's state. */
export function OverviewView({ section, schoolLabel, classesLabel, name, onOpen }: { section: SchoolSection; schoolLabel: string; classesLabel: string; name: string; onOpen: (tab: PrincipalTab) => void }) {
  const q = useGetPrincipalDashboard({ section }, { query: { queryKey: getGetPrincipalDashboardQueryKey({ section }), refetchInterval: 60_000 } });
  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-56 rounded-3xl" /><Skeleton className="h-72" /></div>;
  if (q.isError || !q.data) return <ErrorPanel title="The overview did not load" message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const d = q.data;
  return (
    <div className="space-y-6">
      <Hero d={d} schoolLabel={schoolLabel} classesLabel={classesLabel} name={name} onOpen={onOpen} />
      <Attention d={d} onOpen={onOpen} />
      <TeachersWeek d={d} />
      <ClassBoard d={d} />
    </div>
  );
}

function Hero({ d, schoolLabel, classesLabel, name, onOpen }: { d: PrincipalDashboard; schoolLabel: string; classesLabel: string; name: string; onOpen: (tab: PrincipalTab) => void }) {
  const f = d.figures;
  const first = name.split(/\s+/).find((p) => !/^(mr|mrs|miss|ms|dr)\.?$/i.test(p)) ?? "";
  const tiles: { label: string; value: string; sub: string; meter?: [number, number]; action?: ReactNode; testId: string }[] = [
    { label: "Teachers in today", value: `${f.activeToday} of ${f.teachers}`, sub: "Opened the staff portal or made a change", meter: [f.activeToday, f.teachers], testId: "hero-active" },
    { label: "Registers taken", value: `${f.registersToday} of ${f.classes}`, sub: "Class registers marked today", meter: [f.registersToday, f.classes], testId: "hero-registers" },
    { label: "Exams this term", value: String(f.examsThisTerm), sub: d.examTerm, action: <button type="button" className="text-xs font-semibold text-[hsl(var(--p-gold))] underline-offset-4 hover:underline" onClick={() => onOpen("exams")}>See the exams</button>, testId: "hero-exams" },
    { label: "Waiting for your signature", value: String(f.awaitingSignature), sub: d.resultTerm ?? "No report card term yet", action: f.awaitingSignature > 0 ? <button type="button" className="portal-btn portal-btn-gold !min-h-[34px] !px-3 text-xs" onClick={() => onOpen("results")} data-testid="button-hero-sign">Review and sign</button> : undefined, testId: "hero-signature" },
  ];
  return (
    <section className="portal-hero rounded-3xl p-6 shadow-[0_30px_60px_-40px_hsl(var(--p-ink)/0.8)] sm:p-8" aria-labelledby="overview-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--p-gold))]">{schoolLabel} · {classesLabel}</p>
          <h2 id="overview-title" className="mt-2 font-serif text-3xl font-semibold leading-tight sm:text-4xl">{greeting()}{first ? `, ${first}` : ""}</h2>
          <p className="mt-1 text-sm text-white/75">{longDate(d.today)}. Here is how your school is doing.</p>
        </div>
      </div>
      <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border border-white/15 bg-white/[0.07] p-4 backdrop-blur-sm" data-testid={t.testId}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">{t.label}</p>
            <p className="mt-1.5 font-serif text-3xl font-semibold tabular-nums">{t.value}</p>
            {t.meter && <div className="mt-2"><Meter value={t.meter[0]} max={t.meter[1]} tone="light" label={t.label} /></div>}
            <p className="mt-2 text-xs text-white/65">{t.sub}</p>
            {t.action && <div className="mt-2.5">{t.action}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Short list of what the principal may want to act on today. */
export function attentionItems(d: PrincipalDashboard): { key: string; text: string; tab: PrincipalTab; tone: "gold" | "red" }[] {
  const items: { key: string; text: string; tab: PrincipalTab; tone: "gold" | "red" }[] = [];
  const weekday = !["Sat", "Sun"].includes(dayName(d.today));
  const review = d.classes.filter((c) => c.resultStatus === "review");
  if (review.length) items.push({ key: "sign", text: `${review.map((c) => c.name).join(", ")} ${review.length === 1 ? "has" : "have"} results waiting for your signature.`, tab: "results", tone: "gold" });
  const noRegister = d.classes.filter((c) => !c.registerToday && c.students > 0);
  if (weekday && noRegister.length) items.push({ key: "register", text: `No register yet today for ${noRegister.map((c) => c.name).join(", ")}.`, tab: "activity", tone: "gold" });
  const noTeacher = d.classes.filter((c) => !c.classTeachers.length);
  if (noTeacher.length) items.push({ key: "teacher", text: `${noTeacher.map((c) => c.name).join(", ")} ${noTeacher.length === 1 ? "has" : "have"} no class teacher.`, tab: "classes", tone: "red" });
  const away = d.teachers.filter((t) => t.activeDays.slice(-3).every((a) => !a));
  if (away.length) items.push({ key: "away", text: `${away.length === 1 ? away[0].name + " has" : `${away.length} teachers have`} not used the portal for three days${away.length > 1 ? ": " + away.map((t) => t.name).join(", ") : ""}.`, tab: "teachers", tone: "gold" });
  return items;
}

function Attention({ d, onOpen }: { d: PrincipalDashboard; onOpen: (tab: PrincipalTab) => void }) {
  const items = attentionItems(d);
  return (
    <section className="portal-card p-5" aria-labelledby="attention-title" data-testid="panel-attention">
      <h2 id="attention-title" className="font-serif text-xl font-semibold">Needs your attention</h2>
      {items.length ? (
        <ul className="mt-3 space-y-2">
          {items.map((i) => (
            <li key={i.key} className="flex flex-wrap items-center gap-3 rounded-xl bg-[hsl(var(--p-paper-2)/0.7)] px-3 py-2.5" data-testid={`attention-${i.key}`}>
              <AlertTriangle size={16} aria-hidden="true" className={i.tone === "red" ? "text-[hsl(var(--p-red))]" : "text-[hsl(var(--p-gold-ink))]"} />
              <span className="min-w-0 flex-1 text-sm">{i.text}</span>
              <button type="button" className="portal-btn-ghost !min-h-[32px] !px-3 text-xs" onClick={() => onOpen(i.tab)}>Open</button>
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 flex items-center gap-2 text-sm text-[hsl(var(--p-emerald))]"><CheckCircle2 size={16} aria-hidden="true" /> All clear. Registers, teachers and results are on track.</p>}
    </section>
  );
}

const CHIPS: [keyof PrincipalTeacherWeek["counts"], string][] = [["register", "Registers"], ["scores", "Report cards"], ["exams", "Exams"], ["marking", "Marking"], ["messages", "Messages"], ["assignments", "Assignments"], ["notes", "Notes"]];

function TeachersWeek({ d }: { d: PrincipalDashboard }) {
  const [filter, setFilter] = useState<"all" | "away">("all");
  const shown = d.teachers.filter((t) => filter === "all" || !t.activeToday);
  return (
    <section className="portal-card overflow-hidden !p-0" aria-labelledby="week-title" data-testid="panel-teacher-week">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--p-line))] px-5 py-4">
        <div><h2 id="week-title" className="font-serif text-xl font-semibold">Teachers this week</h2><p className={"text-sm " + MUTED}>The last seven days: which days each teacher was in, and what they did.</p></div>
        <div className="flex rounded-full border border-[hsl(var(--p-line))] p-0.5 text-xs font-semibold" role="group" aria-label="Show teachers">
          {(["all", "away"] as const).map((k) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={"rounded-full px-3 py-1.5 " + (filter === k ? "bg-[hsl(var(--p-ink))] text-white" : MUTED)} data-testid={`filter-week-${k}`}>{k === "all" ? `All (${d.teachers.length})` : `Not in today (${d.teachers.filter((t) => !t.activeToday).length})`}</button>)}
        </div>
      </div>
      {!shown.length ? <p className={"px-5 py-6 text-sm " + MUTED}>{d.teachers.length ? "Every teacher has been in today." : "No teachers in this school yet."}</p> : (
        <ul className="divide-y divide-[hsl(var(--p-line))]">
          {shown.map((t) => {
            const chips = CHIPS.filter(([k]) => t.counts[k] > 0);
            return (
              <li key={t.id} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1.3fr)_auto_minmax(0,1.4fr)_auto] md:items-center" data-testid={`week-${t.id}`}>
                <div className="flex min-w-0 items-center gap-3"><Avatar name={t.name} /><div className="min-w-0"><p className="truncate font-semibold">{t.name}</p><p className={"truncate text-xs " + MUTED}>{t.classes.length ? t.classes.join(", ") : "No class"}</p></div></div>
                <ol className="flex gap-1" aria-label={`Days ${t.name} was in`}>
                  {d.days.map((day, i) => (
                    <li key={day} className="flex flex-col items-center gap-1">
                      <span className={"text-[10px] font-semibold " + MUTED} aria-hidden="true">{dayName(day, "narrow")}</span>
                      <span className={"h-3.5 w-3.5 rounded-full " + (t.activeDays[i] ? "bg-[hsl(var(--p-emerald))]" : "border border-[hsl(var(--p-line))] bg-[hsl(var(--p-paper-2))]")} title={`${dayName(day, "long")}: ${t.activeDays[i] ? "in" : "not in"}`} />
                      <span className="sr-only">{dayName(day, "long")}: {t.activeDays[i] ? "in" : "not in"}</span>
                    </li>
                  ))}
                </ol>
                <div className="flex flex-wrap gap-1.5">
                  {chips.length ? chips.map(([k, label]) => <span key={k} className="rounded-full bg-[hsl(var(--p-emerald-soft))] px-2.5 py-0.5 text-xs font-semibold text-[hsl(var(--p-emerald))]">{label} · {t.counts[k]}</span>) : <span className={"text-xs " + MUTED}>No changes this week</span>}
                  {t.examsSet > 0 && <span className="rounded-full bg-[hsl(var(--p-gold-soft))] px-2.5 py-0.5 text-xs font-semibold text-[hsl(var(--p-gold-ink))]">{t.examsSet} {t.examsSet === 1 ? "exam" : "exams"} set this term</span>}
                </div>
                <p className={"whitespace-nowrap text-xs md:text-right " + (t.activeToday ? "font-semibold text-[hsl(var(--p-emerald))]" : MUTED)}>{lastSeenLabel(t.lastSeen, d.days)}</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ClassBoard({ d }: { d: PrincipalDashboard }) {
  if (!d.classes.length) return null;
  return (
    <section aria-labelledby="board-title">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 id="board-title" className="font-serif text-xl font-semibold">Classes</h2><p className={"text-sm " + MUTED}>Results: {d.resultTerm ?? "no term yet"}</p></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {d.classes.map((c) => {
          const st = RESULT_STATUS[c.resultStatus];
          return (
            <article key={c.id} className="portal-card p-4" data-testid={`board-${c.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><h3 className="font-serif text-lg font-semibold">{c.name}</h3><p className={"truncate text-xs " + MUTED}>{c.classTeachers.length ? c.classTeachers.join(", ") : "No class teacher"} · {c.students} {c.students === 1 ? "student" : "students"}</p></div>
                {c.registerToday ? <StatusPill tone="green">Register taken</StatusPill> : <StatusPill tone="muted">No register yet</StatusPill>}
              </div>
              <div className="mt-4 flex items-center justify-between text-xs"><span className={MUTED}>Scores entered</span><span className="font-semibold tabular-nums">{c.scoresEntered} of {c.scoresExpected}</span></div>
              <div className="mt-1.5"><Meter value={c.scoresEntered} max={c.scoresExpected} label={`${c.name} scores entered`} /></div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><StatusPill tone={st.tone}>{st.label}</StatusPill><span className={"text-xs " + MUTED}>{c.examsThisTerm} {c.examsThisTerm === 1 ? "exam" : "exams"} this term</span></div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Exams */

/** The exams teachers set in the principal's classes, term by term, with each paper one click away. */
export function ExamsView({ section }: { section: SchoolSection }) {
  const [term, setTerm] = useState<string | undefined>(undefined);
  const [classId, setClassId] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const params = { section, ...(term ? { term } : {}) };
  const q = useGetPrincipalExams(params, { query: { queryKey: getGetPrincipalExamsQueryKey(params) } });
  const exams = q.data?.exams ?? [];
  const classes = useMemo(() => [...new Map(exams.map((e) => [e.classId, e.className])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [exams]);
  const s = search.trim().toLowerCase();
  const shown = exams.filter((e) => (!classId || e.classId === Number(classId)) && (!status || e.status === status) && (!s || [e.title, e.subject, e.setBy, e.className].some((v) => v.toLowerCase().includes(s))));
  if (q.isLoading) return <Skeleton className="h-72" />;
  if (q.isError || !q.data) return <ErrorPanel title="Exams did not load" message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  if (!q.data.terms.length) return <EmptyState icon={<ClipboardList size={22} />} title="No exams yet" body="Exams and tests your teachers set in the staff portal appear here, term by term." />;
  const marked = exams.filter((e) => e.averagePercent !== null);
  const average = marked.length ? Math.round(marked.reduce((n, e) => n + (e.averagePercent ?? 0), 0) / marked.length) : null;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Term">
        {q.data.terms.map((t) => (
          <button key={t.key} type="button" aria-pressed={q.data!.term === t.key} onClick={() => { setTerm(t.key); setClassId(""); }} data-testid={`term-${t.key}`}
            className={"rounded-full border px-4 py-2 text-sm font-semibold transition " + (q.data!.term === t.key ? "border-[hsl(var(--p-emerald))] bg-[hsl(var(--p-emerald))] text-white" : "border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface))] hover:border-[hsl(var(--p-emerald))]")}>
            {t.label} <span className="ml-1 opacity-70">{t.count}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([["Exams set", exams.length], ["Open now", exams.filter((e) => e.status === "open").length], ["Students sat", exams.reduce((n, e) => n + e.sat, 0)], ["Average score", average === null ? "-" : `${average}%`]] as const).map(([label, value]) => (
          <div key={label} className="portal-card p-4"><p className={"text-xs font-semibold uppercase tracking-wider " + MUTED}>{label}</p><p className="mt-1 font-serif text-3xl font-semibold tabular-nums">{value}</p></div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="relative min-w-[12rem] flex-1"><span className="sr-only">Search exams</span><Search size={15} className={"absolute left-3 top-1/2 -translate-y-1/2 " + MUTED} aria-hidden="true" />
          <input className="portal-input !pl-9" placeholder="Search a subject, title or teacher" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-exams" /></label>
        <label><span className="sr-only">Class</span><select className="portal-input !w-auto" value={classId} onChange={(e) => setClassId(e.target.value)} data-testid="select-exam-class"><option value="">All classes</option>{classes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label><span className="sr-only">Status</span><select className="portal-input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="select-exam-status"><option value="">Any status</option>{Object.entries(EXAM_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
      </div>
      {!shown.length ? <p className={"portal-card p-6 text-sm " + MUTED}>No exams match.</p> : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {shown.map((e) => {
            const st = EXAM_STATUS[e.status];
            return (
              <li key={e.id} className="portal-card flex flex-col gap-3 p-5" data-testid={`exam-${e.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--p-emerald))]">{e.subject} · {e.className}</p><h3 className="mt-0.5 font-serif text-xl font-semibold">{e.title}</h3></div>
                  <StatusPill tone={st.tone}>{st.label}</StatusPill>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                  <div><dt className={"text-xs " + MUTED}>Set by</dt><dd className="font-medium">{e.setBy || "Not recorded"}</dd></div>
                  <div><dt className={"text-xs " + MUTED}>When</dt><dd className="font-medium">{lagos(e.startsAt, { day: "numeric", month: "short" })}, {clock(e.startsAt)}</dd></div>
                  <div><dt className={"text-xs " + MUTED}>Paper</dt><dd className="font-medium">{e.questionCount} questions · {e.totalMarks} marks</dd></div>
                  <div><dt className={"text-xs " + MUTED}>Sat</dt><dd className="font-medium tabular-nums">{e.sat} of {e.students}{e.averagePercent !== null ? ` · avg ${e.averagePercent}%` : ""}</dd></div>
                </dl>
                <Meter value={e.sat} max={e.students} label={`${e.title}: students who sat`} />
                <div><button type="button" className="portal-btn-ghost !min-h-[36px] text-sm" onClick={() => setOpen(e.id)} data-testid={`button-view-exam-${e.id}`}><Eye size={14} aria-hidden="true" /> View paper</button></div>
              </li>
            );
          })}
        </ul>
      )}
      {open !== null && <ExamPaperDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ExamPaperDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const q = useGetPrincipalExam(id, { query: { queryKey: getGetPrincipalExamQueryKey(id) } });
  const p = q.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-h-[88vh] max-w-2xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">{p ? p.exam.title : "Exam paper"}</DialogTitle>
          <DialogDescription>{p ? `${p.exam.subject} · ${p.exam.className} · ${p.exam.durationMinutes} minutes · ${p.exam.totalMarks} marks${p.exam.setBy ? ` · set by ${p.exam.setBy}` : ""}` : "Loading the paper"}</DialogDescription>
        </DialogHeader>
        {q.isLoading ? <Skeleton className="h-60" /> : q.isError || !p ? <ErrorPanel title="The paper did not load" message={errorMessage(q.error)} onRetry={() => void q.refetch()} /> : (
          <div className="space-y-4" data-testid="exam-paper">
            {p.instructions && <p className="rounded-xl bg-[hsl(var(--p-paper-2)/0.7)] p-3 text-sm whitespace-pre-line">{p.instructions}</p>}
            {p.exam.mode === "pdf" && <p className={"text-sm " + MUTED}>This exam was set from a PDF; students see the original paper.</p>}
            <ol className="space-y-3">
              {p.questions.map((qu, i) => (
                <li key={qu.id} className="rounded-xl border border-[hsl(var(--p-line))] p-4">
                  {qu.passage && qu.passage !== p.questions[i - 1]?.passage && <p className={"mb-2 border-l-2 border-[hsl(var(--p-gold))] pl-3 text-sm italic whitespace-pre-line " + MUTED}>{qu.passage}</p>}
                  <div className="flex gap-3"><span className="font-serif text-lg font-semibold text-[hsl(var(--p-emerald))]">{i + 1}.</span><p className="min-w-0 flex-1 whitespace-pre-line">{qu.text}</p><span className={"shrink-0 text-xs " + MUTED}>{qu.marks} {qu.marks === 1 ? "mark" : "marks"}</span></div>
                  {qu.hasDiagram && <p className={"mt-1 pl-7 text-xs " + MUTED}>Has a diagram (shown to students).</p>}
                  {qu.type === "mcq" ? (
                    <ul className="mt-2 grid gap-1.5 pl-7 sm:grid-cols-2">
                      {qu.options.map((o, k) => (
                        <li key={k} className={"flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm " + (qu.correctAnswer === k ? "bg-[hsl(var(--p-emerald-soft))] font-semibold text-[hsl(var(--p-emerald))]" : "bg-[hsl(var(--p-paper-2)/0.6)]")}>
                          <span className="font-semibold">{String.fromCharCode(65 + k)}.</span> {o}{qu.correctAnswer === k && <CheckCircle2 size={14} className="ml-auto" aria-label="Correct answer" />}
                        </li>
                      ))}
                    </ul>
                  ) : <p className={"mt-2 pl-7 text-xs " + MUTED}>Written answer, marked by the teacher.</p>}
                </li>
              ))}
            </ol>
          </div>
        )}
        <DialogFooter><button type="button" className="portal-btn-ghost" onClick={onClose}>Close</button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- Results */

/** A pad to sign with a finger, stylus or mouse; gives a PNG for the report cards. */
export function SignaturePad({ onDone }: { onDone: (image: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    const c = ref.current, ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.lineWidth = 3.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0b1f33";
  }, []);
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * e.currentTarget.width, ((e.clientY - r.top) / r.height) * e.currentTarget.height] as const;
  };
  const clear = () => { const c = ref.current, ctx = c?.getContext("2d"); if (c && ctx) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); setEmpty(true); } };
  return (
    <div>
      <canvas ref={ref} width={600} height={200} className="h-32 w-full max-w-md touch-none rounded-xl border border-[hsl(var(--p-line))] bg-white" aria-label="Sign here with your finger, a stylus or the mouse" data-testid="signature-pad"
        onPointerDown={(e) => { const ctx = e.currentTarget.getContext("2d"); if (!ctx) return; e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true; const [x, y] = point(e); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.1, y + 0.1); ctx.stroke(); setEmpty(false); }}
        onPointerMove={(e) => { if (!drawing.current) return; const ctx = e.currentTarget.getContext("2d"); if (!ctx) return; const [x, y] = point(e); ctx.lineTo(x, y); ctx.stroke(); }}
        onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }} />
      <div className="mt-2 flex gap-2">
        <button type="button" className="portal-btn-ghost !min-h-[34px] text-xs" onClick={clear}>Clear</button>
        <button type="button" className="portal-btn !min-h-[34px] text-xs" disabled={empty} onClick={() => ref.current && onDone(ref.current.toDataURL("image/png"))} data-testid="button-use-drawn-signature"><PenLine size={13} aria-hidden="true" /> Use this signature</button>
      </div>
    </div>
  );
}

function useResultsCommand(section: SchoolSection) {
  const m = useManagePrincipalResults();
  const qc = useQueryClient();
  const { toast } = useToast();
  const run = async (data: Omit<PrincipalResultsCommand, "section">) => {
    try {
      const r = await m.mutateAsync({ data: { ...data, section } });
      toast({ title: r.message });
      await Promise.all([qc.invalidateQueries({ queryKey: getGetPrincipalResultsQueryKey() }), qc.invalidateQueries({ queryKey: getGetPrincipalDashboardQueryKey() })]);
      return true;
    } catch (e) { toast({ variant: "destructive", title: "Not saved", description: errorMessage(e) }); return false; }
  };
  return { run, pending: m.isPending };
}

function MySignature({ section, saved }: { section: SchoolSection; saved: { name: string; image: string | null } }) {
  const cmd = useResultsCommand(section);
  const [name, setName] = useState(saved.name);
  const [image, setImage] = useState<string | null>(saved.image);
  const [draw, setDraw] = useState(false);
  useEffect(() => { setName(saved.name); setImage(saved.image); }, [saved.name, saved.image]);
  const ready = !!(saved.name && saved.image);
  return (
    <section className="portal-card p-5" aria-labelledby="sig-title" data-testid="panel-principal-signature">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h2 id="sig-title" className="font-serif text-xl font-semibold">My signature</h2><p className={"text-sm " + MUTED}>Printed on the report cards you sign, with your name under it.</p></div>
        {ready ? <StatusPill tone="green">Ready to sign</StatusPill> : <StatusPill tone="gold">Add it before signing</StatusPill>}
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,18rem)_1fr]">
        <label className="block text-sm font-semibold">Name on report cards
          <input className="portal-input mt-1" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mrs A. Okafor" data-testid="input-principal-name" />
        </label>
        <div>
          {draw ? <SignaturePad onDone={(img) => { setImage(img); setDraw(false); }} /> : <SignatureField label="Signature" value={image} onChange={setImage} testId="principal-own-signature" />}
          <button type="button" className={"mt-2 text-xs font-semibold underline underline-offset-4 " + MUTED} onClick={() => setDraw((v) => !v)} data-testid="button-toggle-draw">{draw ? "Upload a photo instead" : "Or sign on the screen"}</button>
        </div>
      </div>
      <button type="button" className="portal-btn mt-4" disabled={cmd.pending || !name.trim() || (name.trim() === saved.name && image === saved.image)} onClick={() => void cmd.run({ action: "saveSignature", name: name.trim(), signature: image })} data-testid="button-save-principal-signature"><FileSignature size={15} aria-hidden="true" /> Save my signature</button>
    </section>
  );
}

/** Each class's results for a term: preview, sign, return, publish. */
export function ResultsView({ section }: { section: SchoolSection }) {
  const [termId, setTermId] = useState<number | undefined>(undefined);
  const params = { section, ...(termId ? { termId } : {}) };
  const q = useGetPrincipalResults(params, { query: { queryKey: getGetPrincipalResultsQueryKey(params) } });
  const cmd = useResultsCommand(section);
  const { toast } = useToast();
  const [returning, setReturning] = useState<PrincipalResultClass | null>(null);
  const [previewing, setPreviewing] = useState<number | null>(null);
  if (q.isLoading) return <Skeleton className="h-72" />;
  if (q.isError || !q.data) return <ErrorPanel title="Results did not load" message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const signed = !!(d.signature.name && d.signature.image);
  const act = (c: PrincipalResultClass, action: "approve" | "publish" | "unpublish") => d.termId && cmd.run({ action, termId: d.termId, classId: c.id });
  const preview = async (c: PrincipalResultClass) => {
    if (!d.termId) return;
    setPreviewing(c.id);
    try {
      const ws = await getReportWorkspace({ termId: d.termId, classId: c.id });
      const term = ws.terms.find((t) => t.id === d.termId);
      if (!term || !ws.students.length) { toast({ title: "Nothing to print yet", description: `${c.name} has no students with results this term.` }); return; }
      if (!printReportCards(printableFor(ws, term, c.name))) toast({ variant: "destructive", title: "Pop-up blocked", description: "Allow pop-ups for this site to see the report cards." });
    } catch (e) { toast({ variant: "destructive", title: "Report cards did not open", description: errorMessage(e) }); } finally { setPreviewing(null); }
  };
  const count = (s: PrincipalResultClass["status"]) => d.classes.filter((c) => c.status === s).length;
  return (
    <div className="space-y-5">
      <MySignature section={section} saved={d.signature} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-semibold">Term
          <select className="portal-input !w-auto" value={d.termId ?? ""} onChange={(e) => setTermId(Number(e.target.value) || undefined)} disabled={!d.terms.length} data-testid="select-results-term">
            {!d.terms.length && <option value="">No terms yet</option>}
            {d.terms.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
      </div>
      {!d.terms.length ? <EmptyState icon={<BookOpenCheck size={22} />} title="No report card term yet" body="Once the school office creates a term under Report cards, each class's results appear here for you to sign." /> : (<>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([["Waiting for you", count("review"), true], ["Signed", count("approved"), false], ["Published", count("published"), false], ["With class teachers", count("draft"), false]] as const).map(([label, value, warn]) => (
            <div key={label} className="portal-card p-4"><p className={"text-xs font-semibold uppercase tracking-wider " + MUTED}>{label}</p><p className={"mt-1 font-serif text-3xl font-semibold tabular-nums " + (warn && value ? "text-[hsl(var(--p-gold-ink))]" : "")}>{value}</p></div>
          ))}
        </div>
        {!d.classes.length ? <EmptyState icon={<Users size={22} />} title="No classes yet" body="Your classes appear here once the office adds them." /> : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {[...d.classes].sort((a, b) => ["review", "approved", "draft", "published"].indexOf(a.status) - ["review", "approved", "draft", "published"].indexOf(b.status) || a.name.localeCompare(b.name)).map((c) => {
              const st = RESULT_STATUS[c.status];
              return (
                <li key={c.id} className={"portal-card p-5 " + (c.status === "review" ? "ring-2 ring-[hsl(var(--p-gold)/0.6)]" : "")} data-testid={`result-${c.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><h3 className="font-serif text-xl font-semibold">{c.name}</h3>
                      <p className={"text-xs " + MUTED}>{c.teacherName ? `Sent by ${c.teacherName}${c.submittedAt ? `, ${lagos(c.submittedAt, { day: "numeric", month: "short" })}` : ""}` : "Not sent yet"}{c.approvedBy && c.status !== "draft" ? ` · signed by ${c.approvedBy}` : ""}</p></div>
                    <StatusPill tone={st.tone}>{st.label}</StatusPill>
                  </div>
                  <div className="mt-4 flex items-center justify-between text-xs"><span className={MUTED}>Scores entered</span><span className="font-semibold tabular-nums">{c.scoresEntered} of {c.scoresExpected}</span></div>
                  <div className="mt-1.5"><Meter value={c.scoresEntered} max={c.scoresExpected} label={`${c.name} scores entered`} /></div>
                  {c.status === "draft" && c.returnNote && <p className="mt-3 rounded-lg bg-[hsl(var(--p-gold-soft))] px-3 py-2 text-xs text-[hsl(var(--p-gold-ink))]">Your note: {c.returnNote}</p>}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" className="portal-btn-ghost !min-h-[36px] text-sm" disabled={previewing === c.id} onClick={() => void preview(c)} data-testid={`button-preview-${c.id}`}><Printer size={14} aria-hidden="true" /> {previewing === c.id ? "Opening..." : "Report cards"}</button>
                    {c.status === "review" && <button type="button" className="portal-btn !min-h-[36px] text-sm" disabled={cmd.pending || !signed} title={signed ? undefined : "Save your signature first"} onClick={() => void act(c, "approve")} data-testid={`button-sign-${c.id}`}><FileSignature size={14} aria-hidden="true" /> Approve and sign</button>}
                    {(c.status === "review" || c.status === "approved") && <button type="button" className="portal-btn-ghost !min-h-[36px] text-sm" disabled={cmd.pending} onClick={() => setReturning(c)} data-testid={`button-return-${c.id}`}><Undo2 size={14} aria-hidden="true" /> Send back</button>}
                    {c.status === "approved" && <button type="button" className="portal-btn portal-btn-gold !min-h-[36px] text-sm" disabled={cmd.pending} onClick={() => { if (window.confirm(`Publish ${c.name}'s report cards to students and parents?`)) void act(c, "publish"); }} data-testid={`button-publish-${c.id}`}><Send size={14} aria-hidden="true" /> Publish</button>}
                    {c.status === "published" && <button type="button" className="portal-btn-ghost !min-h-[36px] text-sm" disabled={cmd.pending} onClick={() => { if (window.confirm(`Withhold ${c.name}'s report cards? Students and parents will no longer see them.`)) void act(c, "unpublish"); }} data-testid={`button-withhold-${c.id}`}><CalendarCheck2 size={14} aria-hidden="true" /> Withhold</button>}
                  </div>
                  {c.status === "review" && !signed && <p className="mt-2 text-xs text-[hsl(var(--p-gold-ink))]">Save your signature above to sign these results.</p>}
                </li>
              );
            })}
          </ul>
        )}
      </>)}
      {returning && d.termId && <ReturnDialog cls={returning} onClose={() => setReturning(null)} onSend={async (note) => { if (await cmd.run({ action: "return", termId: d.termId!, classId: returning.id, note })) setReturning(null); }} pending={cmd.pending} />}
    </div>
  );
}

function ReturnDialog({ cls, onClose, onSend, pending }: { cls: PrincipalResultClass; onClose: () => void; onSend: (note: string) => void; pending: boolean }) {
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-w-md rounded-2xl">
        <DialogHeader><DialogTitle className="font-serif text-2xl">Send back {cls.name}</DialogTitle><DialogDescription>The results go back to {cls.teacherName || "the class teacher"} to correct. Say what needs fixing.</DialogDescription></DialogHeader>
        <label className="block text-sm font-semibold">Note for the teacher
          <textarea className="portal-input mt-1 min-h-[96px]" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Please check the Mathematics exam scores" data-testid="input-return-note" />
        </label>
        <DialogFooter className="gap-2"><button type="button" className="portal-btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="portal-btn" disabled={pending} onClick={() => onSend(note.trim())} data-testid="button-confirm-return">{pending ? "Sending..." : "Send back"}</button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
