import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useAuth, useClerk, useUser } from "@clerk/react";
import { ApiError, getGetChairmanBoardQueryKey, useGetChairmanBoard, type ChairmanBoard, type ChairmanClass } from "@workspace/api-client-react";
import { Activity, Eye, GraduationCap, LogOut, School, Sparkles, UserRoundCheck, Users } from "lucide-react";
import "@/portal/portal.css";
import { usePortalTheme } from "@/portal/shell/theme";
import { BackToWebsite, ErrorPanel, Skeleton } from "@/portal/ui";
import { errorMessage, usePortalMeta } from "@/portal/lib";
import { IdleSignOut } from "@/components/IdleSignOut";
import { asset } from "@/lib/asset";

const MUTED = "text-[hsl(var(--p-ink)/0.62)]";
const PERIODS = [[7, "7 days"], [30, "30 days"], [90, "Term (90 days)"]] as const;
const SECTION = { secondary: "Secondary (JSS 1 to SS 3)", primary: "Primary (Year 1 to Year 6)", other: "Other classes" } as const;
const pct = (v: number | null) => (v === null ? "-" : `${v}%`);
const shortDay = (d: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(d + "T12:00:00Z"));

function Gate({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <main className="portal grid min-h-screen place-items-center px-4 py-12">
      <div className="w-full max-w-md text-center">
        <img src={asset("/logo.jpg")} alt="New World Emerald Private School" className="mx-auto h-16 w-16 object-contain" />
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--p-gold-ink))]">Chairman of the board</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--p-ink)/0.7)]">{body}</p>
        <div className="mt-7 space-y-3">{children}</div>
        <div className="mt-8"><BackToWebsite /></div>
      </div>
    </main>
  );
}

/** A thin bar for a percentage, coloured by how healthy it is (attendance expects more than results do). */
function Bar({ value, label, kind = "attendance" }: { value: number | null; label: string; kind?: "attendance" | "results" }) {
  const [good, fair] = kind === "attendance" ? [90, 75] : [70, 50];
  const tone = value === null ? "var(--p-line)" : value >= good ? "var(--p-emerald)" : value >= fair ? "var(--p-gold)" : "var(--p-red)";
  return (
    <div className="flex items-center gap-2" aria-label={`${label}: ${pct(value)}`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[hsl(var(--p-paper-2))]"><div className="h-full rounded-full" style={{ width: `${value ?? 0}%`, background: `hsl(${tone})` }} /></div>
      <span className="w-10 text-right text-xs font-semibold tabular-nums">{pct(value)}</span>
    </div>
  );
}

/** Daily attendance as columns: one per school day with a register. */
function Trend({ days }: { days: ChairmanBoard["attendanceTrend"] }) {
  if (!days.length) return <p className={"py-10 text-center text-sm " + MUTED}>No registers taken in this period yet.</p>;
  return (
    <div>
      <div className="flex h-56 items-end gap-1.5" role="img" aria-label={`Attendance by day: ${days.map((d) => `${shortDay(d.date)} ${pct(d.rate)}`).join(", ")}`}>
        {days.map((d) => (
          <div key={d.date} className="group relative flex h-full flex-1 flex-col justify-end" title={`${shortDay(d.date)}: ${pct(d.rate)} of ${d.recorded} marks`}>
            <div className="rounded-t-md bg-[hsl(var(--p-emerald))] transition-opacity group-hover:opacity-80" style={{ height: `${Math.max(4, d.rate ?? 0)}%` }} />
          </div>
        ))}
      </div>
      <div className={"mt-2 flex justify-between text-[11px] " + MUTED}><span>{shortDay(days[0].date)}</span><span>{shortDay(days[days.length - 1].date)}</span></div>
    </div>
  );
}

export default function Chairman() {
  usePortalMeta("Chairman's board");
  usePortalTheme();
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const signedIn = isLoaded && isSignedIn === true;
  const [days, setDays] = useState<number>(30);
  const params = { days };
  const q = useGetChairmanBoard(params, { query: { queryKey: [...getGetChairmanBoardQueryKey(params), user?.id ?? "anon"], enabled: signedIn, refetchInterval: 300_000, retry: (n, e) => e instanceof ApiError && e.status === 403 && n < 6, retryDelay: 5000 } });
  const leave = () => void signOut({ redirectUrl: import.meta.env.BASE_URL + "chairman" });

  if (!isLoaded) return <div className="portal p-10"><Skeleton className="mx-auto h-40 max-w-md" /></div>;
  if (!signedIn) return <Gate title="The Chairman's board" body="A clear view of the whole school: students, staff, attendance and results. Sign in with the Chairman's email."><Link href="/sign-in?returnTo=chairman" className="portal-btn w-full justify-center !py-3.5" data-testid="link-chairman-signin">Sign in with email</Link></Gate>;
  if (q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 401)) return <Gate title="For the Chairman only" body="This board is for the Chairman of the board. If that is you, sign in with the email the school registered for you."><button type="button" className="portal-btn-ghost w-full justify-center" onClick={leave} data-testid="button-chairman-switch">Use another account</button></Gate>;
  if (q.isLoading) return <div className="portal p-10"><Skeleton className="mx-auto h-[60vh] max-w-6xl" /></div>;
  if (q.isError || !q.data) return <div className="portal grid min-h-screen place-items-center px-4"><div className="w-full max-w-md"><ErrorPanel title="The board did not load" message={errorMessage(q.error)} onRetry={() => void q.refetch()} /></div></div>;
  return <><IdleSignOut enabled onSignOut={leave} /><ChairmanBoardView b={q.data} days={days} onDays={setDays} onLeave={leave} firstName={user?.firstName ?? ""} /></>;
}

/** The board itself: headline figures, primary and secondary, attendance by day, every class, learning and WAEC/NECO. */
export function ChairmanBoardView({ b, days, onDays, onLeave, firstName }: { b: ChairmanBoard; days: number; onDays: (d: number) => void; onLeave: () => void; firstName: string }) {
  const [sort, setSort] = useState<"name" | "attendance" | "results">("name");
  const setDays = onDays;
  const leave = onLeave;
  const order = (list: ChairmanClass[]) => [...list].sort((x, y) => sort === "attendance" ? (y.attendanceRate ?? -1) - (x.attendanceRate ?? -1) : sort === "results" ? (y.averageScore ?? -1) - (x.averageScore ?? -1) : x.className.localeCompare(y.className, undefined, { numeric: true }));
  const kpis: [typeof Users, string, string, string][] = [
    [Users, "Students", String(b.totals.students), `${b.totals.classes} classes`],
    [UserRoundCheck, "Teachers", String(b.totals.teachers), "active on the portal"],
    [Activity, "Attendance", pct(b.totals.attendanceRate), `${b.totals.absentToday} absent today`],
    [GraduationCap, "Average result", pct(b.totals.averageScore), "released exams and tests"],
  ];

  return (
    <main className="portal min-h-screen pb-16">
      <header className="portal-hero px-4 pb-24 pt-6 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
          <img src={asset("/logo.jpg")} alt="" className="h-11 w-11 rounded-full bg-white object-contain p-0.5" />
          <div className="min-w-0 flex-1"><p className="font-serif text-lg font-semibold leading-tight">New World Emerald Private School</p><p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--p-gold))]">Chairman's board</p></div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 px-3 py-1 text-xs text-white/85" data-testid="text-view-only"><Eye size={13} aria-hidden="true" /> View only</span>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-white/80 hover:bg-white/10" onClick={leave}><LogOut size={13} aria-hidden="true" /> Sign out</button>
        </div>
        <div className="mx-auto mt-10 flex max-w-6xl flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-white/75">Good day{firstName ? `, ${firstName}` : ""}.</p>
            <h1 className="mt-1 max-w-2xl font-serif text-4xl font-semibold leading-tight sm:text-5xl">The school at a glance</h1>
            <p className="mt-2 text-sm text-white/70">Updated {new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }).format(new Date(b.generatedAt))}</p>
          </div>
          <div className="flex gap-1 rounded-full border border-white/20 bg-white/[0.06] p-1" role="group" aria-label="Period">
            {PERIODS.map(([d, label]) => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={"rounded-full px-3.5 py-1.5 text-sm " + (days === d ? "bg-[hsl(var(--p-gold))] font-semibold text-[hsl(var(--p-ink))]" : "text-white/85 hover:bg-white/10")} data-testid={`button-period-${d}`}>{label}</button>)}
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto -mt-16 max-w-6xl space-y-6 px-4 sm:px-8">
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Headline figures">
          {kpis.map(([Icon, label, value, sub]) => (
            <div key={label} className="portal-card !bg-[hsl(var(--p-surface))] p-5 shadow-lg" data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}>
              <p className={"flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] " + MUTED}><Icon size={14} aria-hidden="true" className="text-[hsl(var(--p-emerald))]" /> {label}</p>
              <p className="mt-2 font-serif text-4xl font-semibold tabular-nums">{value}</p>
              <p className={"mt-1 text-xs " + MUTED}>{sub}</p>
            </div>
          ))}
        </section>

        {b.highlights.length > 0 && (
          <section className="portal-card border-l-4 border-l-[hsl(var(--p-gold))] p-5" aria-labelledby="hl-title">
            <h2 id="hl-title" className="flex items-center gap-2 font-serif text-xl font-semibold"><Sparkles size={17} aria-hidden="true" className="text-[hsl(var(--p-gold-ink))]" /> What stands out</h2>
            <ul className="mt-2 grid gap-1.5 text-sm sm:grid-cols-2">{b.highlights.map((h) => <li key={h} className="flex gap-2"><span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--p-gold))]" />{h}</li>)}</ul>
          </section>
        )}

        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-start">
          <section className="portal-card p-5 sm:p-6" aria-labelledby="trend-title">
            <div className="flex items-baseline justify-between gap-2"><h2 id="trend-title" className="font-serif text-xl font-semibold">Attendance by day</h2><span className={"text-sm " + MUTED}>{pct(b.totals.attendanceRate)} overall</span></div>
            <div className="mt-4"><Trend days={b.attendanceTrend} /></div>
          </section>
          <section className="portal-card space-y-4 p-5 sm:p-6" aria-labelledby="sections-title">
            <h2 id="sections-title" className="font-serif text-xl font-semibold">Primary and secondary</h2>
            {b.sections.map((s) => (
              <div key={s.section} className="rounded-xl border border-[hsl(var(--p-line))] p-4" data-testid={`section-${s.section}`}>
                <div className="flex items-baseline justify-between gap-2"><p className="font-semibold">{SECTION[s.section]}</p><p className="font-serif text-2xl font-semibold tabular-nums">{s.students}</p></div>
                <p className={"text-xs " + MUTED}>{s.classes} {s.classes === 1 ? "class" : "classes"}</p>
                <div className="mt-3 space-y-1.5 text-xs"><p className={MUTED}>Attendance</p><Bar value={s.attendanceRate} label="Attendance" /><p className={MUTED}>Average result</p><Bar value={s.averageScore} label="Average result" kind="results" /></div>
              </div>
            ))}
          </section>
        </div>

        <section className="portal-card !p-0" aria-labelledby="classes-title">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5 sm:px-6">
            <h2 id="classes-title" className="flex items-center gap-2 font-serif text-xl font-semibold"><School size={18} aria-hidden="true" /> Every class</h2>
            <label className="text-sm">Sort by <select className="portal-input !inline-block !w-auto !py-1.5" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} data-testid="select-class-sort"><option value="name">Class</option><option value="attendance">Attendance</option><option value="results">Results</option></select></label>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm" data-testid="table-chairman-classes">
              <thead className={"text-left text-xs uppercase tracking-wider " + MUTED}><tr><th className="px-5 py-2.5 sm:px-6">Class</th><th className="px-3 py-2.5 text-right">Students</th><th className="w-[28%] px-3 py-2.5">Attendance</th><th className="w-[28%] px-5 py-2.5 sm:px-6">Average result</th></tr></thead>
              <tbody>{order(b.classes).map((c) => (
                <tr key={c.className} className="border-t border-[hsl(var(--p-line))]">
                  <td className="px-5 py-3 sm:px-6"><b>{c.className}</b><span className={"block text-xs " + MUTED}>{SECTION[c.section].split(" (")[0]}</span></td>
                  <td className="px-3 py-3 text-right tabular-nums">{c.students}</td>
                  <td className="px-3 py-3"><Bar value={c.attendanceRate} label={`${c.className} attendance`} /></td>
                  <td className="px-5 py-3 sm:px-6"><Bar value={c.averageScore} label={`${c.className} average result`} kind="results" />{c.results > 0 && <span className={"text-[11px] " + MUTED}>{c.results} papers</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>

        <div className="grid gap-6 md:grid-cols-3">
          {([["Learning", b.learning], ["Admissions and accounts", b.admissions]] as const).map(([title, rows]) => (
            <section key={title} className="portal-card p-5" aria-label={title}>
              <h2 className="font-serif text-lg font-semibold">{title}</h2>
              <dl className="mt-3 space-y-2">{rows.map((r) => <div key={r.label} className="flex items-baseline justify-between gap-3 border-b border-[hsl(var(--p-line))] pb-2 text-sm last:border-0"><dt className={MUTED}>{r.label}</dt><dd className="font-serif text-xl font-semibold tabular-nums">{r.value}</dd></div>)}</dl>
            </section>
          ))}
          <section className="portal-card p-5" aria-labelledby="waec-title" data-testid="card-chairman-waec">
            <h2 id="waec-title" className="font-serif text-lg font-semibold">WAEC and NECO</h2>
            {b.waec ? <>
              <p className={"text-xs " + MUTED}>{b.waec.academicYear} · registration {b.waec.open ? "open" : "closed"}</p>
              <p className="mt-3 font-serif text-4xl font-semibold tabular-nums">{b.waec.submitted}<span className={"text-lg " + MUTED}> / {b.waec.candidates}</span></p>
              <p className={"text-sm " + MUTED}>SS 3 candidates have submitted their forms</p>
              <div className="mt-3"><Bar value={b.waec.candidates ? Math.round((b.waec.submitted / b.waec.candidates) * 100) : null} label="Forms submitted" kind="results" /></div>
            </> : <p className={"mt-2 text-sm " + MUTED}>Registration has not been opened yet.</p>}
          </section>
        </div>
        <p className={"text-center text-xs " + MUTED}>This board is view only. Figures come from the school portal and cover the last {b.days} days unless stated.</p>
      </div>
    </main>
  );
}
