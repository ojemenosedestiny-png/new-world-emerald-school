import { useEffect, useMemo, useState } from "react";
import { useGetReportWorkspace, getGetReportWorkspaceQueryKey, type ReportTerm, type ReportWorkspace } from "@workspace/api-client-react";
import { FileBarChart, Printer } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorPanel, Field, Skeleton } from "../ui";
import { errorMessage } from "../lib";
import { ordinal, printReportCards, reportCardsHtml, termLabel } from "./reportCard";
import { printableFor } from "./RemarksBroadsheet";
import { WorkflowBar } from "./ResultWorkflow";

const STATUS = { draft: "Draft", review: "Waiting for approval", approved: "Approved", published: "Published" } as const;
const TONE = { draft: "bg-[hsl(var(--p-paper-2))]", review: "bg-[hsl(var(--p-gold-soft))] text-[hsl(var(--p-gold-ink))]", approved: "bg-[hsl(var(--p-emerald-soft))] text-[hsl(var(--p-emerald))]", published: "bg-[hsl(var(--p-emerald))] text-white" } as const;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** A class's results for one term: the figures, the ranking, subject performance, and each student's result as it will print. */
export function ResultsReviewBody({ ws, term, className }: { ws: ReportWorkspace; term: ReportTerm; className: string }) {
  const { toast } = useToast();
  const ranked = useMemo(() => ws.results.filter((r) => r.average !== null).sort((a, b) => (a.position ?? 999) - (b.position ?? 999)), [ws.results]);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => { if (!ranked.some((r) => r.studentId === selected)) setSelected(ranked[0]?.studentId ?? null); }, [ranked, selected]);
  const name = (id: number) => ws.students.find((s) => s.id === id)?.name ?? "Student";
  const code = (id: number) => ws.students.find((s) => s.id === id)?.studentId ?? "";

  if (!ranked.length) return <EmptyState icon={<FileBarChart size={22} />} title="No results yet" body={`No scores have been entered for ${className} in ${termLabel(term)}.`} />;

  const averages = ranked.map((r) => r.average!);
  const classAverage = round1(averages.reduce((a, b) => a + b, 0) / averages.length);
  // A pass is any grade above the scale's lowest band.
  const passMark = ws.gradingScale.length > 1 ? ws.gradingScale[ws.gradingScale.length - 2].min : 40;
  const passed = averages.filter((a) => a >= passMark).length;
  const grades = ws.gradingScale.map((b) => ({ grade: b.grade, count: ranked.filter((r) => r.grade === b.grade).length }));
  const most = Math.max(1, ...grades.map((g) => g.count));
  const subjectName = new Map(ws.subjects.map((s) => [s.id, s.name]));
  const html = selected ? reportCardsHtml(printableFor(ws, term, className, [selected])) : "";
  const print = (ids?: number[]) => { if (!printReportCards(printableFor(ws, term, className, ids))) toast({ variant: "destructive", title: "Pop-up blocked", description: "Allow pop-ups for this site to print results." }); };

  return (
    <div className="space-y-4" data-testid="panel-results-review">
      <section className="portal-card grid grid-cols-2 divide-[hsl(var(--p-line))] overflow-hidden md:grid-cols-5 md:divide-x" aria-label="Class figures">
        {[
          ["Students ranked", `${ranked.length}`, `of ${ws.students.length}`, "review-students"],
          ["Class average", `${classAverage}%`, "", "review-average"],
          ["Highest", `${Math.max(...averages)}%`, name(ranked[0].studentId), "review-highest"],
          ["Lowest", `${Math.min(...averages)}%`, "", "review-lowest"],
          ["Passed", `${Math.round((passed / ranked.length) * 100)}%`, `${passed} of ${ranked.length}, ${passMark}% and above`, "review-passed"],
        ].map(([label, value, note, id]) => (
          <div key={id} className="p-4" data-testid={id}>
            <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--p-ink)/0.55)]">{label}</p>
            <p className="mt-1 font-serif text-3xl font-semibold tabular-nums">{value}</p>
            {note && <p className="truncate text-xs text-[hsl(var(--p-ink)/0.6)]">{note}</p>}
          </div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="min-w-0 space-y-4">
          <section className="portal-card overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-[hsl(var(--p-line))] px-4 py-3">
              <h3 className="font-serif text-lg font-semibold">Class ranking</h3>
              <button className="portal-btn-ghost !py-1.5 text-xs" onClick={() => print()} data-testid="button-review-print-all"><Printer size={13} /> Print all</button>
            </div>
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full text-sm" data-testid="table-review-ranking">
                <thead className="sticky top-0 bg-[hsl(var(--p-surface))] text-left text-xs uppercase tracking-wide text-[hsl(var(--p-ink)/0.6)]">
                  <tr><th className="px-4 py-2">Pos.</th><th className="px-2 py-2">Student</th><th className="px-2 py-2 text-right">Total</th><th className="px-2 py-2 text-right">Average</th><th className="px-4 py-2 text-right">Grade</th></tr>
                </thead>
                <tbody>
                  {ranked.map((r) => (
                    <tr key={r.studentId} onClick={() => setSelected(r.studentId)} aria-selected={selected === r.studentId}
                      className={"cursor-pointer border-t border-[hsl(var(--p-line))] " + (selected === r.studentId ? "bg-[hsl(var(--p-emerald-soft)/0.6)]" : "hover:bg-[hsl(var(--p-paper-2)/0.6)]")} data-testid={"review-row-" + r.studentId}>
                      <td className="px-4 py-2 font-semibold tabular-nums">{r.position ? ordinal(r.position) : "-"}</td>
                      <td className="px-2 py-2"><span className="block font-semibold">{name(r.studentId)}</span><span className="font-mono text-xs text-[hsl(var(--p-ink)/0.5)]">{code(r.studentId)} · {r.subjectsTaken} subjects</span></td>
                      <td className="px-2 py-2 text-right font-serif text-base font-semibold tabular-nums">{r.total}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{r.average}%</td>
                      <td className="px-4 py-2 text-right font-bold">{r.grade ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="portal-card p-4" aria-label="Overall grades">
            <h3 className="font-serif text-lg font-semibold">Overall grades</h3>
            <ul className="mt-3 space-y-1.5" data-testid="list-review-grades">
              {grades.map((g) => (
                <li key={g.grade} className="grid grid-cols-[2.5rem_1fr_2rem] items-center gap-2 text-sm">
                  <span className="font-bold">{g.grade}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-[hsl(var(--p-paper-2))]"><span className="block h-full rounded-full bg-[hsl(var(--p-emerald))]" style={{ width: `${(g.count / most) * 100}%` }} /></span>
                  <span className="text-right tabular-nums">{g.count}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="portal-card overflow-x-auto">
            <h3 className="px-4 pt-3 font-serif text-lg font-semibold">Subject performance</h3>
            <table className="mt-2 w-full min-w-[420px] text-sm" data-testid="table-review-subjects">
              <thead className="text-left text-xs uppercase tracking-wide text-[hsl(var(--p-ink)/0.6)]"><tr><th className="px-4 py-2">Subject</th><th className="px-2 py-2 text-right">Average</th><th className="px-2 py-2 text-right">Highest</th><th className="px-2 py-2 text-right">Lowest</th><th className="px-4 py-2 text-right">Entries</th></tr></thead>
              <tbody>
                {[...ws.subjectStats].sort((a, b) => b.average - a.average).map((s) => (
                  <tr key={s.subjectId} className="border-t border-[hsl(var(--p-line))]">
                    <td className="px-4 py-2 font-semibold">{subjectName.get(s.subjectId) ?? "Subject"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{s.average}</td><td className="px-2 py-2 text-right tabular-nums">{s.highest}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{s.lowest}</td><td className="px-4 py-2 text-right tabular-nums">{s.entries}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <section className="portal-card min-w-0 overflow-hidden lg:sticky lg:top-4 lg:self-start" aria-label="Result preview">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[hsl(var(--p-line))] px-4 py-3">
            <div className="min-w-0"><h3 className="truncate font-serif text-lg font-semibold">{selected ? name(selected) : "Preview"}</h3><p className="text-xs text-[hsl(var(--p-ink)/0.6)]">Exactly as the student will see and print it</p></div>
            {selected && <button className="portal-btn !py-1.5 text-xs" onClick={() => print([selected])} data-testid="button-review-print-one"><Printer size={13} /> Print / PDF</button>}
          </div>
          {selected && <iframe title={`Result preview for ${name(selected)}`} srcDoc={html} className="h-[70dvh] w-full bg-white lg:h-[760px]" data-testid="frame-result-preview" />}
        </section>
      </div>
    </div>
  );
}

/** Term and class pickers with the approval steps, for the Director (and anyone with office access). */
export function ResultsReview() {
  const [termId, setTermId] = useState<number | undefined>();
  const [classId, setClassId] = useState<number | undefined>();
  const params = termId && classId ? { termId, classId } : undefined;
  const q = useGetReportWorkspace(params, { query: { queryKey: getGetReportWorkspaceQueryKey(params), placeholderData: (prev) => prev } });
  const ws = q.data;
  useEffect(() => {
    if (!ws) return;
    if (!termId && ws.terms[0]) setTermId(ws.terms[0].id);
    if (!classId && ws.classes[0]) setClassId(ws.classes[0].id);
  }, [ws, termId, classId]);
  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-64" /></div>;
  if (q.isError || !ws) return <ErrorPanel title="Results did not load" message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!ws.terms.length || !ws.classes.length) return <EmptyState icon={<FileBarChart size={22} />} title="No results yet" body="Terms and classes are set up in the staff portal's Report cards." />;
  const term = ws.terms.find((t) => t.id === termId);
  const cls = ws.classes.find((c) => c.id === classId);
  const ready = term && cls && ws.termId === term.id && ws.classId === cls.id;
  const missing = ready ? ws.students.filter((s) => (ws.results.find((r) => r.studentId === s.id)?.subjectsTaken ?? 0) < ws.subjects.length).length : 0;
  return (
    <div className="space-y-4">
      <div className="portal-card flex flex-col gap-3 p-4 md:flex-row md:items-end">
        <Field label="Term" htmlFor="rv-term"><select id="rv-term" className="portal-input md:min-w-[260px]" value={termId ?? ""} onChange={(e) => setTermId(Number(e.target.value))} data-testid="select-review-term">{ws.terms.map((t) => <option key={t.id} value={t.id}>{termLabel(t)}</option>)}</select></Field>
        <Field label="Class" htmlFor="rv-class"><select id="rv-class" className="portal-input md:min-w-[200px]" value={classId ?? ""} onChange={(e) => setClassId(Number(e.target.value))} data-testid="select-review-class">{ws.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        {ready && <span className={"w-fit rounded-full px-3 py-1 text-xs font-bold md:ml-auto " + TONE[ws.workflow.status]} data-testid="text-review-status">{STATUS[ws.workflow.status]}</span>}
      </div>
      {!ready ? <Skeleton className="h-64" /> : (<>
        <WorkflowBar ws={ws} term={term} className={cls.name} missing={missing} onOpenSettings={() => {}} />
        <ResultsReviewBody ws={ws} term={term} className={cls.name} />
      </>)}
    </div>
  );
}
