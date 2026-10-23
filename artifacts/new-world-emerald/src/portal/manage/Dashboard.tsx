import { useMemo, useState, type ReactNode } from "react";
import type { PortalManagement } from "@workspace/api-client-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, BarChart3, CheckCircle2, ClipboardCheck, GraduationCap, PenLine, Radio, Send, Table2 } from "lucide-react";
import { formatDateTime } from "../lib";
import { overviewCounts } from "./Overview";
import { dashboardData } from "./dashboardData";

type ChartTheme = { mark: string; grid: string; tick: string };
const THEMES: Record<"light" | "dark", ChartTheme> = {
  // Mark colours validated (lightness, chroma, >= 3:1 contrast) against each card surface.
  light: { mark: "#1e8a5c", grid: "#e6e1d6", tick: "#5c6b70" },
  dark: { mark: "#3daa79", grid: "#26333b", tick: "#9aa7ab" },
};

function Stat({ icon, label, value, accent, testId }: { icon: ReactNode; label: string; value: number; accent?: boolean; testId: string }) {
  return (
    <div className="portal-card p-4" data-testid={testId}>
      <div className="flex items-center justify-between text-[hsl(var(--p-ink)/0.55)]"><p className="text-xs font-semibold">{label}</p><span className={accent && value > 0 ? "text-[hsl(var(--p-emerald))]" : ""} aria-hidden="true">{icon}</span></div>
      <p className="portal-stat-value mt-2 text-3xl">{value.toLocaleString()}</p>
    </div>
  );
}

function ChartCard({ title, subtitle, empty, chart, table, testId }: { title: string; subtitle: string; empty?: string; chart: ReactNode; table: ReactNode; testId: string }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="portal-card flex flex-col p-5" aria-label={title} data-testid={testId}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div><h2 className="text-[15px] font-semibold">{title}</h2><p className="text-xs text-[hsl(var(--p-ink)/0.55)]">{subtitle}</p></div>
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

export function Dashboard({ data, dark, onGo }: { data: PortalManagement; dark: boolean; onGo: (section: "exams" | "marking" | "students") => void }) {
  const t = THEMES[dark ? "dark" : "light"];
  const counts = overviewCounts(data);
  const d = useMemo(() => dashboardData(data), [data]);
  const axis = { tick: { fill: t.tick, fontSize: 11 }, tickLine: false, axisLine: false } as const;
  const narrow = window.innerWidth < 640;
  const animate = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const bar = { fill: t.mark, radius: [4, 4, 0, 0] as [number, number, number, number], maxBarSize: 24, isAnimationActive: animate };
  const totalSubmissions = d.days.reduce((s, x) => s + x.count, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Portal overview">
        <Stat icon={<GraduationCap size={16} />} label="Active students" value={counts.students} testId="stat-students" />
        <Stat icon={<Radio size={16} />} label="Exams open now" value={counts.openExams} accent testId="stat-open-exams" />
        <Stat icon={<PenLine size={16} />} label="Writing right now" value={counts.writing} accent testId="stat-writing" />
        <Stat icon={<ClipboardCheck size={16} />} label="Awaiting marking" value={counts.toMark} accent testId="stat-to-mark" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="portal-card p-5 lg:col-span-1" aria-label="Needs attention" data-testid="panel-attention">
          <h2 className="text-[15px] font-semibold">Needs attention</h2>
          <p className="mb-3 text-xs text-[hsl(var(--p-ink)/0.55)]">Live exams, scripts to mark and results ready to release</p>
          {d.attention.length === 0 ? (
            <p className="flex items-center gap-2 rounded-xl bg-[hsl(var(--p-emerald-soft)/0.6)] p-3 text-sm"><CheckCircle2 size={16} className="text-[hsl(var(--p-emerald))]" /> All caught up.</p>
          ) : (
            <ul className="space-y-2">
              {d.attention.slice(0, 6).map((a) => {
                const meta = { live: { icon: <Radio size={14} />, text: `${a.count} writing now`, go: "exams" as const }, mark: { icon: <ClipboardCheck size={14} />, text: `${a.count} to mark`, go: "marking" as const }, release: { icon: <Send size={14} />, text: "Marked, ready to release", go: "exams" as const } }[a.kind];
                return (
                  <li key={a.kind + a.examId}>
                    <button type="button" onClick={() => onGo(meta.go)} className="flex w-full items-center gap-3 rounded-xl border border-[hsl(var(--p-line))] p-2.5 text-left transition-colors hover:border-[hsl(var(--p-emerald)/0.5)]">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[hsl(var(--p-paper-2))] text-[hsl(var(--p-emerald))]">{meta.icon}</span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{a.title}</span><span className="block text-xs text-[hsl(var(--p-ink)/0.6)]">{meta.text}</span></span>
                      <ArrowRight size={14} className="shrink-0 opacity-50" />
                    </button>
                  </li>
                );
              })}
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
            table={<table className={tableCls}><thead><tr><th>Exam</th><th>Class</th><th>Average</th><th>Marked</th></tr></thead><tbody>{d.examAverages.map((e) => <tr key={e.id}><td>{e.title}</td><td>{e.className}</td><td>{e.average}%</td><td>{e.marked}</td></tr>)}</tbody></table>}
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
          table={<table className={tableCls}><thead><tr><th>Day</th><th>Submitted</th></tr></thead><tbody>{d.days.map((x) => <tr key={x.date}><td>{x.label}</td><td>{x.count}</td></tr>)}</tbody></table>}
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
          table={<table className={tableCls}><thead><tr><th>Class</th><th>Students</th></tr></thead><tbody>{d.studentsByClass.map((c) => <tr key={c.name}><td>{c.name}</td><td>{c.students}</td></tr>)}</tbody></table>}
        />
      </div>

      <section className="portal-card p-5" aria-label="Upcoming exams" data-testid="panel-upcoming">
        <div className="mb-3 flex items-center justify-between"><div><h2 className="text-[15px] font-semibold">Upcoming and open exams</h2><p className="text-xs text-[hsl(var(--p-ink)/0.55)]">Published exams students can see</p></div><button type="button" className="portal-btn-ghost text-xs" onClick={() => onGo("exams")}>All exams <ArrowRight size={12} /></button></div>
        {d.upcoming.length === 0 ? <p className="py-4 text-sm text-[hsl(var(--p-ink)/0.55)]">No published exams are open or scheduled.</p> : (
          <ul className="divide-y divide-[hsl(var(--p-line))]">
            {d.upcoming.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2.5">
                <span className={"h-2 w-2 shrink-0 rounded-full " + (e.open ? "bg-[hsl(var(--p-emerald))]" : "bg-[hsl(var(--p-line))]")} aria-hidden="true" />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{e.title}</span><span className="block text-xs text-[hsl(var(--p-ink)/0.6)]">{e.className} / {e.subject}</span></span>
                <span className="text-right text-xs text-[hsl(var(--p-ink)/0.65)]">{e.open ? <b className="text-[hsl(var(--p-emerald))]">Open now</b> : formatDateTime(e.startsAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
