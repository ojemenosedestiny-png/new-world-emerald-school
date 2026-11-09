import { useState } from "react";
import { getGetParentChildProgressQueryKey, useGetParentChildProgress, type ParentChild, type ParentChildProgress as Progress } from "@workspace/api-client-react";
import { BookOpenCheck, CalendarCheck, CalendarRange, ClipboardList, FileBarChart, FileText } from "lucide-react";
import { EmptyState, ErrorPanel, Skeleton, StatusPill } from "../ui";
import { errorMessage, fileUrl } from "../lib";
import { TimetableList } from "../Timetables";
import { TermReport } from "../reports/StudentReports";

type Tab = "reports" | "results" | "attendance" | "homework" | "timetables";
const MUTED = "text-[hsl(var(--p-ink)/0.62)]";
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
const dateOnly = (d: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(d + "T12:00:00Z"));

/** How each child is doing: report cards, exam and test results, attendance and homework, as the child sees them. */
export function ChildProgressView({ children, selected, onSelect }: { children: ParentChild[]; selected: number | null; onSelect: (id: number) => void }) {
  const id = selected ?? children[0]?.id ?? null;
  if (id === null) return <EmptyState icon={<FileBarChart size={22} />} title="No children linked" body="Ask the school office to link your children to your email." />;
  return (
    <div className="space-y-5">
      {children.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Child">
          {children.map((c) => (
            <button key={c.id} type="button" aria-pressed={c.id === id} onClick={() => onSelect(c.id)} data-testid={`button-progress-child-${c.id}`}
              className={"rounded-full border px-4 py-2 text-sm font-semibold " + (c.id === id ? "border-[hsl(var(--p-emerald))] bg-[hsl(var(--p-emerald))] text-white" : "border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface))]")}>{c.name}</button>
          ))}
        </div>
      )}
      <ChildPanel key={id} studentId={id} />
    </div>
  );
}

function ChildPanel({ studentId }: { studentId: number }) {
  const q = useGetParentChildProgress(studentId, { query: { queryKey: getGetParentChildProgressQueryKey(studentId) } });
  const [tab, setTab] = useState<Tab>("reports");
  if (q.isLoading) return <Skeleton className="h-72" />;
  if (q.isError || !q.data) return <ErrorPanel title="Progress did not load" message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const t = d.attendance.totals;
  const rate = t.daysRecorded ? Math.round((t.daysPresent / t.daysRecorded) * 100) : null;
  const released = d.results.filter((r) => r.released && r.score !== null);
  const average = released.length ? Math.round(released.reduce((n, r) => n + (r.score! / (r.totalMarks || 1)) * 100, 0) / released.length) : null;
  const due = d.homework.filter((h) => !h.submission && new Date(h.dueAt) > new Date()).length;
  const missed = d.homework.filter((h) => !h.submission && new Date(h.dueAt) <= new Date()).length;
  const tabs: [Tab, string, typeof FileBarChart, number][] = [["reports", "Report cards", FileBarChart, d.reports.length], ["results", "Exams and tests", ClipboardList, d.results.length], ["attendance", "Attendance", CalendarCheck, t.daysRecorded], ["homework", "Homework", BookOpenCheck, d.homework.length], ["timetables", "Timetables", CalendarRange, d.timetables.length]];
  return (
    <div className="space-y-5" data-testid={`progress-${studentId}`}>
      <section className="portal-hero rounded-3xl p-6 sm:p-8" aria-labelledby="child-title">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--p-gold))]">{d.child.className} · {d.child.studentId}</p>
        <h2 id="child-title" className="mt-2 font-serif text-3xl font-semibold">{d.child.name}</h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {([["Latest report card", d.reports[0] ? (d.reports[0].result.average === null ? "-" : `${d.reports[0].result.average}%`) : "Not yet", d.reports[0] ? `${d.reports[0].term.term}, ${d.reports[0].term.session}` : "Published report cards appear here"],
             ["Exam average", average === null ? "-" : `${average}%`, `${released.length} released ${released.length === 1 ? "result" : "results"}`],
             ["Attendance", rate === null ? "-" : `${rate}%`, `${t.daysPresent} of ${t.daysRecorded} days, last 6 months`],
             ["Homework", `${d.homework.filter((h) => h.submission).length} of ${d.homework.length}`, missed ? `${missed} not handed in` : due ? `${due} still to hand in` : d.homework.length ? "All handed in" : "None set yet"]] as const).map(([label, value, sub]) => (
            <div key={label} className="rounded-2xl border border-white/15 bg-white/[0.07] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">{label}</p>
              <p className="mt-1.5 font-serif text-3xl font-semibold tabular-nums">{value}</p>
              <p className="mt-1 text-xs text-white/65">{sub}</p>
            </div>
          ))}
        </div>
      </section>
      <div className="flex gap-1 overflow-x-auto rounded-full border border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface)/0.7)] p-1" role="tablist">
        {tabs.map(([k, label, Icon, n]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={"portal-tab inline-flex items-center gap-1.5 whitespace-nowrap " + (tab === k ? "!bg-[hsl(var(--p-ink))] !text-[hsl(var(--p-paper))]" : "")} data-testid={`tab-progress-${k}`}><Icon size={14} aria-hidden="true" /> {label} <span className="opacity-60">{n}</span></button>)}
      </div>
      {tab === "reports" && <Reports d={d} />}
      {tab === "results" && <Results d={d} />}
      {tab === "attendance" && <Attendance d={d} />}
      {tab === "homework" && <Homework d={d} />}
      {tab === "timetables" && <TimetableList items={d.timetables} who={d.child.name.split(" ")[0] + "'s class"} />}
    </div>
  );
}

function Reports({ d }: { d: Progress }) {
  const [open, setOpen] = useState<number | null>(d.reports[0]?.term.id ?? null);
  if (!d.reports.length) return <EmptyState icon={<FileBarChart size={22} />} title="No report cards yet" body="Report cards appear here once the school publishes them at the end of term." />;
  const data = { studentName: d.child.name, studentId: d.child.studentId, className: d.child.className, reports: d.reports };
  return <div className="space-y-3">{d.reports.map((r) => <TermReport key={`${r.term.id}-${r.className}`} data={data} report={r} open={open === r.term.id} onToggle={() => setOpen(open === r.term.id ? null : r.term.id)} />)}</div>;
}

function Results({ d }: { d: Progress }) {
  return (
    <div className="space-y-5">
      {d.upcoming.length > 0 && (
        <section className="portal-card p-5"><h3 className="font-serif text-lg font-semibold">Coming up</h3>
          <ul className="mt-2 divide-y divide-[hsl(var(--p-line))] text-sm">{d.upcoming.map((u) => <li key={u.examId} className="flex flex-wrap justify-between gap-2 py-2"><span><b>{u.title}</b> <span className={MUTED}>· {u.subject}</span></span><span className={MUTED}>{day(u.startsAt)}</span></li>)}</ul>
        </section>
      )}
      {!d.results.length ? <EmptyState icon={<ClipboardList size={22} />} title="No exams or tests written yet" body="Each exam your child writes on the portal appears here. Scores show once the teacher releases them." /> : (
        <div className="portal-card overflow-x-auto !p-0">
          <table className="w-full min-w-[520px] text-sm" data-testid="table-child-results">
            <thead className={"text-left text-xs uppercase tracking-wider " + MUTED}><tr><th className="px-5 py-3">Exam or test</th><th className="px-3 py-3">Date</th><th className="px-5 py-3 text-right">Score</th></tr></thead>
            <tbody>{d.results.map((r) => (
              <tr key={r.examId} className="border-t border-[hsl(var(--p-line))]">
                <td className="px-5 py-3"><b>{r.title}</b><span className={"block text-xs " + MUTED}>{r.subject}</span></td>
                <td className="whitespace-nowrap px-3 py-3">{day(r.date)}</td>
                <td className="px-5 py-3 text-right tabular-nums">{r.released && r.score !== null ? <><b>{r.score}</b> / {r.totalMarks} <span className={MUTED}>({Math.round((r.score / (r.totalMarks || 1)) * 100)}%)</span></> : r.status === "in_progress" ? <StatusPill tone="muted">Not finished</StatusPill> : <StatusPill tone="gold">Waiting for the teacher</StatusPill>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Attendance({ d }: { d: Progress }) {
  const t = d.attendance.totals;
  if (!t.daysRecorded) return <EmptyState icon={<CalendarCheck size={22} />} title="No register records yet" body="Days present and absent appear here once the class teacher takes the register." />;
  const tone = (s: string) => (s === "present" ? "green" : s === "late" ? "gold" : s === "absent" ? "red" : "muted") as "green" | "gold" | "red" | "muted";
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([["Present", t.present], ["Late", t.late], ["Absent", t.absent], ["Excused", t.excused]] as const).map(([label, n]) => <div key={label} className="portal-card p-4"><p className={"text-xs font-semibold uppercase tracking-wider " + MUTED}>{label}</p><p className="mt-1 font-serif text-3xl font-semibold tabular-nums">{n}</p></div>)}
      </div>
      <div className="portal-card !p-0">
        <h3 className="px-5 pt-4 font-serif text-lg font-semibold">Recent days</h3>
        <ul className="mt-2 divide-y divide-[hsl(var(--p-line))] text-sm" data-testid="list-child-attendance">
          {d.attendance.records.map((r) => <li key={r.date} className="flex items-center justify-between gap-3 px-5 py-2"><span>{dateOnly(r.date)}{r.note ? <span className={"ml-2 text-xs " + MUTED}>{r.note}</span> : null}</span><StatusPill tone={tone(r.status)}>{r.status[0].toUpperCase() + r.status.slice(1)}</StatusPill></li>)}
        </ul>
      </div>
    </div>
  );
}

function Homework({ d }: { d: Progress }) {
  if (!d.homework.length) return <EmptyState icon={<BookOpenCheck size={22} />} title="No homework set" body="Homework the teachers set for the class appears here, with your child's mark and feedback." />;
  const now = new Date();
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {[...d.homework].sort((a, b) => b.dueAt.localeCompare(a.dueAt)).map((h) => {
        const s = h.submission;
        return (
          <li key={h.id} className="portal-card p-5" data-testid={`child-homework-${h.id}`}>
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--p-emerald))]">{h.subject}</p><h3 className="font-semibold">{h.title}</h3></div>
              {s?.markedAt ? <StatusPill tone="green">{s.score} / {h.maxScore}</StatusPill> : s ? <StatusPill tone="gold">Handed in{s.late ? " late" : ""}</StatusPill> : new Date(h.dueAt) < now ? <StatusPill tone="red">Not handed in</StatusPill> : <StatusPill tone="muted">Due</StatusPill>}</div>
            <p className={"mt-1 text-xs " + MUTED}>Due {day(h.dueAt)}</p>
            {h.fileId && <a className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[hsl(var(--p-emerald))] underline-offset-2 hover:underline" href={fileUrl(h.fileId)} target="_blank" rel="noreferrer" data-testid={`link-child-homework-sheet-${h.id}`}><FileText size={14} /> Question sheet (PDF)</a>}
            {s?.feedback && <p className="mt-2 rounded-lg bg-[hsl(var(--p-paper-2)/0.7)] px-3 py-2 text-sm"><b>Teacher:</b> {s.feedback}</p>}
          </li>
        );
      })}
    </ul>
  );
}
