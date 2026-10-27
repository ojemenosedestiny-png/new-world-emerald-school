import { useMemo, useState, type ReactNode } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  getAttendanceSheet, getGetAttendanceSheetQueryKey, getListMessageThreadsQueryKey, getListStaffAssignmentsQueryKey,
  useListMessageThreads, useListStaffAssignments, type PortalManagement,
} from "@workspace/api-client-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, BarChart3, CalendarCheck, Table2 } from "lucide-react";
import { formatDateTime } from "../lib";
import { overviewCounts } from "./Overview";
import { dashboardData, type LiveExam } from "./dashboardData";
import { localDate } from "./AttendancePanel";

type Section = "exams" | "marking" | "students" | "attendance" | "assignments" | "messages";
type ChartTheme = { mark: string; grid: string; tick: string };
const THEMES: Record<"light" | "dark", ChartTheme> = {
  // Mark colours validated (lightness, chroma, >= 3:1 contrast) against each card surface.
  light: { mark: "#1e8a5c", grid: "#e6e1d6", tick: "#5c6b70" },
  dark: { mark: "#3daa79", grid: "#26333b", tick: "#9aa7ab" },
};
const MUTED = "text-[hsl(var(--p-ink)/0.6)]";
const clock = (iso: string) => new Intl.DateTimeFormat("en-NG", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));

function ChartCard({ title, subtitle, empty, chart, table, testId }: { title: string; subtitle: string; empty?: string; chart: ReactNode; table: ReactNode; testId: string }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="portal-card flex flex-col p-5" aria-label={title} data-testid={testId}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div><h2 className="text-[15px] font-semibold">{title}</h2><p className={"text-xs " + MUTED}>{subtitle}</p></div>
        {!empty && <button type="button" className="portal-btn-ghost !px-2 !py-1 text-xs" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>{asTable ? <><BarChart3 size={12} /> Chart</> : <><Table2 size={12} /> Table</>}</button>}
      </div>
      {empty ? <p className="grid flex-1 place-items-center py-10 text-center text-sm text-[hsl(var(--p-ink)/0.5)]">{empty}</p> : asTable ? <div className="max-h-64 overflow-y-auto text-sm">{table}</div> : <div className="h-56">{chart}</div>}
    </section>
  );
}

function TipBox({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-xl border border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface))] px-3 py-2 text-xs text-[hsl(var(--p-ink))] shadow-lg">
      <p className="font-semibold">{title}</p>{lines.map((l) => <p key={l} className="text-[hsl(var(--p-ink)/0.7)]">{l}</p>)}
    </div>
  );
}

const tableCls = "w-full [&_td]:py-1.5 [&_th]:pb-1.5 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:text-[hsl(var(--p-ink)/0.55)] [&_tr]:border-b [&_tr]:border-[hsl(var(--p-line))]";

/** One exam in the room: a bar of the class split into submitted, writing, out of time and not started. */
function LiveRow({ e, onGo }: { e: LiveExam; onGo: (s: Section) => void }) {
  const parts = [
    { key: "submitted", n: e.submitted, label: "Submitted", cls: "bg-[hsl(var(--p-emerald))]" },
    { key: "writing", n: e.writing, label: "Writing", cls: "bg-[hsl(var(--p-emerald)/0.35)]" },
    { key: "timedOut", n: e.timedOut, label: "Out of time", cls: "bg-[hsl(var(--p-gold))]" },
    { key: "notStarted", n: e.notStarted, label: "Not started", cls: "bg-[hsl(var(--p-paper-2))]" },
  ];
  return (
    <li className="grid gap-3 py-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_auto] md:items-center" data-testid={`live-exam-${e.id}`}>
      <div className="min-w-0">
        <p className="truncate font-semibold">{e.title}</p>
        <p className={"text-xs " + MUTED}>{e.className} / {e.subject} / closes {clock(e.endsAt)}</p>
      </div>
      <div>
        <div className="flex h-3 overflow-hidden rounded-full bg-[hsl(var(--p-paper-2))]" role="img" aria-label={parts.map((p) => `${p.n} ${p.label.toLowerCase()}`).join(", ")}>
          {parts.map((p) => p.n > 0 && <span key={p.key} className={p.cls} style={{ width: `${(p.n / Math.max(e.classSize, 1)) * 100}%` }} />)}
        </div>
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {parts.map((p) => (
            <div key={p.key} className="flex items-center gap-1.5">
              <span className={"h-2 w-2 rounded-full " + p.cls} aria-hidden="true" />
              <dt className={MUTED}>{p.label}</dt>
              <dd className="font-semibold tabular-nums" data-testid={`live-${p.key}-${e.id}`}>{p.n}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="flex gap-2 md:justify-end">
        <button type="button" className="portal-btn-ghost !py-1.5 text-xs" onClick={() => onGo("exams")}>Extra time or reset</button>
        {e.submitted > 0 && <button type="button" className="portal-btn-ghost !py-1.5 text-xs" onClick={() => onGo("marking")}>Mark</button>}
      </div>
    </li>
  );
}

type Todo = { key: string; text: string; detail: string; action: string; go: Section; urgent?: boolean };

export function Dashboard({ data, dark, onGo }: { data: PortalManagement; dark: boolean; onGo: (section: Section) => void }) {
  const t = THEMES[dark ? "dark" : "light"];
  const counts = overviewCounts(data);
  const d = useMemo(() => dashboardData(data), [data]);
  const today = localDate();
  const threads = useListMessageThreads({ query: { queryKey: getListMessageThreadsQueryKey(), staleTime: 30_000 } });
  const assignments = useListStaffAssignments({ query: { queryKey: getListStaffAssignmentsQueryKey(), staleTime: 60_000 } });
  // Today's register for each class (at most 20), to list the ones still to take.
  const registers = useQueries({
    queries: data.classes.slice(0, 20).map((c) => ({
      queryKey: getGetAttendanceSheetQueryKey({ classId: c.id as number, date: today }),
      queryFn: () => getAttendanceSheet({ classId: c.id as number, date: today }),
      staleTime: 60_000,
    })),
  });

  const axis = { tick: { fill: t.tick, fontSize: 11 }, tickLine: false, axisLine: false } as const;
  const narrow = window.innerWidth < 640;
  const animate = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const bar = { fill: t.mark, radius: [4, 4, 0, 0] as [number, number, number, number], maxBarSize: 24, isAnimationActive: animate };
  const totalSubmissions = d.days.reduce((s, x) => s + x.count, 0);

  const weekday = new Date().getDay();
  const schoolDay = weekday !== 0 && weekday !== 6;
  // Defensive: a failed or odd response for one block must never take the whole home screen down.
  const registerMissing = schoolDay ? data.classes.slice(0, 20).filter((_, i) => {
    const sheet = registers[i]?.data;
    return !!sheet && sheet.taken === false && Array.isArray(sheet.students) && sheet.students.length > 0;
  }) : [];
  const unread = Array.isArray(threads.data) ? threads.data.reduce((n, th) => n + (th.unread || 0), 0) : 0;
  const homeworkToMark = Array.isArray(assignments.data) ? assignments.data.reduce((n, a) => n + Math.max(0, (a.submitted || 0) - (a.marked || 0)), 0) : 0;
  const ready = d.attention.filter((a) => a.kind === "release");

  const todo: Todo[] = [
    ...(registerMissing.length ? [{ key: "register", text: `Take today's register for ${registerMissing.map((c) => c.name).join(", ")}`, detail: `${registerMissing.length} of ${data.classes.length} ${data.classes.length === 1 ? "class" : "classes"} not taken yet`, action: "Take register", go: "attendance" as const, urgent: true }] : []),
    ...(counts.toMark ? [{ key: "mark", text: `${counts.toMark} exam ${counts.toMark === 1 ? "script" : "scripts"} to mark`, detail: "Written answers waiting for a score", action: "Mark", go: "marking" as const, urgent: true }] : []),
    ...(unread ? [{ key: "messages", text: `${unread} unread ${unread === 1 ? "message" : "messages"} from students`, detail: "Replies keep students and parents informed", action: "Reply", go: "messages" as const }] : []),
    ...(homeworkToMark ? [{ key: "homework", text: `${homeworkToMark} homework ${homeworkToMark === 1 ? "submission" : "submissions"} to mark`, detail: "Handed in and waiting for feedback", action: "Open", go: "assignments" as const }] : []),
    ...ready.map((r) => ({ key: `release-${r.examId}`, text: `Results ready to release: ${r.title}`, detail: "Every script is marked", action: "Release", go: "exams" as const })),
  ];
  const summary = d.live.length
    ? `${d.live.length} ${d.live.length === 1 ? "exam is" : "exams are"} open: ${counts.writing} writing now.`
    : todo.length ? `${todo.length} ${todo.length === 1 ? "thing needs" : "things need"} you today.` : "Everything is up to date.";
  const date = new Intl.DateTimeFormat("en-NG", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <p className={"text-sm " + MUTED}>{date}</p>
          <p className="mt-0.5 font-serif text-2xl font-semibold" data-testid="text-dashboard-summary">{summary}</p>
        </div>
        <button type="button" className="portal-btn" onClick={() => onGo("attendance")} data-testid="button-dashboard-register"><CalendarCheck size={15} /> Take register</button>
      </div>

      <section className="portal-card grid grid-cols-2 divide-[hsl(var(--p-line))] md:grid-cols-4 md:divide-x" aria-label="Portal overview">
        {[
          { label: "Active students", value: counts.students, testId: "stat-students", tone: "" },
          { label: "Exams open now", value: counts.openExams, testId: "stat-open-exams", tone: counts.openExams ? "text-[hsl(var(--p-emerald))]" : "" },
          { label: "Writing right now", value: counts.writing, testId: "stat-writing", tone: counts.writing ? "text-[hsl(var(--p-emerald))]" : "" },
          { label: "Awaiting marking", value: counts.toMark, testId: "stat-to-mark", tone: counts.toMark ? "text-[hsl(var(--p-gold-ink))]" : "" },
        ].map((s) => (
          <div key={s.testId} className="px-5 py-4" data-testid={s.testId}>
            <p className={"text-xs font-medium " + MUTED}>{s.label}</p>
            <p className={"mt-1 text-[28px] font-semibold leading-none tabular-nums " + s.tone}>{s.value.toLocaleString()}</p>
          </div>
        ))}
      </section>

      {d.live.length > 0 && (
        <section className="portal-card p-5" aria-labelledby="live-title" data-testid="panel-live-exams">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="live-title" className="text-[15px] font-semibold"><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-[hsl(var(--p-emerald))] motion-reduce:animate-none" aria-hidden="true" />Exams in progress</h2>
            <p className={"text-xs " + MUTED}>Updates every 20 seconds</p>
          </div>
          <ul className="divide-y divide-[hsl(var(--p-line))]">{d.live.map((e) => <LiveRow key={e.id} e={e} onGo={onGo} />)}</ul>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="portal-card p-5 lg:col-span-1" aria-labelledby="todo-title" data-testid="panel-attention">
          <h2 id="todo-title" className="text-[15px] font-semibold">To do today</h2>
          <p className={"mb-3 text-xs " + MUTED}>Registers, marking, messages and results</p>
          {todo.length === 0 ? (
            <p className="rounded-xl bg-[hsl(var(--p-emerald-soft)/0.6)] p-3 text-sm" data-testid="text-all-caught-up">All caught up. Nothing is waiting for you.</p>
          ) : (
            <ul className="divide-y divide-[hsl(var(--p-line))]">
              {todo.map((item) => (
                <li key={item.key} className="flex items-center gap-3 py-3" data-testid={`todo-${item.key}`}>
                  <span className={"h-2 w-2 shrink-0 rounded-full " + (item.urgent ? "bg-[hsl(var(--p-gold))]" : "bg-[hsl(var(--p-line))]")} aria-hidden="true" />
                  <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{item.text}</span><span className={"block text-xs " + MUTED}>{item.detail}</span></span>
                  <button type="button" className="portal-btn-ghost shrink-0 !px-2.5 !py-1 text-xs" onClick={() => onGo(item.go)}>{item.action} <ArrowRight size={12} /></button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="lg:col-span-2">
          <ChartCard title="Average score by exam" subtitle="Marked attempts, most recent exams" testId="chart-exam-averages"
            empty={d.examAverages.length ? undefined : "Averages appear once attempts are marked."}
            chart={
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.examAverages} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={t.grid} />
                  {/* Narrow screens keep the first and last labels; the tooltip and table carry every value. */}
                  <XAxis dataKey="title" {...axis} interval={narrow ? "preserveStartEnd" : 0} tickFormatter={(v: string) => (v.length > 12 ? v.slice(0, 11) + "…" : v)} />
                  <YAxis {...axis} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v: number) => v + "%"} />
                  <Tooltip cursor={{ fill: t.grid, opacity: 0.5 }} content={({ active, payload }) => active && payload?.[0] ? <TipBox title={payload[0].payload.title} lines={[payload[0].payload.className, `Average ${payload[0].payload.average}%`, `${payload[0].payload.marked} marked`]} /> : null} />
                  <Bar dataKey="average" {...bar} />
                </BarChart>
              </ResponsiveContainer>
            }
            table={<table className={tableCls}><thead><tr><th>Exam</th><th>Class</th><th className="!text-right">Average</th><th className="!text-right">Marked</th></tr></thead><tbody>{d.examAverages.map((e) => <tr key={e.id}><td>{e.title}</td><td>{e.className}</td><td className="text-right tabular-nums">{e.average}%</td><td className="text-right tabular-nums">{e.marked}</td></tr>)}</tbody></table>}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Submissions" subtitle={`Last 14 days / ${totalSubmissions} in total`} testId="chart-submissions"
          empty={totalSubmissions ? undefined : "No exam submissions in the last 14 days."}
          chart={
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.days} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={t.grid} />
                <XAxis dataKey="label" {...axis} interval={1} />
                <YAxis {...axis} allowDecimals={false} />
                <Tooltip cursor={{ fill: t.grid, opacity: 0.5 }} content={({ active, payload }) => active && payload?.[0] ? <TipBox title={payload[0].payload.label} lines={[`${payload[0].payload.count} submitted`]} /> : null} />
                <Bar dataKey="count" {...bar} />
              </BarChart>
            </ResponsiveContainer>
          }
          table={<table className={tableCls}><thead><tr><th>Day</th><th className="!text-right">Submitted</th></tr></thead><tbody>{d.days.map((x) => <tr key={x.date}><td>{x.label}</td><td className="text-right tabular-nums">{x.count}</td></tr>)}</tbody></table>}
        />
        <ChartCard title="Students per class" subtitle="Active enrolments" testId="chart-classes"
          empty={d.studentsByClass.some((c) => c.students) ? undefined : "Enrol students to see class sizes."}
          chart={
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.studentsByClass.slice(0, 8)} layout="vertical" margin={{ top: 0, right: 28, left: 8, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke={t.grid} />
                <XAxis type="number" {...axis} allowDecimals={false} />
                <YAxis type="category" dataKey="name" {...axis} width={88} tickFormatter={(v: string) => (v.length > 12 ? v.slice(0, 11) + "…" : v)} />
                <Tooltip cursor={{ fill: t.grid, opacity: 0.5 }} content={({ active, payload }) => active && payload?.[0] ? <TipBox title={payload[0].payload.name} lines={[`${payload[0].payload.students} active students`]} /> : null} />
                <Bar dataKey="students" fill={t.mark} radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={animate} label={{ position: "right", fill: t.tick, fontSize: 11 }} />
              </BarChart>
            </ResponsiveContainer>
          }
          table={<table className={tableCls}><thead><tr><th>Class</th><th className="!text-right">Students</th></tr></thead><tbody>{d.studentsByClass.map((c) => <tr key={c.name}><td>{c.name}</td><td className="text-right tabular-nums">{c.students}</td></tr>)}</tbody></table>}
        />
      </div>

      <section className="portal-card p-5" aria-label="Upcoming exams" data-testid="panel-upcoming">
        <div className="mb-3 flex items-center justify-between"><div><h2 className="text-[15px] font-semibold">Upcoming and open exams</h2><p className={"text-xs " + MUTED}>Published exams students can see</p></div><button type="button" className="portal-btn-ghost text-xs" onClick={() => onGo("exams")}>All exams <ArrowRight size={12} /></button></div>
        {d.upcoming.length === 0 ? <p className="py-4 text-sm text-[hsl(var(--p-ink)/0.55)]">No published exams are open or scheduled.</p> : (
          <ul className="divide-y divide-[hsl(var(--p-line))]">
            {d.upcoming.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2.5">
                <span className={"h-2 w-2 shrink-0 rounded-full " + (e.open ? "bg-[hsl(var(--p-emerald))]" : "bg-[hsl(var(--p-line))]")} aria-hidden="true" />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{e.title}</span><span className={"block text-xs " + MUTED}>{e.className} / {e.subject}</span></span>
                <span className="text-right text-xs text-[hsl(var(--p-ink)/0.65)]">{e.open ? <b className="text-[hsl(var(--p-emerald))]">Open now</b> : formatDateTime(e.startsAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
