import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAttendanceSheet, getGetAttendanceSheetQueryKey, useSaveAttendanceSheet, useGetAttendanceSummary, getGetAttendanceSummaryQueryKey,
  type AttendanceStatus, type PortalManagement,
} from "@workspace/api-client-react";
import { CalendarCheck, CheckCheck, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorPanel, Skeleton } from "../ui";
import { errorMessage } from "../lib";
import { ClassSelect } from "./ClassSelect";
import { STATUS_LABELS } from "../attendance";

const ORDER: AttendanceStatus[] = ["present", "late", "absent", "excused"];

/** Today's date in the browser (the school's local date for staff in Nigeria), as YYYY-MM-DD. */
export function localDate(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function Register({ classId, date }: { classId: number; date: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const sheet = useGetAttendanceSheet({ classId, date }, { query: { queryKey: getGetAttendanceSheetQueryKey({ classId, date }) } });
  const save = useSaveAttendanceSheet();
  const [marks, setMarks] = useState<Record<number, { status: AttendanceStatus | null; note: string }>>({});
  useEffect(() => {
    if (sheet.data) setMarks(Object.fromEntries(sheet.data.students.map((s) => [s.id, { status: s.status ?? null, note: s.note }])));
  }, [sheet.data]);

  if (sheet.isLoading) return <Skeleton className="h-64" />;
  if (sheet.isError || !sheet.data) return <ErrorPanel title="The register did not load" message={errorMessage(sheet.error)} onRetry={() => sheet.refetch()} />;
  const students = sheet.data.students;
  if (!students.length) return <EmptyState icon={<CalendarCheck size={22} />} title="No students in this class" body="Enrol students first, then take the register." />;
  const unmarked = students.filter((s) => !marks[s.id]?.status).length;
  const counts = ORDER.map((st) => [st, students.filter((s) => marks[s.id]?.status === st).length] as const);
  const set = (id: number, patch: Partial<{ status: AttendanceStatus | null; note: string }>) => setMarks((m) => ({ ...m, [id]: { status: m[id]?.status ?? null, note: m[id]?.note ?? "", ...patch } }));
  const submit = async () => {
    const records = students.filter((s) => marks[s.id]?.status).map((s) => ({ studentId: s.id, status: marks[s.id].status!, note: marks[s.id].note.trim() }));
    try {
      const saved = await save.mutateAsync({ data: { classId, date, records } });
      queryClient.setQueryData(getGetAttendanceSheetQueryKey({ classId, date }), saved);
      toast({ title: "Register saved", description: `${records.length} of ${students.length} students recorded.` });
    } catch (e) { toast({ variant: "destructive", title: "Register not saved", description: errorMessage(e) }); }
  };

  return (
    <div className="space-y-3">
      <div className="portal-card flex flex-wrap items-center gap-3 p-4">
        <span className={"rounded-full px-2.5 py-1 text-xs font-bold " + (sheet.data.taken ? "bg-[hsl(var(--p-emerald-soft))] text-[hsl(var(--p-emerald))]" : "bg-[hsl(var(--p-gold-soft))] text-[hsl(var(--p-gold-ink))]")} data-testid="text-register-state">
          {sheet.data.taken ? "Register taken" : "Not taken yet"}
        </span>
        <span className="text-xs text-[hsl(var(--p-ink)/0.6)]">{counts.map(([st, n]) => `${STATUS_LABELS[st].label} ${n}`).join(" · ")}{unmarked ? ` · Not marked ${unmarked}` : ""}</span>
        <button className="portal-btn-ghost ml-auto" onClick={() => setMarks((m) => Object.fromEntries(students.map((s) => [s.id, { status: m[s.id]?.status ?? "present", note: m[s.id]?.note ?? "" }])))} data-testid="button-mark-all-present"><CheckCheck size={15} /> Mark the rest present</button>
        <button className="portal-btn" disabled={save.isPending || unmarked === students.length} onClick={() => void submit()} data-testid="button-save-register"><Save size={15} /> {save.isPending ? "Saving..." : "Save register"}</button>
      </div>
      <ul className="portal-card divide-y divide-[hsl(var(--p-line))] overflow-hidden" data-testid="list-register">
        {students.map((s) => (
          <li key={s.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center" data-testid={`register-row-${s.id}`}>
            <div className="min-w-0 flex-1"><p className="truncate font-semibold">{s.name}</p><p className="font-mono text-xs text-[hsl(var(--p-ink)/0.55)]">{s.studentId}</p></div>
            <div className="flex gap-1.5" role="radiogroup" aria-label={`Attendance for ${s.name}`}>
              {ORDER.map((st) => {
                const on = marks[s.id]?.status === st;
                return (
                  <button key={st} type="button" role="radio" aria-checked={on} aria-label={STATUS_LABELS[st].label} title={STATUS_LABELS[st].label}
                    onClick={() => set(s.id, { status: st })}
                    className="grid h-10 w-10 place-items-center rounded-xl border text-sm font-bold transition-colors"
                    style={on ? { background: `hsl(${STATUS_LABELS[st].hue})`, borderColor: `hsl(${STATUS_LABELS[st].hue})`, color: "white" } : { borderColor: "hsl(var(--p-line))" }}
                    data-testid={`status-${s.id}-${st}`}>{STATUS_LABELS[st].short}</button>
                );
              })}
            </div>
            {(marks[s.id]?.status === "absent" || marks[s.id]?.status === "excused" || marks[s.id]?.status === "late") && (
              <input className="portal-input !py-2 text-sm sm:w-48" placeholder="Note (optional)" maxLength={200} value={marks[s.id]?.note ?? ""} onChange={(e) => set(s.id, { note: e.target.value })} data-testid={`note-${s.id}`} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Summary({ classId }: { classId: number }) {
  const today = localDate();
  const [from, setFrom] = useState(localDate(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(today);
  const valid = Boolean(from && to && from <= to);
  const summary = useGetAttendanceSummary({ classId, from, to }, { query: { queryKey: getGetAttendanceSummaryQueryKey({ classId, from, to }), enabled: valid } });
  return (
    <div className="space-y-3">
      <div className="portal-card flex flex-wrap items-center gap-3 p-4">
        <label className="flex items-center gap-2 text-sm">From<input type="date" className="portal-input !w-auto !py-1.5" value={from} max={today} onChange={(e) => setFrom(e.target.value)} data-testid="input-summary-from" /></label>
        <label className="flex items-center gap-2 text-sm">to<input type="date" className="portal-input !w-auto !py-1.5" value={to} max={today} onChange={(e) => setTo(e.target.value)} data-testid="input-summary-to" /></label>
        {summary.data && <span className="text-sm font-semibold" data-testid="text-days-open">{summary.data.daysOpen} register {summary.data.daysOpen === 1 ? "day" : "days"}</span>}
      </div>
      {!valid ? <p className="text-sm text-[hsl(var(--p-red))]">Choose a start date before the end date.</p>
        : summary.isLoading ? <Skeleton className="h-48" />
        : summary.isError || !summary.data ? <ErrorPanel title="The summary did not load" message={errorMessage(summary.error)} onRetry={() => summary.refetch()} />
        : (
          <div className="portal-card overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm" data-testid="table-attendance-summary">
              <caption className="sr-only">Attendance from {from} to {to}</caption>
              <thead><tr className="border-b border-[hsl(var(--p-line))] text-left text-xs uppercase tracking-wide text-[hsl(var(--p-ink)/0.6)]">
                <th scope="col" className="p-3">Student</th>{ORDER.map((st) => <th key={st} scope="col" className="p-3 text-right">{STATUS_LABELS[st].label}</th>)}<th scope="col" className="p-3 text-right">Attendance</th>
              </tr></thead>
              <tbody>
                {summary.data.students.map((s) => {
                  const rate = summary.data!.daysOpen ? Math.round((s.daysPresent / summary.data!.daysOpen) * 100) : null;
                  return (
                    <tr key={s.id} className="border-b border-[hsl(var(--p-line))] last:border-0">
                      <th scope="row" className="p-3 text-left font-semibold">{s.name}</th>
                      <td className="p-3 text-right tabular-nums">{s.present}</td><td className="p-3 text-right tabular-nums">{s.late}</td>
                      <td className="p-3 text-right tabular-nums">{s.absent}</td><td className="p-3 text-right tabular-nums">{s.excused}</td>
                      <td className={"p-3 text-right font-bold tabular-nums " + (rate !== null && rate < 80 ? "text-[hsl(var(--p-red))]" : "")}>{rate === null ? "-" : `${rate}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

/** Daily class register and attendance totals (administrators and class teachers). */
export function AttendancePanel({ data }: { data: PortalManagement }) {
  const [classId, setClassId] = useState<number>(data.classes[0]?.id ?? 0);
  const [date, setDate] = useState(localDate());
  const [view, setView] = useState<"register" | "summary">("register");
  if (!data.classes.length) return <EmptyState icon={<CalendarCheck size={22} />} title="No classes yet" body="Create a class and enrol students to take attendance." />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-semibold">Class<div className="mt-1.5 w-56"><ClassSelect id="att-class" classes={data.classes} value={classId} onChange={setClassId} /></div></label>
        {view === "register" && <label className="text-sm font-semibold">Date<input type="date" className="portal-input mt-1.5 !w-auto" value={date} max={localDate()} onChange={(e) => e.target.value && setDate(e.target.value)} data-testid="input-register-date" /></label>}
        <div className="ml-auto inline-flex rounded-xl border border-[hsl(var(--p-line))] p-1 text-sm" role="group" aria-label="View">
          {(["register", "summary"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={"rounded-lg px-3 py-1.5 font-semibold " + (view === v ? "bg-[hsl(var(--p-emerald))] text-white" : "")} data-testid={`button-view-${v}`}>{v === "register" ? "Register" : "Summary"}</button>
          ))}
        </div>
      </div>
      {view === "register" ? <Register key={`${classId}-${date}`} classId={classId} date={date} /> : <Summary key={classId} classId={classId} />}
    </div>
  );
}
