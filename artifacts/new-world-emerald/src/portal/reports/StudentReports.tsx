import { useState } from "react";
import { useGetStudentReports, getGetStudentReportsQueryKey, type StudentReports as StudentReportsData, type StudentTermReport } from "@workspace/api-client-react";
import { ChevronDown, FileBarChart, Printer } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorPanel, Skeleton } from "../ui";
import { errorMessage } from "../lib";
import { ordinal, printReportCards, termLabel } from "./reportCard";

function TermReport({ data, report, open, onToggle }: { data: StudentReportsData; report: StudentTermReport; open: boolean; onToggle: () => void }) {
  const { toast } = useToast();
  const names = new Map(report.subjects.map((s) => [s.id, s.name]));
  const stats = new Map(report.subjectStats.map((s) => [s.subjectId, s]));
  const r = report.result;
  const print = () => {
    const ok = printReportCards([{
      studentName: data.studentName, studentId: data.studentId, className: report.className || data.className, term: report.term, subjects: report.subjects, result: r, subjectStats: report.subjectStats, classSize: report.classSize, card: report.card,
      gradingScale: report.gradingScale, teacherName: report.teacherName, teacherSignature: report.teacherSignature, principalName: report.principalName, principalSignature: report.principalSignature,
    }]);
    if (!ok) toast({ variant: "destructive", title: "Pop-up blocked", description: "Allow pop-ups for this site to print your report card." });
  };
  return (
    <article className="portal-card overflow-hidden" data-testid={"report-term-" + report.term.id}>
      <button className="flex w-full items-center gap-4 p-5 text-left" onClick={onToggle} aria-expanded={open}>
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[hsl(var(--p-emerald-soft))] text-[hsl(var(--p-emerald))]"><FileBarChart size={22} /></div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[hsl(var(--p-ink)/0.5)]">{report.term.session} session</p>
          <p className="font-serif text-xl font-semibold">{report.term.term}</p>
        </div>
        <div className="text-right">
          <p className="font-serif text-3xl font-bold text-[hsl(var(--p-emerald))]">{r.average ?? "-"}<span className="text-base text-[hsl(var(--p-ink)/0.45)]">%</span></p>
          <p className="text-xs text-[hsl(var(--p-ink)/0.6)]">{r.position ? `${ordinal(r.position)} of ${report.classSize}` : "Not ranked"}</p>
        </div>
        <ChevronDown size={18} className={"shrink-0 transition-transform " + (open ? "rotate-180" : "")} />
      </button>
      {open && (
        <div className="border-t border-[hsl(var(--p-line))] p-5">
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[["Total score", String(r.total)], ["Average", r.average === null ? "-" : r.average + "%"], ["Overall grade", r.grade ?? "-"], ["Attendance", report.card?.daysOpen != null ? `${report.card.daysPresent ?? "-"} / ${report.card.daysOpen}` : "-"]].map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-[hsl(var(--p-paper-2)/0.6)] p-3"><p className="text-xs text-[hsl(var(--p-ink)/0.6)]">{label}</p><p className="font-serif text-xl font-semibold">{value}</p></div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-2xl border border-[hsl(var(--p-line))]">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-[hsl(var(--p-ink))] text-left text-xs text-[hsl(var(--p-paper))]">
                <tr><th className="px-3 py-2">Subject</th><th className="px-2 py-2 text-center">CA</th><th className="px-2 py-2 text-center">Exam</th><th className="px-2 py-2 text-center">Total</th><th className="px-2 py-2 text-center">Grade</th><th className="px-2 py-2 text-center">Position</th><th className="px-2 py-2 text-center">Class avg</th><th className="px-3 py-2">Remark</th></tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--p-line))] bg-[hsl(var(--p-surface)/0.7)]">
                {r.subjects.map((s) => (
                  <tr key={s.subjectId}>
                    <td className="px-3 py-2 font-medium">{names.get(s.subjectId)}</td>
                    <td className="px-2 py-2 text-center tabular-nums">{s.ca ?? "-"}</td>
                    <td className="px-2 py-2 text-center tabular-nums">{s.exam ?? "-"}</td>
                    <td className="px-2 py-2 text-center font-semibold tabular-nums">{s.total}</td>
                    <td className="px-2 py-2 text-center font-bold">{s.grade}</td>
                    <td className="px-2 py-2 text-center">{ordinal(s.position)}</td>
                    <td className="px-2 py-2 text-center tabular-nums">{stats.get(s.subjectId)?.average ?? "-"}</td>
                    <td className="px-3 py-2 text-[hsl(var(--p-ink)/0.75)]">{s.remark}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(report.card?.teacherRemark || report.card?.principalRemark) && (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {report.card?.teacherRemark && <div className="rounded-2xl border-l-4 border-l-[hsl(var(--p-emerald))] bg-[hsl(var(--p-surface)/0.7)] p-4"><p className="portal-label">Class teacher</p><p className="mt-1 text-sm">{report.card.teacherRemark}</p></div>}
              {report.card?.principalRemark && <div className="rounded-2xl border-l-4 border-l-[hsl(var(--p-gold))] bg-[hsl(var(--p-surface)/0.7)] p-4"><p className="portal-label">Principal</p><p className="mt-1 text-sm">{report.card.principalRemark}</p></div>}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            {report.term.nextTermBegins ? <p className="text-sm">Next term begins: <b>{report.term.nextTermBegins}</b></p> : <span />}
            <button className="portal-btn" onClick={print} data-testid={"button-print-report-" + report.term.id}><Printer size={15} /> Print / Save as PDF</button>
          </div>
        </div>
      )}
    </article>
  );
}

export function StudentReports() {
  const q = useGetStudentReports({ query: { queryKey: getGetStudentReportsQueryKey() } });
  const [open, setOpen] = useState<number | null>(null);
  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>;
  if (q.isError || !q.data) return <ErrorPanel title="Report cards did not load" message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const data = q.data;
  if (!data.reports.length) return <EmptyState icon={<FileBarChart size={22} />} title="No report cards yet" body={`When the school releases ${data.className || "your class"}'s term results, your report card appears here to view and print.`} />;
  const current = open ?? data.reports[0].term.id;
  return <div className="space-y-3">{data.reports.map((r) => <TermReport key={r.term.id} data={data} report={r} open={current === r.term.id} onToggle={() => setOpen(current === r.term.id ? -1 : r.term.id)} />)}</div>;
}
