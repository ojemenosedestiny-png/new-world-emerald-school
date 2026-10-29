import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useAuth, useClerk } from "@clerk/react";
import { ApiError, useGetDirectorOverview, getGetDirectorOverviewQueryKey, useSendDirectorReport, type DirectorReport } from "@workspace/api-client-react";
import { ArrowRight, Crown, Mail, Printer, RefreshCw } from "lucide-react";
import "@/portal/portal.css";
import { useToast } from "@/hooks/use-toast";
import { BackToWebsite, ErrorPanel, Skeleton } from "@/portal/ui";
import { errorMessage, usePortalMeta } from "@/portal/lib";
import { usePortalTheme } from "@/portal/shell/theme";
import { IdleSignOut } from "@/components/IdleSignOut";
import { asset } from "@/lib/asset";
import { ResultsReview } from "@/portal/reports/ResultsReview";
import { StaffEmail } from "@/portal/director/StaffEmail";

const naira = (kobo: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(kobo / 100);
const day = (iso: string) => new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
const MUTED = "text-[hsl(var(--p-ink)/0.6)]";
const LOW = 85;

/** Where each kind of highlight is dealt with. */
function actionFor(h: string): { label: string; href: string } {
  if (/admission/i.test(h)) return { label: "Review admissions", href: "/admin" };
  if (/fee|payment/i.test(h)) return { label: "Open payments", href: "/admin" };
  if (/register|attendance/i.test(h)) return { label: "See attendance", href: "/portal/manage" };
  if (/conversation|message/i.test(h)) return { label: "Open messages", href: "/portal/manage" };
  if (/account/i.test(h)) return { label: "See students", href: "/portal/manage" };
  if (/sign-in/i.test(h)) return { label: "Open sessions", href: "/portal/manage" };
  return { label: "Open", href: "/portal/manage" };
}

function Gate({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="portal grid place-items-center px-4">
      <div className="portal-card portal-rise w-full max-w-md p-8 text-center">
        <Crown className="mx-auto text-[hsl(var(--p-gold))]" size={34} />
        <h1 className="mt-4 font-serif text-3xl font-semibold" data-testid="text-director-gate">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-[hsl(var(--p-ink)/0.65)]">{body}</p>
        <div className="mt-6 space-y-3">{children}</div>
        <div className="mt-6 flex justify-center"><BackToWebsite /></div>
      </div>
    </div>
  );
}

function Figure({ label, value, note, tone, testId }: { label: string; value: string; note: string; tone?: "good" | "warn" | "bad"; testId: string }) {
  const color = tone === "bad" ? "text-[hsl(var(--p-red))]" : tone === "warn" ? "text-[hsl(var(--p-gold-ink))]" : "";
  return (
    <div className="px-5 py-4" data-testid={testId}>
      <p className={"text-xs font-medium " + MUTED}>{label}</p>
      <p className={"mt-1 text-[28px] font-semibold leading-none tabular-nums " + color}>{value}</p>
      <p className={"mt-1.5 text-xs " + MUTED}>{note}</p>
    </div>
  );
}

/** Attendance by class as a sortable bar list; the one data hue is emerald, classes under 85% turn red. */
function AttendanceByClass({ r }: { r: DirectorReport }) {
  const [sort, setSort] = useState<"name" | "low">("low");
  const rows = r.attendance.byClass.map((c) => ({ ...c, students: r.students.byClass.find((s) => s.className === c.className)?.students ?? 0 }));
  const sorted = [...rows].sort((a, b) => sort === "name" ? a.className.localeCompare(b.className) : (a.rate ?? -1) - (b.rate ?? -1));
  return (
    <section className="portal-card p-5" aria-labelledby="att-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 id="att-title" className="text-[15px] font-semibold">Attendance by class</h2><p className={"text-xs " + MUTED}>Present or late, of register entries. Under {LOW}% is shown in red.</p></div>
        <div className="inline-flex rounded-lg border border-[hsl(var(--p-line))] p-0.5 text-xs print:hidden" role="group" aria-label="Sort classes">
          {([["low", "Lowest first"], ["name", "By class"]] as const).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)} className={"rounded-md px-2.5 py-1 font-semibold " + (sort === k ? "bg-[hsl(var(--p-paper-2))]" : MUTED)} data-testid={`sort-attendance-${k}`}>{label}</button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? <p className={"py-8 text-center text-sm " + MUTED}>No classes yet.</p> : (
        <ul className="mt-3" data-testid="table-attendance-by-class">
          {sorted.map((c) => {
            const low = c.rate !== null && c.rate < LOW;
            return (
              <li key={c.className} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_5.5rem] items-center gap-3 py-2" data-testid="row-attendance-class">
                <span className="min-w-0"><span className="block truncate text-sm font-semibold">{c.className}</span><span className={"block text-xs " + MUTED}>{c.students} {c.students === 1 ? "student" : "students"}</span></span>
                <span className="h-2.5 overflow-hidden rounded-full bg-[hsl(var(--p-paper-2))]" aria-hidden="true">
                  {c.rate !== null && <span className={"block h-full rounded-full " + (low ? "bg-[hsl(var(--p-red))]" : "bg-[hsl(var(--p-emerald))]")} style={{ width: `${c.rate}%` }} />}
                </span>
                <span className={"text-right text-sm font-semibold tabular-nums " + (low ? "text-[hsl(var(--p-red))]" : "")}>{c.rate === null ? <span className={"whitespace-nowrap font-normal " + MUTED} title="No register taken">No register</span> : `${c.rate}%`}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The Director's view of the school: what needs attention, the figures, fees and attendance. */
export function DirectorDashboard({ r }: { r: DirectorReport }) {
  const att = r.attendance;
  const m = r.money;
  const confirmedShare = m.confirmedKobo + m.awaitingKobo > 0 ? (m.confirmedKobo / (m.confirmedKobo + m.awaitingKobo)) * 100 : 0;
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-3">
        <section className="portal-card p-5 lg:col-span-2" aria-labelledby="attention-title" data-testid="panel-highlights">
          <h2 id="attention-title" className="text-[15px] font-semibold">Needs your attention</h2>
          {r.highlights.length === 0 ? <p className={"mt-3 text-sm " + MUTED}>Nothing needs your attention. The school is running smoothly.</p> : (
            <ul className="mt-2 divide-y divide-[hsl(var(--p-line))]">
              {r.highlights.map((h) => {
                const a = actionFor(h);
                return (
                  <li key={h} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--p-gold))]" aria-hidden="true" />
                    <span className="min-w-0 flex-1 basis-[calc(100%-1.5rem)] text-sm leading-relaxed sm:basis-auto">{h}</span>
                    <Link href={a.href} className="portal-btn-ghost ml-6 shrink-0 !px-2.5 !py-1 text-xs sm:ml-0 print:hidden">{a.label} <ArrowRight size={12} /></Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="portal-card p-5" aria-labelledby="fees-title" data-testid="stat-fees-confirmed">
          <h2 id="fees-title" className="text-[15px] font-semibold">Fees</h2>
          <p className={"mt-3 text-xs font-medium " + MUTED}>Confirmed {r.days === 7 ? "this week" : `in ${r.days} days`}</p>
          <p className="mt-1 text-[28px] font-semibold leading-none tabular-nums">{naira(m.confirmedKobo)}</p>
          <p className={"mt-1.5 text-xs " + MUTED}>{m.confirmedCount} {m.confirmedCount === 1 ? "payment" : "payments"}</p>
          <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-[hsl(var(--p-paper-2))]" role="img" aria-label={`${naira(m.confirmedKobo)} confirmed, ${naira(m.awaitingKobo)} awaiting confirmation`}>
            <span className="bg-[hsl(var(--p-emerald))]" style={{ width: `${confirmedShare}%` }} />
            {m.awaitingKobo > 0 && <span className="bg-[hsl(var(--p-gold))]" style={{ width: `${100 - confirmedShare}%` }} />}
          </div>
          <dl className="mt-3 space-y-1.5 text-sm">
            <div className="flex justify-between gap-3"><dt className={MUTED}>Awaiting confirmation</dt><dd className={"font-semibold tabular-nums " + (m.awaitingCount ? "text-[hsl(var(--p-gold-ink))]" : "")}>{naira(m.awaitingKobo)} ({m.awaitingCount})</dd></div>
            <div className="flex justify-between gap-3"><dt className={MUTED}>Store orders</dt><dd className="font-semibold tabular-nums">{naira(m.storeOrdersKobo)} ({m.storeOrders})</dd></div>
          </dl>
        </section>
      </div>

      <section className="portal-card grid grid-cols-2 divide-[hsl(var(--p-line))] lg:grid-cols-5 lg:divide-x" aria-label="The period in numbers">
        <Figure label="New applications" value={String(r.admissions.newThisWeek)} note={`${r.admissions.awaitingReview} waiting for review`} tone={r.admissions.awaitingReview ? "warn" : undefined} testId="stat-admissions" />
        <Figure label="Students" value={String(r.students.active)} note={`${r.students.pendingActivation} not yet activated / ${r.staff.activeTeachers} teachers`} testId="stat-students" />
        <Figure label="Attendance" value={att.rate === null ? "-" : `${att.rate}%`} note={att.rate === null ? "No registers taken" : `${att.absentToday} absent today`} tone={att.rate !== null && att.rate < LOW ? "bad" : undefined} testId="stat-attendance" />
        <Figure label="Exam papers" value={String(r.learning.attemptsSubmitted)} note={r.learning.averageScore === null ? "No marked papers yet" : `Average ${r.learning.averageScore}%`} testId="stat-exams" />
        <Figure label="Messages" value={String(r.messages.thisWeek)} note={`${r.messages.unanswered} waiting for a staff reply`} tone={r.messages.unanswered ? "warn" : undefined} testId="stat-messages" />
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2"><AttendanceByClass r={r} /></div>
        <section className="portal-card p-5" aria-labelledby="more-title">
          <h2 id="more-title" className="text-[15px] font-semibold">Learning and safety</h2>
          <dl className="mt-3 divide-y divide-[hsl(var(--p-line))] text-sm">
            {[
              ["Homework handed in", String(r.learning.submissions)],
              ["Assignments set", String(r.learning.assignmentsSet)],
              ["Exams held", String(r.learning.examsHeld)],
              ["Live updates posted", String(r.website.liveUpdates)],
              ["Accounts activated", String(r.students.activatedThisWeek)],
              ["Failed student sign-ins", String(r.security.failedSignIns)],
              ["Blocked staff actions", String(r.security.deniedActions)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 py-2"><dt className={MUTED}>{k}</dt><dd className="text-right font-semibold tabular-nums">{v}</dd></div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}

export default function Director() {
  usePortalMeta("Director dashboard");
  usePortalTheme();
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const { toast } = useToast();
  const [days, setDays] = useState<7 | 30>(7);
  const [view, setView] = useState<"overview" | "results" | "email">("overview");
  const signedIn = isLoaded && isSignedIn === true;
  const q = useGetDirectorOverview({ days }, { query: { queryKey: getGetDirectorOverviewQueryKey({ days }), enabled: signedIn, retry: false, refetchInterval: 5 * 60_000 } });
  const send = useSendDirectorReport();

  if (!isLoaded) return <div className="portal p-10"><Skeleton className="mx-auto h-40 max-w-md" /></div>;
  if (!signedIn) return <Gate title="Director's dashboard" body="Sign in with the Director's email to see the week across the school."><Link href="/sign-in?returnTo=director" className="portal-btn w-full" data-testid="link-director-signin">Sign in with email</Link></Gate>;
  if (q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 401)) {
    return <Gate title="For the Director only" body="This page is reserved for the school Director. If you are the Director, sign in with the email the school registered for you."><button className="portal-btn-ghost w-full justify-center" onClick={() => void signOut({ redirectUrl: import.meta.env.BASE_URL + "director" })} data-testid="button-director-switch">Use another account</button></Gate>;
  }
  if (q.isError) return <div className="portal grid place-items-center px-4"><div className="max-w-md"><ErrorPanel title="The dashboard did not load" message={errorMessage(q.error)} onRetry={() => q.refetch()} /></div></div>;

  const emailMe = async () => {
    try { toast({ title: "Report sent", description: (await send.mutateAsync()).message }); }
    catch (e) { toast({ variant: "destructive", title: "Not sent", description: errorMessage(e) }); }
  };
  const r = q.data;
  return (
    <div className="portal min-h-screen pb-12">
      <IdleSignOut enabled onSignOut={() => void signOut({ redirectUrl: import.meta.env.BASE_URL + "director" })} />
      <header className="border-b border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface))]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 lg:px-8">
          <img src={asset("/logo.jpg")} alt="" className="h-9 w-9 rounded-md object-contain" />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="font-serif text-lg font-semibold">New World Emerald</p>
            <p className={"text-xs " + MUTED}>Director</p>
          </div>
          <div className="inline-flex rounded-lg border border-[hsl(var(--p-line))] p-0.5 text-sm print:hidden" role="group" aria-label="View">
            {([["overview", "Overview"], ["results", "Results"], ["email", "Email staff"]] as const).map(([v, label]) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={"rounded-md px-3 py-1.5 font-semibold " + (view === v ? "bg-[hsl(var(--p-ink))] text-[hsl(var(--p-paper))]" : MUTED)} data-testid={`view-${v}`}>{label}</button>
            ))}
          </div>
          {view === "overview" && (
            <div className="inline-flex rounded-lg border border-[hsl(var(--p-line))] p-0.5 text-sm print:hidden" role="group" aria-label="Period">
              {([[7, "This week"], [30, "Last 30 days"]] as const).map(([n, label]) => (
                <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)} className={"rounded-md px-3 py-1.5 font-semibold " + (days === n ? "bg-[hsl(var(--p-paper-2))]" : MUTED)} data-testid={`period-${n}`}>{label}</button>
              ))}
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-5 px-4 pt-6 lg:px-8">
        {view === "email" ? <StaffEmail /> : view === "results" ? (<>
          <div>
            <h1 className="font-serif text-[28px] font-semibold leading-tight">Results</h1>
            <p className={"mt-1 text-sm " + MUTED}>Review each class's totals, positions and every student's result before it reaches students. You can approve and publish here.</p>
          </div>
          <ResultsReview />
        </>) : (<>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-[28px] font-semibold leading-tight">{days === 7 ? "The school this week" : "The last 30 days"}</h1>
            <p className={"mt-1 text-sm " + MUTED} data-testid="text-director-period">
              {r ? <>{day(r.from)} to {day(r.to)} / updated {new Intl.DateTimeFormat("en-NG", { hour: "numeric", minute: "2-digit" }).format(new Date(r.generatedAt))}</> : "Loading..."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <button className="portal-btn-ghost" onClick={() => void q.refetch()} disabled={q.isFetching} data-testid="button-director-refresh"><RefreshCw size={14} className={q.isFetching ? "animate-spin motion-reduce:animate-none" : ""} /> Refresh</button>
            <button className="portal-btn-ghost" onClick={() => window.print()} data-testid="button-director-print"><Printer size={14} /> Print</button>
            <button className="portal-btn" onClick={() => void emailMe()} disabled={send.isPending} data-testid="button-director-email"><Mail size={14} /> {send.isPending ? "Sending..." : "Email me this report"}</button>
          </div>
        </div>
        {!r ? <div className="space-y-4"><Skeleton className="h-44" /><Skeleton className="h-28" /><Skeleton className="h-56" /></div> : <DirectorDashboard r={r} />}
        </>)}
        <p className={"text-center text-xs print:hidden " + MUTED}>The weekly report is emailed to you every Monday at 7 am. Only the Director can open this page. <Link href="/admin" className="underline">Website admin</Link> / <Link href="/portal/manage" className="underline">Staff portal</Link></p>
      </main>
    </div>
  );
}
