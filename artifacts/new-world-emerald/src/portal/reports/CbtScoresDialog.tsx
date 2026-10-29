import { useMemo, useState } from "react";
import { useGetPortalManagement, getGetPortalManagementQueryKey, type ReportTerm, type ReportWorkspace } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "../ui";
import { useReportCommand } from "./useReportCommand";

/** A CBT score out of the exam's total, as a mark out of the report card column's maximum, in half marks. */
export function convertScore(score: number, total: number, max: number) {
  if (!(total > 0) || !(score >= 0)) return null;
  return Math.min(max, Math.round((score / total) * max * 2) / 2);
}

/** Brings a class's marked CBT exam scores into one subject's CA or Exam column on the report cards. */
export function CbtScoresDialog({ ws, term, onClose, subjectId: initialSubject }: { ws: ReportWorkspace; term: ReportTerm; onClose: () => void; subjectId?: number }) {
  const cmd = useReportCommand();
  const mgmt = useGetPortalManagement({ query: { queryKey: getGetPortalManagementQueryKey() } });
  const exams = (mgmt.data?.exams ?? []).filter((e) => e.classId === ws.classId && e.mode === "interactive" && e.id != null);
  const [examId, setExamId] = useState<number>(0);
  const exam = exams.find((e) => e.id === examId) ?? exams[0];
  const [subjectId, setSubjectId] = useState<number | "new">(initialSubject ?? ws.subjects[0]?.id ?? "new");
  const [column, setColumn] = useState<"exam" | "ca">("exam");
  const max = column === "ca" ? term.caMax : term.examMax;

  const rows = useMemo(() => {
    if (!exam) return [];
    const attempts = (mgmt.data?.attempts ?? []).filter((a) => a.examId === exam.id && a.status === "marked" && typeof a.score === "number");
    return ws.students.map((st) => {
      const a = attempts.find((x) => x.studentId.toUpperCase() === st.studentId.toUpperCase());
      const value = a ? convertScore(a.score!, a.totalMarks, max) : null;
      const saved = typeof subjectId === "number" ? ws.scores.find((s) => s.studentId === st.id && s.subjectId === subjectId) : undefined;
      return { st, a, value, before: saved ? (column === "ca" ? saved.ca : saved.exam) : null, saved };
    });
  }, [exam, mgmt.data, ws.students, ws.scores, subjectId, column, max]);
  const ready = rows.filter((r) => r.value !== null);
  const notSat = rows.filter((r) => !r.a);

  const save = async () => {
    if (!exam) return;
    let target = subjectId;
    if (target === "new") {
      // The office can create the subject from the exam's subject name in the same step.
      if (!(await cmd.run({ action: "saveSubject", subject: { classId: ws.classId!, name: exam.subject.trim() || exam.title.trim() } }, `Subject ${exam.subject} added`))) return;
      onClose();
      return;
    }
    const entries = ready.map((r) => ({
      studentId: r.st.id, subjectId: target as number,
      ca: column === "ca" ? r.value : r.saved?.ca ?? null, exam: column === "exam" ? r.value : r.saved?.exam ?? null,
      total: r.saved?.total ?? null, grade: r.saved?.grade ?? null,
    }));
    if (await cmd.run({ action: "saveScores", scores: { termId: term.id, entries } }, `Saved ${entries.length} scores from ${exam.title}`)) onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-h-[94dvh] max-w-2xl overflow-y-auto rounded-2xl">
        <DialogHeader><DialogTitle className="font-serif text-2xl">Bring in CBT exam scores</DialogTitle>
          <DialogDescription>Marked CBT scores are converted to this term's maximum and saved for one subject. Check them before saving.</DialogDescription></DialogHeader>
        {mgmt.isLoading ? <Skeleton className="h-40" /> : !exams.length ? (
          <p className="rounded-xl bg-[hsl(var(--p-paper-2))] p-4 text-sm" data-testid="text-no-cbt">No on-screen CBT exams for this class yet.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm font-semibold sm:col-span-3">CBT exam
                <select className="portal-input mt-1" value={exam?.id ?? ""} onChange={(e) => setExamId(Number(e.target.value))} data-testid="select-cbt-exam">
                  {exams.map((e) => <option key={e.id} value={e.id!}>{e.title} · {e.subject} · {new Date(e.startsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</option>)}
                </select></label>
              <label className="text-sm font-semibold sm:col-span-2">Report card subject
                <select className="portal-input mt-1" value={subjectId} onChange={(e) => setSubjectId(e.target.value === "new" ? "new" : Number(e.target.value))} data-testid="select-cbt-subject">
                  {ws.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  {ws.canAdmin && exam && !ws.subjects.some((s) => s.name.toLowerCase() === exam.subject.trim().toLowerCase()) && <option value="new">Add subject "{exam.subject}"</option>}
                </select></label>
              <label className="text-sm font-semibold">Counts as
                <select className="portal-input mt-1" value={column} onChange={(e) => setColumn(e.target.value as "exam" | "ca")} data-testid="select-cbt-column">
                  <option value="exam">Exam (out of {term.examMax})</option><option value="ca">CA (out of {term.caMax})</option>
                </select></label>
            </div>
            {subjectId === "new" ? (
              <p className="rounded-xl bg-[hsl(var(--p-gold-soft)/0.7)] p-3 text-sm">First add the subject to {ws.classes.find((c) => c.id === ws.classId)?.name}, then bring the scores in.</p>
            ) : (<>
              <p className="text-sm text-[hsl(var(--p-ink)/0.7)]" data-testid="text-cbt-summary">{ready.length} of {ws.students.length} students have a marked score.{notSat.length ? ` ${notSat.length} did not sit or are not marked yet.` : ""}</p>
              <div className="max-h-72 overflow-y-auto rounded-xl border border-[hsl(var(--p-line))]">
                <table className="w-full text-sm" data-testid="table-cbt-preview">
                  <thead className="sticky top-0 bg-[hsl(var(--p-surface))] text-left text-xs uppercase tracking-wide text-[hsl(var(--p-ink)/0.6)]"><tr><th className="px-3 py-2">Student</th><th className="px-2 py-2 text-right">CBT</th><th className="px-2 py-2 text-right">{column === "ca" ? "CA" : "Exam"} /{max}</th><th className="px-3 py-2 text-right">Now</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.st.id} className="border-t border-[hsl(var(--p-line))]">
                        <td className="px-3 py-1.5">{r.st.name}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{r.a ? `${r.a.score}/${r.a.totalMarks}` : <span className="text-[hsl(var(--p-ink)/0.5)]">Not sat</span>}</td>
                        <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{r.value ?? "-"}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[hsl(var(--p-ink)/0.55)]">{r.before ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>)}
          </div>
        )}
        <DialogFooter className="gap-2">
          <button className="portal-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="portal-btn" disabled={!exam || cmd.pending || (subjectId !== "new" && !ready.length)} onClick={() => void save()} data-testid="button-save-cbt">
            {subjectId === "new" ? "Add subject" : cmd.pending ? "Saving..." : `Save ${ready.length} scores`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
