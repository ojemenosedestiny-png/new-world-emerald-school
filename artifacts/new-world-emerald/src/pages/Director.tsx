import { type ReactNode } from "react";
import { Link } from "wouter";
import { useAuth, useClerk } from "@clerk/react";
import { ApiError, useGetDirectorOverview, getGetDirectorOverviewQueryKey, useSendDirectorReport, type DirectorReport } from "@workspace/api-client-react";
import {
  AlertTriangle, CalendarCheck, ClipboardList, Crown, Globe, GraduationCap, Mail, MessagesSquare, Printer, RefreshCw, ShieldAlert, Users, Wallet,
  type LucideIcon,
} from "lucide-react";
import "@/portal/portal.css";
import { useToast } from "@/hooks/use-toast";
import { BackToWebsite, ErrorPanel, Skeleton } from "@/portal/ui";
import { errorMessage, usePortalMeta } from "@/portal/lib";
import { usePortalTheme } from "@/portal/shell/theme";
import { IdleSignOut } from "@/components/IdleSignOut";

const naira = (kobo: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(kobo / 100);
const day = (iso: string) => new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

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

function Stat({ icon: Icon, label, value, detail, tone = "emerald" }: { icon: LucideIcon; label: string; value: string; detail: string; tone?: "emerald" | "gold" | "red" }) {
  const color = tone === "red" ? "var(--p-red)" : tone === "gold" ? "var(--p-gold-ink)" : "var(--p-emerald)";
  return (
    <div className="portal-card p-4" data-testid={`stat-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--p-ink)/0.55)]"><Icon size={14} style={{ color: `hsl(${color})` }} /> {label}</p>
      <p className="mt-2 font-serif text-3xl font-bold tabular-nums" style={{ color: `hsl(${color})` }}>{value}</p>
      <p className="mt-1 text-xs text-[hsl(var(--p-ink)/0.6)]">{detail}</p>
    </div>
  );
}

/** The Director's view of the school week. */
export function DirectorDashboard({ r }: { r: DirectorReport }) {
  const att = r.attendance;
  return (
    <div className="space-y-5">
      {r.highlights.length > 0 && (
        <section className="portal-card border-l-4 border-l-[hsl(var(--p-gold))] p-5" aria-label="Needs your attention" data-testid="panel-highlights">
          <h2 className="flex items-center gap-2 font-serif text-xl font-semibold"><AlertTriangle size={18} className="text-[hsl(var(--p-gold))]" /> Needs your attention</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">{r.highlights.map((h) => <li key={h}>{h}</li>)}</ul>
        </section>
      )}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="This week in numbers">
        <Stat icon={GraduationCap} label="Admissions" value={String(r.admissions.newThisWeek)} detail={`new this week / ${r.admissions.awaitingReview} waiting for review`} tone={r.admissions.awaitingReview ? "gold" : "emerald"} />
        <Stat icon={Users} label="Students" value={String(r.students.active)} detail={`active / ${r.students.pendingActivation} not yet activated / ${r.staff.activeTeachers} teachers`} />
        <Stat icon={CalendarCheck} label="Attendance" value={att.rate === null ? "-" : `${att.rate}%`} detail={att.rate === null ? "no registers taken" : `${att.absentToday} absent today`} tone={att.rate !== null && att.rate < 85 ? "red" : "emerald"} />
        <Stat icon={Wallet} label="Fees confirmed" value={naira(r.money.confirmedKobo)} detail={`${r.money.awaitingCount} payments (${naira(r.money.awaitingKobo)}) awaiting confirmation`} tone={r.money.awaitingCount ? "gold" : "emerald"} />
        <Stat icon={ClipboardList} label="Exams" value={String(r.learning.attemptsSubmitted)} detail={`papers submitted${r.learning.averageScore === null ? "" : ` / average ${r.learning.averageScore}%`}`} />
        <Stat icon={ClipboardList} label="Homework" value={String(r.learning.submissions)} detail={`handed in / ${r.learning.assignmentsSet} assignments set`} />
        <Stat icon={MessagesSquare} label="Messages" value={String(r.messages.thisWeek)} detail={`this week / ${r.messages.unanswered} waiting for a staff reply`} tone={r.messages.unanswered ? "gold" : "emerald"} />
        <Stat icon={Globe} label="Store and website" value={String(r.money.storeOrders)} detail={`store orders (${naira(r.money.storeOrdersKobo)}) / ${r.website.liveUpdates} live updates`} />
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="portal-card overflow-x-auto" aria-label="Attendance by class">
          <h2 className="px-4 pt-4 font-serif text-xl font-semibold">Attendance by class</h2>
          <table className="mt-2 w-full text-sm" data-testid="table-attendance-by-class">
            <thead><tr className="border-b border-[hsl(var(--p-line))] text-left text-xs uppercase tracking-wide text-[hsl(var(--p-ink)/0.6)]"><th className="p-3">Class</th><th className="p-3 text-right">Students</th><th className="p-3 text-right">Attendance</th></tr></thead>
            <tbody>
              {att.byClass.map((c) => (
                <tr key={c.className} className="border-b border-[hsl(var(--p-line))] last:border-0">
                  <th scope="row" className="p-3 text-left font-semibold">{c.className}</th>
                  <td className="p-3 text-right tabular-nums">{r.students.byClass.find((s) => s.className === c.className)?.students ?? 0}</td>
                  <td className={"p-3 text-right font-bold tabular-nums " + (c.rate !== null && c.rate < 85 ? "text-[hsl(var(--p-red))]" : "")}>{c.rate === null ? <span className="font-normal text-[hsl(var(--p-ink)/0.5)]">No register</span> : `${c.rate}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="portal-card p-4" aria-label="Security">
          <h2 className="flex items-center gap-2 font-serif text-xl font-semibold"><ShieldAlert size={18} className="text-[hsl(var(--p-emerald))]" /> Security</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-[hsl(var(--p-paper-2))] p-3"><dt className="text-xs text-[hsl(var(--p-ink)/0.6)]">Failed student sign-ins</dt><dd className="text-2xl font-bold tabular-nums">{r.security.failedSignIns}</dd></div>
            <div className="rounded-xl bg-[hsl(var(--p-paper-2))] p-3"><dt className="text-xs text-[hsl(var(--p-ink)/0.6)]">Blocked staff actions</dt><dd className="text-2xl font-bold tabular-nums">{r.security.deniedActions}</dd></div>
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-[hsl(var(--p-ink)/0.6)]">Details are in the staff portal under Sessions and the Audit log. Admission applications total {r.admissions.total}; {r.students.activatedThisWeek} student accounts were activated this week.</p>
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
  const signedIn = isLoaded && isSignedIn === true;
  const q = useGetDirectorOverview({ query: { queryKey: getGetDirectorOverviewQueryKey(), enabled: signedIn, retry: false, refetchInterval: 5 * 60_000 } });
  const send = useSendDirectorReport();

  if (!isLoaded) return <div className="portal p-10"><Skeleton className="mx-auto h-40 max-w-md" /></div>;
  if (!signedIn) return <Gate title="Director's dashboard" body="Sign in with the Director's email to see the week across the school."><Link href="/sign-in?returnTo=director" className="portal-btn w-full" data-testid="link-director-signin">Sign in with email</Link></Gate>;
  if (q.isLoading) return <div className="portal p-10"><Skeleton className="mx-auto h-40 max-w-3xl" /></div>;
  if (q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 401)) {
    return <Gate title="For the Director only" body="This page is reserved for the school Director. If you are the Director, sign in with the email the school registered for you."><button className="portal-btn-ghost w-full justify-center" onClick={() => void signOut({ redirectUrl: import.meta.env.BASE_URL + "director" })} data-testid="button-director-switch">Use another account</button></Gate>;
  }
  if (q.isError || !q.data) return <div className="portal grid place-items-center px-4"><div className="max-w-md"><ErrorPanel title="The dashboard did not load" message={errorMessage(q.error)} onRetry={() => q.refetch()} /></div></div>;

  const emailMe = async () => {
    try { toast({ title: "Report sent", description: (await send.mutateAsync()).message }); }
    catch (e) { toast({ variant: "destructive", title: "Not sent", description: errorMessage(e) }); }
  };
  return (
    <div className="portal min-h-screen pb-12">
      <IdleSignOut enabled onSignOut={() => void signOut({ redirectUrl: import.meta.env.BASE_URL + "director" })} />
      <header className="portal-hero px-5 pb-8 pt-6 lg:px-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end gap-4">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-[hsl(var(--p-gold))]"><Crown size={14} /> Director's dashboard</p>
            <h1 className="mt-2 font-serif text-3xl font-semibold text-white md:text-4xl">The week at New World Emerald</h1>
            <p className="mt-1 text-sm text-white/75" data-testid="text-director-period">{day(q.data.from)} to {day(q.data.to)} / updated {new Intl.DateTimeFormat("en-NG", { hour: "numeric", minute: "2-digit" }).format(new Date(q.data.generatedAt))}</p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <button className="portal-btn-dark" onClick={() => void q.refetch()} disabled={q.isFetching} data-testid="button-director-refresh"><RefreshCw size={14} /> Refresh</button>
            <button className="portal-btn-dark" onClick={() => window.print()} data-testid="button-director-print"><Printer size={14} /> Print</button>
            <button className="portal-btn" onClick={() => void emailMe()} disabled={send.isPending} data-testid="button-director-email"><Mail size={14} /> {send.isPending ? "Sending..." : "Email me this report"}</button>
          </div>
        </div>
      </header>
      <main className="mx-auto -mt-4 max-w-6xl px-4 lg:px-10">
        <DirectorDashboard r={q.data} />
        <p className="mt-6 text-center text-xs text-[hsl(var(--p-ink)/0.55)] print:hidden">This report is emailed to you every Monday at 7 am. Only the Director can open this page. <Link href="/admin" className="underline">Website admin</Link> / <Link href="/portal/manage" className="underline">Staff portal</Link></p>
      </main>
    </div>
  );
}
