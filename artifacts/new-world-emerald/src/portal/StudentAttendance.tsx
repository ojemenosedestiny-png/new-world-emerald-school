import { useGetMyAttendance, getGetMyAttendanceQueryKey } from "@workspace/api-client-react";
import { CalendarCheck } from "lucide-react";
import { EmptyState, ErrorPanel, Skeleton } from "./ui";
import { errorMessage } from "./lib";
import { STATUS_LABELS } from "./attendance";

/** The student's own attendance for the last six months. */
export function StudentAttendance() {
  const q = useGetMyAttendance({ query: { queryKey: getGetMyAttendanceQueryKey() } });
  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-32" /><Skeleton className="h-48" /></div>;
  if (q.isError || !q.data) return <div><ErrorPanel title="Attendance could not load" message={errorMessage(q.error)} onRetry={() => q.refetch()} /></div>;
  const { totals, records } = q.data;
  if (!totals.daysRecorded) return <div><EmptyState icon={<CalendarCheck size={22} />} title="No attendance recorded yet" body="Your class register appears here once your teacher starts taking it." /></div>;
  const rate = Math.round((totals.daysPresent / totals.daysRecorded) * 100);
  const date = (d: string) => new Intl.DateTimeFormat("en-NG", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${d}T12:00:00`));
  return (
    <div className="space-y-5">
      <section className="portal-card p-5" aria-label="Attendance summary" data-testid="panel-attendance-summary">
        <div className="flex items-center gap-5">
          <div className="grid h-24 w-24 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(hsl(var(--p-emerald)) ${rate * 3.6}deg, hsl(var(--p-paper-2)) 0deg)` }} aria-hidden="true">
            <div className="grid h-[76px] w-[76px] place-items-center rounded-full bg-[hsl(var(--p-surface))]"><span className="text-2xl font-bold">{rate}%</span></div>
          </div>
          <div className="min-w-0">
            <p className="font-serif text-xl font-semibold" data-testid="text-attendance-rate">{rate}% attendance</p>
            <p className="text-sm text-[hsl(var(--p-ink)/0.6)]">Present on {totals.daysPresent} of {totals.daysRecorded} school days (last six months). Late counts as present.</p>
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-4 gap-2 text-center">
          {(["present", "late", "absent", "excused"] as const).map((s) => (
            <div key={s} className="rounded-xl py-2.5" style={{ background: `hsl(${STATUS_LABELS[s].hue} / 0.1)` }}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: `hsl(${STATUS_LABELS[s].hue})` }}>{STATUS_LABELS[s].label}</dt>
              <dd className="text-xl font-bold">{totals[s]}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-label="Recent days">
        <h2 className="mb-3 text-lg font-semibold">Recent days</h2>
        <ul className="portal-card divide-y divide-[hsl(var(--p-line))] overflow-hidden" data-testid="list-attendance">
          {records.slice(0, 40).map((r) => (
            <li key={r.date} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1 text-sm font-medium">{date(r.date)}{r.note && <span className="block truncate text-xs text-[hsl(var(--p-ink)/0.55)]">{r.note}</span>}</span>
              <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: `hsl(${STATUS_LABELS[r.status].hue} / 0.12)`, color: `hsl(${STATUS_LABELS[r.status].hue})` }}>{STATUS_LABELS[r.status].label}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
